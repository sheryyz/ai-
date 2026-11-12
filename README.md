# MorphOS

**意图驱动的通用应用生成与演进平台** · Intention-Driven App Generation & Evolution

用一句话生成一个真正能录入、保存、筛选、统计、导出数据的小应用；再用一句话让它持续进化。
AI 只产出受约束的 JSON 提案，系统六层校验、以 Morph Diff 展示真实影响，**你批准后才生效**；界面可回到任一历史版本，**业务数据永远不会因此丢失**。

> 全国高校 Vibe Coding 开发挑战赛 · 研究生组参赛作品

## 它能做什么

| 能力 | 说明 |
|---|---|
| 一句话生成应用 | 描述需求 → AI 流式展示思考与分步进度（理解 → 规划 → 生成 → 校验 → 自修复 → 就绪）→ 生成提案 |
| 增量演进 | 对已有应用提新需求，AI 只输出增量 Patch（加字段、加组件、连线、设筛选），不重写整个应用 |
| 六层校验 + 自修复 | 结构 / 引用 / 类型 / 数据流图 / 安全 / 版本；不合格的提案带着具体错误退回模型，最多自修复 2 轮 |
| Morph Diff + 人工批准 | 新增、修改、保留、对已有记录的影响一目了然；待批准的组件以虚线“幽灵层”叠加在预览上 |
| 版本只追加 | 任意恢复旧版本界面，**只换配置不动数据**；可再恢复回来 |
| 真实可用的应用 | 表单录入（服务端按字段校验）、编辑、搜索、筛选、指标、分布图、快捷操作（签到 / 借出 / 归还）、消息草稿、中文 CSV 导出 |
| 安全边界 | 协议里没有删除业务数据的操作；删字段、改类型、执行代码 / SQL 一律被拒并给出建议 |
| 无 Key 可用 | 不配置模型也能运行：已有应用全部可用，可回放录制的真实模型响应（界面标注“非实时生成”） |
| 一个引擎，多个场景 | 讲座报名与设备借用两个场景共用同一套运行时，仓库中没有任何场景专用页面（有测试守护） |

开发进度与每阶段的验证记录见 [docs/roadmap.md](docs/roadmap.md)。

## 10 分钟复现指南

### 1. 环境要求

| 依赖 | 版本 | 检查命令 |
|---|---|---|
| Node.js | **≥ 22.13**（开发使用 24.21） | `node -v` |
| npm | ≥ 10（随 Node 安装；开发使用 11.19） | `npm -v` |
| Git | 任意近期版本 | `git --version` |

不需要 Docker、pnpm、Python 或任何 C++ 编译工具链。数据库使用 Node 内置的 `node:sqlite`。开发与全部测试在 macOS 上完成；启动脚本不依赖 shell 语法，Windows / Linux 应同样可用，但未实测。

### 2. 获取代码并安装

```bash
git clone https://github.com/sheryyz/ai-.git morphos
cd morphos
npm install
```

> 使用 npm 11 时可能看到 `install-scripts` 提示（esbuild、fsevents）。这是 npm 的安全默认策略，**可忽略**，不影响运行。

### 3. 配置模型（可选）

```bash
cp .env.example .env        # Windows：copy .env.example .env
```

在 `.env` 中填入任意 OpenAI 兼容服务的 `LLM_API_KEY`（默认 DeepSeek）。
**不填也能运行**：右上角显示“离线模式”，可用模板创建应用、回放演示样例，全部测试照常通过。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LLM_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容接口地址 |
| `LLM_API_KEY` | 空 | 模型密钥，只在服务端读取 |
| `LLM_MODEL` | `deepseek-flash` | 也可用 `deepseek-v4-pro`（更强，较慢） |
| `PORT` | `8787` | 服务端端口 |
| `DATABASE_PATH` | `./data/morphos.db` | SQLite 文件位置（相对仓库根目录） |
| `APP_TIMEZONE` | `Asia/Shanghai` | 业务时区，决定“今天”与时间显示 |

### 4. 启动

```bash
npm start
```

