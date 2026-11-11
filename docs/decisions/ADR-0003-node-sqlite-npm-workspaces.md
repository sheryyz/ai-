# ADR-0003 使用 node:sqlite 与 npm workspaces

- 状态：已采纳 · 2026-11-11

## 背景
比赛要求评委 10 分钟内复现。最常见的复现失败来自：原生模块编译（better-sqlite3 需要 C++ 工具链与匹配的预编译包）、额外包管理器（pnpm 未安装）、Docker 不可用。立项当天检查开发机：无 pnpm、无 Docker。

## 决定
- 数据库使用 Node 内置 `node:sqlite`（Node ≥ 22.13 无需参数；开发机 24.21 实测无实验警告）。
- 包管理使用 npm workspaces。
- 不依赖 Docker；`npm install && npm run dev` 即可启动。

## 代价
要求 Node ≥ 22.13；README 首行声明，并在启动时检查版本给出明确提示。
