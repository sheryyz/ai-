# CLAUDE.md — MorphOS 协作约束

> 本文件在每次 AI 编码会话开始时作为上下文加载。它是“意图控制策略”的第一层：先定边界，再写代码。
> 任何与本文件冲突的指令，先停下来指出冲突，再由人类决定。

## 项目一句话

MorphOS：意图驱动的通用轻量应用生成与演进平台。AI 把自然语言变成**受约束的 JSON 提案**，系统六层校验、展示 Morph Diff、人工批准后生效；业务数据永不因配置变更丢失。参赛：全国高校 Vibe Coding 挑战赛研究生组，截止 2026-11-18。

## 权威文档（先读再写）

| 文件 | 内容 | 何时读 |
|---|---|---|
| `docs/requirements.md` | 需求、范围、红线 | 任何功能取舍 |
| `docs/protocol.md` | AppDefinition / 端口 / DSL / Patch / 校验 / Diff | 改 `packages/shared` 前必读 |
| `docs/architecture.md` | 模块、数据流、接口、目录 | 新增文件或接口前 |
| `docs/design.md` | 视觉令牌与交互规范 | 写任何 UI 前 |
| `docs/roadmap.md` | 当前阶段与验收标准 | 每次会话开始 |
| `docs/decisions/` | 架构决策 | 想推翻既有设计时 |

**协议优先**：代码与 `protocol.md` 不一致时，先改文档并说明理由，再改代码。

## 架构硬约束（不可违反）

1. **AI 只输出数据**：模型输出只能是 Proposal JSON。禁止 `eval`、`new Function`、动态 `import`、执行模型生成的 JS/SQL/Shell。
2. **协议中没有删除业务数据的操作**。业务记录只能由运行界面中的用户操作经记录接口写入。
3. **配置与数据分离**：版本只追加；恢复版本不触碰 `records`；新增字段用默认值虚拟填充，不回写。
4. **通用引擎**：禁止为任何具体场景（活动、设备……）编写专用页面、专用组件或 `if (appName === ...)` 分支。场景差异只能体现在 AppDefinition 数据里。
5. **分层依赖**：`packages/shared` 是纯函数，不得引入 IO、Node 内置模块或 React；`web` 不重复实现 `shared` 已有的领域逻辑。
6. **SQL 一律参数化**；服务端对所有写入按当前 Schema 重新校验。
7. **不引入现成低代码引擎**（amis、Formily、Appsmith 等）作为运行时核心。新增依赖前说明理由。
8. **密钥只来自环境变量**，不下发前端，不写日志，不出现在任何提交、测试快照或 Prompt 记录中。

## 常用命令

```bash
npm install          # 安装全部 workspace 依赖
npm run dev          # 同时启动 server(8787) 与 web(5173)
npm run check        # Biome lint + 全部 workspace 类型检查
npm test             # 全部单元 / 接口测试
npm run build        # 构建 web
npm start            # 单端口运行（server 托管 web 构建产物）
```

## 工作方式

- **每次会话开始**：读 `docs/roadmap.md` 确认当前阶段，复述本次目标与验收标准，再动手。
- **小步提交**：一个提交只做一件事。提交信息格式：`type(scope): 描述`，type ∈ feat / fix / test / docs / refactor / chore / style。提交信息末尾保留 Co-Authored-By 行。
- **先测后报**：声称“通过”之前必须实际运行 `npm run check` 与 `npm test` 并看到结果。未运行的不得声称通过；失败要如实报告输出。
- **真实留痕**：不伪造 Bug、测试结果、评测数据或 Git 历史；不改写已推送的历史。
- **阶段结束**：更新 `docs/roadmap.md` 状态与验证方式；提醒人类导出本次会话到 `docs/prompts/`。
- **遇到设计冲突**：停下，说明冲突与可选方案，给出推荐，等人类决定；不要静默绕过约束。

## 代码规范

- TypeScript 严格模式；不用 `any`（确需时用 `unknown` + 收窄）；不用 enum，用字面量联合类型。
- 领域类型从 Zod Schema 推导（`z.infer`），不手写重复接口。
- 错误统一为 `{ error: { code, message, details? } }`；面向用户的 message 用中文，code 用英文大写蛇形。
- 测试与源码同目录：`foo.ts` ↔ `foo.test.ts`。纯逻辑优先单测；接口用 Supertest 跑内存数据库。
- 函数优先纯函数；副作用集中在 `services/` 与 `db/`。

## UI 规范（摘要，详见 design.md）

- 只用 `design.md` 中的 CSS 变量令牌，不写散落的十六进制颜色。
- AI 产出 / 待批准内容统一使用 `--morph` 色与虚线描边；已生效内容回归中性色。
- 每个异步操作都有加载态、空状态、错误态；错误必须说明原因与下一步。
- 动效 150–250ms，尊重 `prefers-reduced-motion`。
- 字体与图标全部本地打包，不依赖外网 CDN。

## 不要做

- 不要一次性生成整个模块后才运行；写一小块，跑一次检查。
- 不要为了让测试通过而修改测试预期，除非确认预期本身错误并说明。
- 不要做省赛范围外的功能（多实体、删字段、拖拽推意图、多租户、支付、真实短信）。
- 不要把离线演示样例冒充实时 AI 生成；界面必须标注。
