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

## 修正 6：角色视图与数据暴露（ADR-0007 / 0008）

证据随 R1–R4 实现补齐。

| 编号 | 操作 | 期望 | 自动化 | 证据 |
|---|---|---|---|---|
| AC-15 | 一句话为某类人新增视图（如报名页） | 提案含 `addView` 与归属该视图的组件；Diff 暴露栏列出该视图的可见 / 可写字段；批准后可获取分享链接，管理页不出现视图组件 | 单测 + 接口测试 + E2E | `exposure.test.ts › AC-15: a sign-up page is a view holding a form; the admin page layout is unchanged`；`views.test.ts › a sign-up page accepts only its form fields and answers with nothing but the new id`；`replay.test.ts › replays scenario A end to end…`（录制的真实模型输出：报名页不需要公开确认）；E2E `mainline.spec.ts › 场景 A`（预览自动切到报名页，暴露栏显示“新增分享页”）与 `share.spec.ts`（手机报名页提交成功） |
| AC-16 | 持分享链接读取与写入 | 快照只含视图内组件与其 `read` 字段（响应 JSON 中查不到未暴露字段的值）；经视图外组件、表单外字段、Table 编辑 / 删除的请求被拒绝 | 接口测试 | `view-snapshot.test.ts › AC-16: a check-in desk receives names of eligible people and a rate — never phone numbers`；`views.test.ts › AC-16: the snapshot carries only what the desk shows…` 与 `AC-16: writes go only through components of this view, and come back trimmed`（含视图外组件 5 种请求均 404、无编辑 / 删除接口） |
| AC-17 | 视图让持链接者逐条看到敏感字段 | L7 警告 `EXPOSURE_SENSITIVE_FIELD`，`risk = high`；不带 `confirmExposure` 的批准返回 409，带上后通过并写审计 | 单测 + 接口测试 | `exposure.test.ts › AC-17: showing a sensitive field row by row is a warning…`；`views.test.ts › AC-17: showing student ids on the desk needs confirmation, enforced by the server`（不带确认 409、版本不变；带确认后通过并写审计；恢复到含该暴露的版本同样需要确认）；`replay.test.ts`（录制的 `08-event-export`：模型避开了手机号但带上学号，批准不带确认返回 409）；E2E `mainline.spec.ts › 场景 A`（勾选确认前批准按钮不可用） |
| AC-18 | 视图声明 `restrictedFields` 后，改动让该视图读写受限字段 | L7 错误 `EXPOSURE_RESTRICTED_FIELD`，进入自修复；只参与统计不报错 | 单测 + 接口测试（脚本化模型） | `exposure.test.ts › AC-18: a restricted field may not reach the view row by row, but may feed a statistic`、`AC-18: writing a restricted field is rejected too`；`views.test.ts › AC-18: exporting the full list onto the desk is caught at L7 and repaired by the model`（第 1 轮报错、修复提示含错误码与 columns、第 2 轮通过） |
| AC-19 | 视图中的 Table 显式开启编辑或删除 | L7 错误 `EXPOSURE_FREE_EDIT` | 单测 | `exposure.test.ts › AC-19: tables on a share page default to read-only; opening edit or delete is rejected` |
| AC-20 | 非本机来源访问管理接口 | `403 ADMIN_LOCAL_ONLY`；同一来源访问分享接口正常 | 接口测试 + 手动 | `views.test.ts › AC-20: …`（4 条：管理接口 403、分享与健康检查可用；只看 TCP 对端地址，`X-Forwarded-For` 无效；`ADMIN_ACCESS=any`；share-info）。2026-11-11 手动：临时实例经真实网卡访问，本机 `127.0.0.1` 200、局域网 IP 403、带 `X-Forwarded-For: 127.0.0.1` 仍 403、`/api/health` 200 |
| AC-21 | 恢复到没有该视图的版本，再恢复回来 | 链接先返回 `410 VIEW_INACTIVE`，再次可用且令牌不变；记录全程逐字节一致 | 接口测试 + E2E | `views.test.ts › AC-21: restore to before the desk → 410; restore forward → the same link works again`（记录逐字节一致）与 `hiding every component of a view also makes its link inactive`；E2E `share.spec.ts`（恢复后手机页面显示“此页面已停用”，记录不变） |
| AC-22 | 在分享页签到 | 管理页 5 秒内显示新的签到状态与签到率 | E2E（两个浏览器上下文） | 2026-11-11 手动（Playwright 脚本，生产构建 + 临时库）：手机上下文经局域网 IP 在签到台签到，管理页约 2.9 s 显示新的签到率（轮询 3 s）。自动化：E2E `share.spec.ts`（手机尺寸上下文签到，管理页 5 s 内显示 1 / 6） |
| AC-23 | 演示以外领域的视图请求（评测集 8 条） | 报告暴露正确率与禁令守住率；只写实际结果 | 评测脚本（真实模型） | `eval/results/2026-11-12-deepseek-flash-views.md`（`planner-v1.2`，代码 `e1abb2e`，8 条各 1 次）：结果符合预期 8/8，首轮通过 6/8，暴露正确率 8/8，禁令守住 5/5，禁令写入约束 5/5，公开确认判断 3/3。样本小、只跑 1 次，见 eval/README 局限 |