会先构建前端（几秒钟），然后打开 <http://localhost:8787>。右上角显示 `AI 实时 · deepseek-flash` 或 `离线模式 · 未配置模型`，说明已联通。

开发时用 `npm run dev`（前端热更新，打开 <http://localhost:5173>）。

### 5. 验证

```bash
npm run check                   # 代码规范 + 类型检查
npm test                        # 单元与接口测试（无需 Key、无需浏览器）
npx playwright install chromium # 仅首次：下载端到端测试用的浏览器
npm run test:e2e                # 端到端：自动构建并在内存数据库上走完两个演示场景
```

## 使用教程

### 界面

| 页面 | 地址 | 用途 |
|---|---|---|
| 应用中心 | `/` | 一句话生成应用、从模板创建、回放演示样例、查看已有应用 |
| AI Studio | `/apps/:id/studio` | 左：对话与流水线 · 中：实时预览 / 提案预览 · 右：变更（Morph Diff）/ 版本 / 结构 |
| 运行界面 | `/apps/:id` | 给最终用户用的应用本身：录入、表格、筛选、统计、快捷操作、导出 |

### 场景 A：讲座报名 → 加签到（演进主线）

1. **生成**：在应用中心输入“创建一个校园讲座报名系统，包含姓名、学号、专业、手机号。”（离线时点“场景 A · 创建讲座报名系统”回放）。观察流水线逐步点亮，右侧出现 Morph Diff，点 **批准并生效**。
2. **录入**：点 Studio 左上的“运行界面”，用表单录入几条报名。刷新页面、重启服务，数据都还在。
3. **演进**：回到 Studio，输入“活动快开始了，加一个签到功能，找出计算机专业还没签到的人，给他们写提醒，旁边显示签到率。”Diff 会写明“复用已有记录，旧记录签到默认为否”；中栏的“提案预览”里，待新增的组件以虚线显示。批准后立即可以签到，签到率与提醒草稿随之变化。
4. **越界请求**：输入“把没签到的人从名单里删掉并重置数据”。安全层拒绝，说明原因并给出改写建议（配置了模型时可一键“按建议重试”），记录一条不少。
5. **恢复版本**：右栏“版本”标签 → 在 v1 上点“恢复此版本界面”：签到组件消失，所有报名与签到数据不变；再恢复最新版本，签到状态完整回来。

### 场景 B：设备借用（同一引擎，第二个场景）

1. 输入“设备借用管理：设备名称、编号、类别、状态（可借用/已借出/已归还）、借用人、借用日期。”（离线回放“场景 B · 创建设备借用管理”），批准。
2. 在运行界面登记设备，用“借出设备 / 归还设备”快捷操作改变状态，分类统计实时更新。
3. 演进：“标出借出超过 7 天的设备”，批准后多出超期筛选与超期设备表。

### 小贴士

- 右上角图标切换 亮色 / 暗色 / 跟随系统；手机宽度下同样可用。
- 每张表格右上角可导出 CSV，Excel 直接打开不乱码，列与当前筛选一致。
- 想从空白开始：停止服务后删除 `data/morphos.db`（会清空本机所有应用与记录）。

## 测试与评测

| 类型 | 数量 | 位置 |
|---|---|---|
| 单元测试（协议、校验、Patch、Diff、筛选、运行时求值） | 77 | `packages/shared/src/*.test.ts` |
| 接口测试（Supertest + 内存数据库，含脚本化模型与录制回放） | 50 | `apps/server/src/*.test.ts` |
| 端到端（Playwright，两个演示场景） | 2 | `tests/e2e/` |

验收用例 AC-01 – AC-14 与对应测试见 [docs/acceptance-tests.md](docs/acceptance-tests.md)。

**策略评测**（研究生组要求）：同一组 25 条用例对比“A 整体重生成”与“B 增量 Patch（本作品）”，真实调用 `deepseek-flash`，结果见 [eval/results/2026-11-12-deepseek-flash.md](eval/results/2026-11-12-deepseek-flash.md)，方法见 [eval/README.md](eval/README.md)。

## 命令一览

