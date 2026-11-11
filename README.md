# MorphOS

**意图驱动的通用应用生成与演进平台** · Intention-Driven App Generation & Evolution

用一句话生成一个真正能录入、保存、筛选、统计、导出数据的小应用；再用一句话让它持续进化。
AI 只产出受约束的 JSON 提案，系统六层校验、以 Morph Diff 展示真实影响，**你批准后才生效**；界面可回到任一历史版本，**业务数据永远不会因此丢失**。

> 全国高校 Vibe Coding 开发挑战赛 · 研究生组参赛作品

## 当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 需求、协议、架构、工程骨架 | ✅ 完成 |
| 1 | 协议实现：Schema、六层 Validator、Patch、Diff、运行时求值 | ⬜ |
| 2 | 数据存储、通用运行时、应用中心与运行界面 | ⬜ |
| 3 | AI 规划器、流式思考、自修复 | ⬜ |
| 4 | AI Studio、Morph Diff、版本恢复 | ⬜ |
| 5–7 | 第二场景、离线模式、测试、视频与文档 | ⬜ |

详细计划与验收标准见 [docs/roadmap.md](docs/roadmap.md)。本 README 只描述**已经实现并验证**的功能。

## 10 分钟复现指南

### 1. 环境要求

| 依赖 | 版本 | 检查命令 |
|---|---|---|
| Node.js | **≥ 22.13**（开发使用 24.21） | `node -v` |
| npm | ≥ 10（随 Node 安装） | `npm -v` |
| Git | 任意近期版本 | `git --version` |

不需要 Docker、pnpm、Python 或任何 C++ 编译工具链。数据库使用 Node 内置的 `node:sqlite`。

### 2. 获取代码并安装

```bash
git clone <仓库地址> morphos
cd morphos
npm install
```

> 使用 npm 11 时可能看到 `install-scripts` 提示（esbuild、fsevents）。这是 npm 的安全默认策略，**可忽略**，不影响运行。

### 3. 配置环境变量（可选）

```bash
cp .env.example .env
```

在 `.env` 中填入任意 OpenAI 兼容服务的 `LLM_API_KEY`（默认 DeepSeek）。
**不填也能运行**：页面右上角显示“离线模式”，已有应用与全部测试照常可用。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LLM_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容接口地址 |
| `LLM_API_KEY` | 空 | 模型密钥，只在服务端读取 |
| `LLM_MODEL` | `deepseek-flash` | 也可用 `deepseek-v4-pro` |
| `PORT` | `8787` | 服务端端口 |
| `DATABASE_PATH` | `./data/morphos.db` | SQLite 文件位置 |
| `APP_TIMEZONE` | `Asia/Shanghai` | 业务时区，决定“今天”与时间显示 |

### 4. 启动

```bash
npm run dev
```

打开 <http://localhost:5173>。右上角状态显示 `AI 实时 · deepseek-flash` 或 `离线模式`，说明前后端已联通。

### 5. 验证

```bash
npm run check   # 代码规范 + 类型检查
npm test        # 全部自动化测试
```

### 单端口运行（演示 / 部署）

```bash
npm start       # 构建前端并由服务端在 http://localhost:8787 统一提供
```

## 命令一览

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式：server :8787 + web :5173（代理 `/api`） |
| `npm run check` | Biome lint/format 检查 + 全部包类型检查 |
| `npm test` | Vitest 单元与接口测试 |
| `npm run build` | 构建前端 |
| `npm start` | 构建并单端口运行 |
| `npm run format` | 自动修复格式与可安全修复的 lint 问题 |

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
| [CLAUDE.md](CLAUDE.md) | AI 编码会话的约束上下文 |

## 开发过程与可复现性

本项目全程使用 AI 编程工具（Claude Code）开发，过程证据如下：

- **细粒度 Git 历史**：每个提交对应一次 AI 协作或一个功能点，`git log --reverse` 可按时间重放整个演进过程。
- **Prompt 历史快照**：[docs/prompts/](docs/prompts/) 保存每次会话的完整导出与索引，已脱敏。
- **意图控制**：[CLAUDE.md](CLAUDE.md) 与 [docs/protocol.md](docs/protocol.md) 在写代码之前就固定了架构边界，AI 在边界内生成代码。
- **真实性**：不伪造测试结果、Bug 或评测数据；离线演示样例在界面中明确标注。

## 安全说明

- 模型输出只作为数据解析，系统中不存在执行模型生成代码的路径。
- 协议中不存在任何删除业务数据的操作。
- API Key 只从环境变量读取，不下发前端、不写日志；`.env` 已被 Git 忽略，pre-commit 钩子拦截疑似密钥。