## 2026-11-16 当前版本回归与新增能力

基线 `363833d`，本轮仅更正文档与整理原始过程证据，未修改业务代码。实际执行：

- `npm run check` 通过：保留 `share.spec.ts` 的一条 `innerText` 警告。
- `npm test`：shared 110、server 90，共 200 条通过。首次受沙箱禁止本机监听影响出现 `listen EPERM`，允许本机测试端口后重跑通过；不是业务故障。
- `npm run test:e2e`：Chromium 7 条通过（约 1.7 分钟），启动时完成生产构建；使用离线模式和内存数据库。构建有大于 500 kB 的分块提示，不影响通过。
- 本次未调用真实模型，未重新干净克隆，也未重新进行手机真机操作。

| 新增能力 | 当前自动化证据 | 边界 |
|---|---|---|
| 持续约束、恢复拦截、业务影响 | `constraints.test.ts`、`impact.test.ts`、`governed-evolution.spec.ts` | 必须先明确解除或调整冲突规则，不自动放宽 |
| 澄清、双方案、局部修复、结果解释、阶段停用 | `guidance.test.ts`、`phases.test.ts`、`explain.test.ts`、`intent-control.spec.ts` | 浏览器流程用受控提案/测试数据，不当作真实模型泛化实验 |
| 单管理员登录及会话 | `auth.test.ts`、`auth.spec.ts` | 本机单管理员，不是多租户/按人授权 |
| 备份恢复、修改密码 | `backup.test.ts`、`auth.test.ts`、`auth.spec.ts` | 恢复为独立副本，原库保留；测试不覆盖用户真实库 |
| 删除应用 | `app-delete.test.ts`、`delete-app.spec.ts` | 用户确认的应用管理动作，与 AI 提案协议禁止删除业务数据不同 |

新增能力历史真实模型证据与局限见 [评测结论](../eval/CONCLUSIONS.md)。所有历史阶段计数保留其日期，不与当前计数混用。

## 2026-11-17 多工作区注册验收

用户要求从单管理员首次设置扩展为每人可注册独立工作区（ADR-0009）。原数据库不迁移，新账号使用旁置目录中的独立 SQLite。

- `npm run check` 通过（保留既有 `innerText` 警告）；`npm test` shared 110 + server 93，共 203 条通过。
- 新增 `workspaces.test.ts`：验证新账号空列表、跨工作区 ID 读取/修改/删除与提案读取/批准/拒绝拒绝访问，约束/阶段/版本/记录/分享管理接口隔离；新工作区公开分享可用；备份只含本账号和本应用；密码修改不撤销其他工作区会话。
- 持久化测试：旧 `/setup` 账号与应用保留，新账号和应用写入独立数据库，关闭重启后会话及用户名登录路由正确。
- 注册边界：网络来源可注册、同源写入头必需、密码长度校验、并发重名只成功一次、注册限流。
- 浏览器新增用例：已存在账号时仍能注册，进入空工作区、创建应用、退出并登录另一个工作区，应用列表不混用。首轮测试定位同时匹配应用卡片和模板标题，改为精确应用链接，并改为独立准备测试账号；没有修改产品预期。
- 测试只使用内存库或临时目录，不向真实用户工作区添加账号或业务数据，未调用真实模型。

最终浏览器验证：完整 8 条 E2E 全部通过（约 1.7 分钟）；补充旧版未初始化数据库保护后，重跑全部 203 条单元/接口测试以及 2 条认证/注册浏览器专项，均通过。远程注册不会接管无账号的旧数据；这类原工作区的首次设置仍仅本机允许。