| 命令 | 作用 |
|---|---|
| `npm start` | 构建前端并单端口运行（<http://localhost:8787>） |
| `npm run dev` | 开发模式：server :8787 + web :5173（代理 `/api`） |
| `npm run check` | Biome lint/format 检查 + 全部包类型检查 |
| `npm test` | 单元与接口测试 |
| `npm run test:e2e` | 端到端测试（首次需 `npx playwright install chromium`） |
| `npm run build` | 只构建前端 |
| `npm run format` | 自动修复格式与可安全修复的 lint 问题 |
| `npm run eval -w @morphos/server` | 重跑策略评测（需要 Key） |
| `npm run record-demos -w @morphos/server` | 重新录制离线演示样例（需要 Key） |

## 架构速览

```
apps/web         React 19 + Vite 8 + Tailwind v4   应用中心 / AI Studio / 运行界面
apps/server      Express 5 + node:sqlite            应用、版本、记录、提案、AI 规划器
packages/shared  纯 TypeScript + Zod                协议 Schema、六层校验、Patch、Diff、运行时求值
```

AI 的每一次修改都走同一条流水线：

```
意图 → 理解 → 规划（流式思考）→ 生成提案 JSON → 六层校验 ⇄ 自修复 → Morph Diff → 人工批准 → 新版本
```

| 文档 | 内容 |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 痛点、差异化、范围、红线 |
| [docs/protocol.md](docs/protocol.md) | AppDefinition、类型化端口、筛选 DSL、Patch、校验层、Morph Diff |
| [docs/architecture.md](docs/architecture.md) | 模块、数据流、数据库、接口 |
| [docs/design.md](docs/design.md) | 视觉与交互规范 |
| [docs/decisions/](docs/decisions/) | 架构决策记录 |
| [docs/acceptance-tests.md](docs/acceptance-tests.md) | 验收用例与证据 |
| [CLAUDE.md](CLAUDE.md) | AI 编码会话的约束上下文 |

## 已知限制

- 每个应用只有一个数据实体（协议保留了多实体扩展位）。
- 不支持删除字段或修改字段类型：这类请求会被校验器拒绝，以保证旧数据不丢。
- 消息只生成草稿，可复制或记录到“模拟发件箱”，不会真实发送短信或微信。
- 离线模式无法理解新的自然语言需求，只能回放已录制的样例；样例只能回放到结构与录制时一致的应用上。
- 场景 B 的状态完全按需求原文（可借用 / 已借出 / 已归还）生成：借出只接受“可借用”，所以归还后的设备不能再次借出。需要的话可以再用一句话让它演进。

## 开发过程与可复现性

本项目全程使用 AI 编程工具（Claude Code）开发，过程证据如下：

- **细粒度 Git 历史**：每个提交对应一次 AI 协作或一个功能点，`git log --reverse` 可按时间重放整个演进过程。
- **意图控制**：[CLAUDE.md](CLAUDE.md) 与 [docs/protocol.md](docs/protocol.md) 在写代码之前就固定了架构边界，AI 在边界内生成代码。
- **Prompt 历史**：[docs/prompts/](docs/prompts/) 存放记录规范与索引；各次会话的完整记录正在整理与脱敏，完成后放入该目录。

## 安全与真实性声明

- **AI 只输出数据**：模型输出只作为 JSON 数据解析，系统中不存在执行模型生成的代码、SQL 或命令的路径。
- **数据安全**：协议中不存在任何删除业务数据的操作；业务记录只能由用户在运行界面中操作写入。
- **密钥**：API Key 只从环境变量读取，不下发前端、不写日志；`.env` 已被 Git 忽略，pre-commit 钩子拦截疑似密钥。
- **不伪装**：离线演示样例是录制的真实模型响应，回放时经当前校验器重新校验，界面明确标注“演示样例 · 非实时生成”及录制模型与日期；消息通道为模拟，界面标注“不会真实发送”。
- **示例数据**：模板附带的示例记录均为虚构（姓名随机组合，手机号为 1380000 号段占位）。
- **不伪造**：测试结果、评测数据、Bug 与修复过程均来自真实运行，评测结果文件记录了模型、提示词版本、温度与代码版本。
