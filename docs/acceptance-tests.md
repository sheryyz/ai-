# 验收用例

“证据”列给出可以重跑的测试（`文件 › 用例名`）或手动验证记录（见 [roadmap.md](roadmap.md) 对应阶段）。
`npm test` 运行单元与接口测试；`npm run test:e2e` 运行端到端测试（离线、内存数据库）。

| 编号 | 操作 | 期望 | 自动化 | 证据 |
|---|---|---|---|---|
| AC-01 | 自然语言创建活动报名应用 | 提案通过六层校验；批准后表单与表格可用 | 接口测试（离线样例）+ 手动（实时模型） | `planner.test.ts › POST /api/ai/plan — create (AC-01 with a scripted model)`；E2E `mainline.spec.ts › 场景 A`；实时 `deepseek-flash` 手动：阶段 3（4.9 s 一轮通过）、阶段 4（5.1 s） |
| AC-02 | 新增记录后刷新页面、重启服务 | 记录仍在且字段值一致 | 接口测试 | `records.test.ts › AC-02: records survive a server restart on the same database file` |
| AC-03 | 增量加签到字段 + 筛选 + 签到率 | 旧记录保留；新字段读出默认值 false；筛选与签到率正确 | 单测 + 接口测试 | `proposal.test.ts › AC-03: the check-in evolution patch passes all six layers`；`planner.test.ts › AC-03: approves an incremental patch…`；E2E 场景 A（Diff 写明旧记录默认值，签到后签到率 16.7%） |
| AC-04 | 从零生成设备借用应用 | 仓库中不存在设备专用页面；能录入、借出、归还 | 代码检索 + E2E | `generic-engine.test.ts › generic engine (AC-04)`（检索源码，无场景专用文件与分支）；`replay.test.ts › AC-04: scenario B…`；`records.test.ts › AC-04: creates two different apps…`；E2E `mainline.spec.ts › 场景 B` |
| AC-05 | 绑定 Number 输出到 RecordSet 输入 | 拒绝，`TYPE_PORT_MISMATCH`，说明两端类型 | 单测 | `validate.test.ts › AC-05: rejects binding a Number output into a RecordSet input` |
| AC-06 | 绑定形成环 | 拒绝，`GRAPH_CYCLE`，指出环上节点 | 单测 | `validate.test.ts › AC-06: rejects a cycle and names the nodes on it` |
| AC-07 | 提案含 `deleteRecords` / `dropCollection` / `rawSQL` | 拒绝，`SAFETY_FORBIDDEN_OP`，记录数不变 | 单测 + 接口测试 | `proposal.test.ts › AC-07: rejects forbidden op %s…`（含 `removeField`）；`planner.test.ts › AC-07: a forbidden op is blocked at L5…` 与 `AC-07 (interface)…`；E2E 场景 A（删除请求被拒，记录数不变） |
| AC-08 | 提案 `baseVersion` 过期 | 拒绝，`VERSION_CONFLICT`，提示重新规划 | 单测 + 接口测试 | `proposal.test.ts › AC-08: rejects a stale baseVersion`；`planner.test.ts › AC-08: approval fails with VERSION_CONFLICT…` |
| AC-09 | 批准后恢复旧版本，再恢复新版本 | 界面回退再前进；业务记录全程不变 | 接口测试 + E2E | `records.test.ts › …restores without touching records (AC-09 storage)`；`replay.test.ts › replays scenario A end to end…`；E2E 场景 A（恢复 v1 / v2 后记录逐字节一致） |
| AC-10 | 不配置 Key 启动 | 已有应用 CRUD、筛选、导出、历史正常；AI 输入框显示“未配置模型” | 接口测试 | `offline.test.ts › offline mode after a restart without a key (AC-10)`；`app.test.ts › reports offline mode when no key is set (AC-10)`；`planner.test.ts › AC-10…`；E2E 全程离线运行 |
| AC-11 | 导出含中文的 CSV | Excel 直接打开不乱码；列与筛选一致 | 接口测试 | `records.test.ts › CSV export (AC-11)`；`runtime.test.ts › exports CSV with BOM, escaping and formula-injection guard (AC-11)` |
| AC-12 | 按 README 从干净克隆启动 | 10 分钟内跑通 | 手动，录屏留证 | 2026-11-11 手动：从 GitHub 克隆到空目录，空 npm 缓存，无 `.env`，约 1.5 分钟跑完全部步骤（见 roadmap 阶段 6）。录屏待补 |
| AC-13 | 模型返回不合法 JSON 或校验失败 | 自动修复最多 2 轮，过程在界面可见；仍失败则给出明确错误且不改动应用 | 单测（模拟模型） | `planner.test.ts › validator-in-the-loop (AC-13)`（JSON 修复、类型错误修复、2 轮后放弃且应用不变、模型中断时失败步骤被标记） |
| AC-14 | 修改字段类型 / 删除枚举项；删除字段 | 修改类型、删枚举项：拒绝，`SAFETY_DESTRUCTIVE_SCHEMA`；删除字段（`removeField` 等）属于禁止操作：拒绝，`SAFETY_FORBIDDEN_OP`（protocol.md §6.2、§7） | 单测 | `proposal.test.ts › AC-14: rejects changing a field type or removing enum options`；`removeField` 见 AC-07 同组用例 |
