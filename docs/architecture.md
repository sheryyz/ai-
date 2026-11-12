# MorphOS 架构设计 v1.1

> 需求见 `requirements.md`，协议见 `protocol.md`，关键取舍见 `decisions/`。

## 1. 总体架构

```
┌──────────────────────────────── apps/web（React） ────────────────────────────────┐
│  App Hub            AI Studio                                    App Runtime       │
│  应用列表/新建       对话 + 流水线进度 │ 实时预览 │ Diff / 版本      独立运行界面        │
│        │                    │                                          │           │
│        └──── TanStack Query（服务端状态）  ·  Runtime Renderer（按注册表渲染）───┘           │
└───────────────────────────────────────┬───────────────────────────────────────────┘
                                        │ REST + 流式 NDJSON
┌───────────────────────────────── apps/server（Express） ───────────────────────────┐
│  routes ─► services                                                                │
│            ├ AppService        应用与版本（只追加）                                  │
│            ├ RecordService     通用记录 CRUD，按当前 Schema 校验，软删除               │
│            ├ ProposalService   提案生命周期：pending → approved / rejected            │
│            ├ PlannerService    AI 流水线（见 §3），Validator-in-the-loop 自修复         │
│            ├ ExportService     CSV（复用 shared 绑定图求值）                          │
│            ├ OutboxService     模拟消息发件箱                                        │
│            └ ViewService       分享令牌、视图快照（服务端求值 + 按暴露裁剪）、视图内写入     │
│  access    管理接口仅本机（ADR-0008）；/api/v/:token/* 对局域网开放                       │
│  llm/      OpenAI 兼容客户端（流式、思考内容、超时、重试）+ 离线样例回放                    │
│  db/       node:sqlite，迁移脚本，事务封装                                           │
└───────────────────────────────────────┬───────────────────────────────────────────┘
                                        │ import
┌──────────────────────────── packages/shared（纯 TypeScript，无 IO） ───────────────────┐
│  schema/    Zod：AppDefinition、FieldDef、NodeDef、Binding、FilterExpr、Proposal      │
│  registry/  组件注册表：端口、params Schema、副作用声明                                  │
│  validate/  七层校验器 L1–L7                                                         │
│  patch/     applyPatch（原子、纯函数）                                                │
│  diff/      computeDiff → MorphDiff（含暴露对比）                                      │
│  exposure/  computeExposure、L7 规则、视图快照裁剪（protocol §11）                       │
│  runtime/   evaluateFilter、绑定图拓扑排序与求值、聚合计算、默认值虚拟填充                 │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**分层规则：** `shared` 不依赖任何 IO；`server` 与 `web` 只通过 `shared` 共享领域逻辑；`web` 不直接拼业务规则，只渲染 `shared/runtime` 的求值结果。

## 2. 关键数据流

### 2.1 演进一次应用

```
用户意图 ─► POST /api/ai/plan（流式）
            ├ stage: understand   读取当前定义 + 记录统计，组装上下文
            ├ stage: plan         模型流式输出思考内容 → 前端“思考”面板
            ├ stage: generate     模型输出 Proposal JSON
            ├ stage: validate     L1–L7 校验
            │     └ 失败 → stage: repair（把 ValidationIssue[] 回馈模型，最多 2 轮）
            └ stage: ready        保存 proposal(pending) + MorphDiff → 前端展示 Diff
用户批准 ─► POST /api/proposals/:id/approve
            └ 事务内：重新校验（防并发）→ 写 app_versions(v+1) → apps.current_version = v+1
```

### 2.2 运行界面渲染

```
GET definition + GET records
  └ shared/runtime.evaluateGraph(definition, records, now)
      拓扑排序节点 → CollectionSource 产出 RecordSet → 沿绑定边传播 → 每个可视节点得到输入
  └ Renderer 按 region / order / width 布局，按注册表映射到 React 组件
  └ 用户操作（提交表单 / 签到 / 编辑）→ 记录接口 → invalidate → 重新求值
  └ 每 3 秒轮询记录，其他设备（分享页）上的操作几秒内可见
```

管理页只渲染未归属视图的组件；Studio 预览按页面分标签（管理页 / 各视图），幽灵层照常标注。

### 2.3 分享页（角色视图）

```
组织者：Studio 右栏“分享” → POST /api/apps/:id/views/:viewId/link（无则创建令牌）
        → 显示局域网地址 + 二维码（GET /api/share-info 提供本机局域网 IP）
手机：  /v/:token → GET /api/v/:token
        └ 服务端：令牌 → (app, viewId) → 当前定义中视图存在且有可见组件，否则 410
                  → evaluateGraph(全部记录) → 对视图内每个组件按 computeExposure 裁剪
                  → 下发 { app 名称与图标, view, 精简实体结构, nodes: [{ node, data }] }
        └ 浏览器：按快照渲染（不再自行求值），每 3 秒刷新
        └ 提交表单 / 快捷操作 / 导出 / 发件箱 → /api/v/:token/...
             服务端：组件属于该视图且未隐藏 → 复用 RecordService 的按组件写入规则
```

浏览器在分享页上拿到的只有快照；管理页那套“拉取全部原始记录、本地求值”的路径对分享页不开放。

## 3. AI 流水线（PlannerService）

| 阶段 | 做什么 | 推送给前端 |
|---|---|---|
| understand | 组装上下文：当前 AppDefinition（压缩形式）、组件注册表摘要、记录数与字段样例值、协议规则 | 上下文摘要 |
| plan / generate | 调用模型（JSON 模式，流式）；`reasoning_content` 作为思考流 | 思考文本增量、输出 JSON 增量 |
| validate | `JSON.parse` → Zod → L2–L7 | 每层结果 |
| repair | 把结构化错误与 hint 作为新一轮用户消息回馈模型 | 第几轮修复、修了什么 |
| ready / failed | 保存提案与 Diff，或返回最终错误 | Diff / 错误说明 |

**为什么需要自修复**：立项当天实测，DeepSeek 在 JSON 模式下仍偶发返回不合法 JSON（见 `decisions/ADR-0004`）。模型输出不可信是架构前提，不是边缘情况。

**流式协议**：`POST` 返回 `application/x-ndjson`，每行一个事件：

```json
{"type":"stage","stage":"plan","status":"running"}
{"type":"thinking","delta":"用户要找出未签到的计算机专业学生……"}
{"type":"issues","round":1,"issues":[{"code":"TYPE_PORT_MISMATCH", "...": "..."}]}
{"type":"proposal","proposalId":"p_x","diff":{"...":"..."},"proposal":{"...":"..."}}
{"type":"error","code":"AI_UNAVAILABLE","message":"未配置模型 API"}
```

**两种运行模式**：

| 模式 | 触发 | 标注 |
|---|---|---|
| 实时 AI | `LLM_API_KEY` 已配置 | 顶栏“AI 实时 · 模型名” |
| 离线 | 无 Key | 顶栏“离线模式”；只能从内置模板创建或加载“演示样例提案”（真实模型响应的录制回放，界面注明录制时间与模型） |

## 4. 数据库（node:sqlite）

| 表 | 关键列 | 说明 |
|---|---|---|
| `apps` | id, name, icon, current_version, created_at, updated_at | 应用元数据 |
| `app_versions` | app_id, version, definition_json, source(`ai`/`template`/`restore`/`manual`), intent, proposal_id, restored_from, created_at | 只追加的配置快照，PK(app_id, version) |
| `records` | id, app_id, entity_id, data_json, created_at, updated_at, deleted_at | 通用业务记录，软删除 |
| `proposals` | id, app_id, base_version, kind, intent, proposal_json, diff_json, issues_json, trace_json, status, created_at, decided_at | AI 提案及其完整追踪（模型、轮次、耗时、token） |
| `outbox` | id, app_id, node_id, recipients_json, body, created_at | 模拟发件箱 |
| `view_links` | token（PK）, app_id, view_id, created_at, revoked_at | 分享令牌；不属于 AppDefinition、不随版本变化；重置 = 吊销旧令牌并生成新令牌 |
| `audit_events` | id, app_id, type, detail_json, created_at | 审计 |

所有写操作在事务中完成。迁移脚本按序号执行，记录于 `schema_migrations`。

## 5. HTTP 接口

统一错误格式：`{ "error": { "code", "message", "details?" } }`

| 方法 路径 | 用途 |
|---|---|
| `GET /api/health` | 服务状态、AI 是否配置、模型名 |
| `GET /api/templates` | 内置模板（活动报名、设备借用）与演示样例提案 |
| `GET /api/apps` · `POST /api/apps` | 列表；从模板或已批准的 create 提案创建 |
| `GET /api/apps/:id` · `PATCH /api/apps/:id` | 详情（含当前定义）；重命名 |
| `POST /api/ai/plan` | 流式生成 create / patch 提案（NDJSON） |
| `POST /api/proposals/:id/approve` · `/reject` | 批准（事务内复校验）/ 拒绝 |
| `POST /api/apps/:id/validate` | 手动提交 Proposal JSON 校验，供测试与演示 |
| `GET /api/apps/:id/versions` · `GET .../versions/:v` | 版本历史 / 某版本定义 |
| `POST /api/apps/:id/versions/:v/restore` | 恢复配置（新增版本，不改记录） |
| `GET/POST /api/apps/:id/records` | 查询 / 新增 |
| `PATCH/DELETE /api/apps/:id/records/:rid` | 编辑 / 软删除 |
| `GET /api/apps/:id/export.csv?node=` | 按某节点的绑定链导出（UTF-8 BOM） |
| `POST /api/apps/:id/outbox` · `GET` | 模拟发送记录 |
| `POST /api/proposals/:id/approve` 请求体 | `{ confirmExposure?: boolean }`；变更需要确认而未带时返回 `409 EXPOSURE_CONFIRM_REQUIRED`，`details` 列出视图与字段（protocol §11.5）。服务端按当前定义重新计算 Diff，不采信提案里存的 Diff |
| `POST /api/apps/:id/versions/:v/restore` 请求体 | `{ baseVersion, confirmExposure? }`；恢复到会公开敏感字段的版本同样需要确认 |
| `GET /api/apps/:id/views` | 各视图的分享状态（是否已生成链接、令牌、当前是否可用） |
| `POST /api/apps/:id/views/:viewId/link` · `/reset` | 获取（无则创建）/ 重置分享链接 |
| `GET /api/share-info` | 本机局域网地址与端口，供生成二维码；可用 `PUBLIC_BASE_URL` 覆盖 |
| `GET /api/v/:token` | **分享接口**：`{ snapshot: ViewSnapshot }`。逐条组件只带其 `read` 字段；Metric / Chart / Filter / CSVExport 只带统计结果或计数；QuickAction 的 `availableWhen` 在服务端求值后从参数中去掉。响应头 `Cache-Control: no-store`；无效或已重置的链接 `404 LINK_INVALID`，视图停用 `410 VIEW_INACTIVE` |
| `POST /api/v/:token/records` · `/actions/:nodeId` · `/outbox` | **分享接口**：经视图内组件新增记录 / 快捷操作 / 发件箱 |
| `GET /api/v/:token/export.csv?node=` | **分享接口**：导出视图内 CSVExport 节点的数据（列按暴露规则） |

**访问规则（ADR-0008）**：`/api/v/*` 与 `/api/health` 对任何来源开放；其余接口只接受本机回环地址的连接，否则 `403 ADMIN_LOCAL_ONLY`。`ADMIN_ACCESS=any` 关闭此限制（仅用于自带鉴权的部署）。

## 6. 前端结构

| 路由 | 页面 |
|---|---|
| `/` | App Hub：应用卡片、新建入口（自然语言 / 模板） |
| `/apps/:id/studio` | AI Studio：左对话与流水线、中实时预览（按页面分标签）、右 Diff（含暴露栏）/ 版本 / Schema / 分享 |
| `/apps/:id` | 管理页：组织者使用，仅本机；不含任何视图组件 |
| `/v/:token` | 分享页：单列、手机优先；不显示平台导航、AI 状态与 Studio 入口；视图停用时说明原因 |

状态管理：服务端状态用 TanStack Query；Studio 内的流式会话用组件内 reducer；不引入全局状态库。
组件实现：Tailwind v4 + Radix 原语 + 自写组件（`components/ui`），动画用 Motion（layout 动画实现“变形”）。视觉规范见 `design.md`。

## 7. 技术栈（锁定）

| 层 | 选择 | 版本（立项日） |
|---|---|---|
| 运行时 | Node.js ≥ 22.13（开发机 24.21） | — |
| 包管理 | npm workspaces（不要求评委安装 pnpm） | npm 11 |
| 语言 | TypeScript（严格模式） | 7.0 |
| 前端 | React + Vite | 19.3 / 8.3 |
| 样式 | Tailwind CSS v4 + Radix + Motion + lucide-react | 4.3 / 1.8 / 14.12 |
| 路由 / 数据 | react-router + TanStack Query | 8.5 / 5.107 |
| 前端小工具 | sonner（操作结果 Toast）、clsx + tailwind-merge（条件类名合并，避免 Tailwind 冲突类） | 2.0 / 2.1 / 3.7 |
| 后端 | Express + tsx 直接运行 TS | 5.3 / 4.23 |
| 数据库 | `node:sqlite`（Node 内置，无原生编译） | — |
| 校验 | Zod | 4.6 |
| 模型 | OpenAI 兼容 Chat Completions，默认 DeepSeek `deepseek-flash` | — |
| 测试 | Vitest + Supertest + Playwright | 5.1 / 7.3 / 1.65 |
| 代码检查 | Biome（lint + format）+ `tsc --noEmit` | 2.6 |

## 8. 目录结构

```
.
├─ CLAUDE.md                 AI 协作约束（每次会话的上下文）
├─ README.md                 10 分钟复现指南
├─ .env.example              环境变量模板
├─ package.json              workspaces 与统一脚本
├─ apps/
│  ├─ server/src/
│  │  ├─ index.ts            启动入口
│  │  ├─ app.ts              Express 装配（便于 Supertest）
│  │  ├─ config.ts           环境变量解析（Zod）
│  │  ├─ db/                 连接、迁移、事务
│  │  ├─ services/           §1 所列服务
│  │  ├─ llm/                模型客户端、提示词、离线回放
│  │  └─ routes/
│  └─ web/src/
│     ├─ main.tsx · App.tsx  路由
│     ├─ pages/              Hub / Studio / Runtime
│     ├─ runtime/            组件渲染器（注册表 → React 组件）
│     ├─ studio/             对话、流水线、Diff、版本
│     ├─ components/ui/      基础 UI 原语
│     └─ lib/                API 客户端、流式读取
├─ packages/shared/src/      schema / registry / validate / patch / diff / runtime
├─ fixtures/                 模板定义、演示样例提案、非法提案用例
├─ eval/                     评测用例与脚本
├─ tests/e2e/                Playwright
├─ data/                     SQLite 文件（不入库）
└─ docs/                     需求、协议、架构、设计、计划、决策、Prompt 记录
```

## 9. 安全与健壮性

- 模型输出只作为数据解析；无 `eval`、无动态 SQL；SQL 全部使用参数化语句。
- 服务端对所有写入按当前 Schema 重新校验，前端校验仅为体验。
- 批准提案时在事务内重新校验并检查 `baseVersion`，防止并发覆盖。
- 模型调用设置超时、单次请求 token 上限、自修复轮数上限，避免死循环与费用失控。
- 请求体大小限制；记录数量、节点数、绑定数有上限。
- API Key 只在服务端读取，不下发前端，不写日志。
- 业务日期（今天、`$today`、相对日期、时间显示）统一按 `APP_TIMEZONE` 计算，与宿主时区无关（ADR-0005）。
- 分享页的数据裁剪在服务端完成，前端隐藏不算权限；管理接口按 TCP 对端地址限制为本机，不信任转发头（ADR-0007、ADR-0008）。
- 分享令牌用 `crypto.randomBytes` 生成，只存服务端；不写日志，不进入提示词、提案、版本或评测记录。
