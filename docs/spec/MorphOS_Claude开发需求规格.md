# MorphOS — 通用应用生成与演进平台（Claude开发需求规格）

# 项目结论与决策摘要

最终决定：开发可运行、可复现的“受约束通用应用生成平台 MVP”，不是只演示动画的概念 Demo，也不是宣称能生成任何软件的完整商业 SaaS。平台支持自然语言创建简单数据管理应用，并能在原有数据不丢失的前提下继续增量演进。

> **一句话价值** 让用户不必编写代码、设计数据库或手动拼接页面，直接通过自然语言获得真正能录入、保存、筛选、统计和导出数据的小应用。

| 确定事项 | 最终口径 |
| --- | --- |
| 产品类型 | 真实全栈MVP：应用中心 + AI编辑器 + Schema驱动运行时 + SQLite数据持久化 |
| 通用边界 | 支持表单、数据表、筛选、简单统计、枚举状态流转、CSV导出；不支持任意复杂软件 |
| 证明通用性 | 同一引擎生成活动报名应用与设备借用应用；不能分别硬编码两套前端 |
| 关键创新 | Intent-to-App、Typed Binding、Verified Morph Diff、Continuous Evolution |
| AI控制 | AI输出结构化配置/受约束Patch，禁止生成后直接运行JS/SQL/脚本 |
| 可回滚范围 | 工作区配置和非破坏性Schema变更；业务记录不因界面回滚被清空 |
| 时间约束 | 按用户给出的2026-11-18省赛截止日期控制范围，优先完成一条完整闭环 |

# 目录与阅读方式

01 产品定位与差异化；02 用户角色与核心流程；03 功能范围与页面信息架构；04 数据与组件通用模型；05 Patch、校验与演进机制；06 技术架构和工程组织；07 API与数据库；08 验收测试和指标；09 7天开发排期；10 比赛交付与演示；11 风险控制；附录A Claude总启动提示词；附录B 分阶段开发Prompt；附录C 推荐CLAUDE.md规则。

# 01  产品定位、痛点与差异化

## 1.1 真实痛点：小型业务应用从需求到可用工具的成本

组织活动、管理设备、管理任务等轻量需求常通过Excel、在线表单和聊天工具拼接完成：字段配置反复、数据拷贝分散，新增一个审批或筛选需求就需要重新配置流程或寻找其他工具。传统开发对非程序员门槛较高；普通AI界面生成器又可能只生成静态页面，无法持续保存和演进业务数据。

## 1.2 为什么不是普通低代码/AI页面生成器

| 比较维度 | 常见静态页面生成 | MorphOS目标能力 |
| --- | --- | --- |
| 生成结果 | 页面、组件或代码预览 | 可运行应用：数据模型 + 界面 + 操作 + 持久化 |
| 变化方式 | 重新生成页面、手工修改 | 基于既有应用生成结构化增量Patch |
| 数据处理 | 常由用户自行对接 | 基于Typed Ports进行声明式绑定与校验 |
| 错误控制 | 不一定解释修改影响 | Morph Diff显示新增/修改/潜在风险，批准后生效 |
| 复用边界 | 常偏单一预设模板 | 同一运行时支持不同业务实体及状态规则 |

注：上述能力中，声明式UI、动态数据绑定、自然语言低代码等均已有成熟研究或产品。此项目不主张全球首创，差异化在于面向轻量业务应用的一体化、可验证、可持续演进的交付体验。

## 1.3 目标用户和非目标用户

目标用户：校园活动组织者、实验室管理员、社团负责人、小团队项目负责人等，需要快速搭建简单表单和数据管理工具的非专业开发者。

非目标场景：支付/订单结算、开放式多租户商业系统、复杂RBAC企业流程、实时协作编辑、任意第三方接口编排、AI自动生成并执行不受审查的程序代码。

# 02  用户故事与端到端产品闭环

## 2.1 场景A：活动报名与现场统计

1. 用户在应用中心输入：“创建一个校园讲座报名系统，包含姓名、专业、手机号、报名状态。”
1. AI提出Data Schema、UI Schema、Action Schema。用户预览Morph Diff后批准，平台创建一个可访问的应用。
1. 用户填写报名表并保存多条记录；刷新页面后数据仍存在。可进行编辑、搜索和导出。
1. 用户追加：“给报名者增加签到状态，并筛选计算机专业且未签到的人，显示统计数量。”
1. AI生成addField、addNode、bind、setFilter等增量Patch；Validator逐条检查后展示变更。
1. 批准后新字段、人员筛选及统计真实可用；原有报名记录保持，旧记录为新增字段采用合理默认值。
1. 用户撤销布局变更时，恢复旧的视图配置；之前的报名记录和真实签到数据仍保留。
## 2.2 场景B：实验室设备借用

1. 用户新建第二个应用：“设备借用管理：设备名称、编号、类别、状态、借用人、借用日期。”
1. 同一引擎生成设备登记表单、设备列表、状态选择与统计，不增加设备专用React页面。
1. 录入设备后，追加：“标出已借出超过7天的设备，增加可借用/已借出/已归还状态。”
1. 系统生成状态枚举、筛选规则及统计卡片；经确认后实际生效。
## 2.3 演示必须出现的异常案例

输入：“删除所有未签到人员记录并重置数据库”。如果AI生成了超出Patch白名单的deleteRecords或dropCollection操作，Validator必须拒绝，提示“界面变更协议不允许对业务记录执行破坏性删除”，并建议改用“只隐藏未签到记录”。这是协议校验，而不是简单关键词识别。

> **闭环验收** 创建应用 → 录入数据 → 自然语言追加需求 → 生成Patch → 验证与预览 → 批准 → 新功能真实可用 → 刷新后数据仍在 → 可撤销配置变更。

# 03  页面结构与功能优先级

## 3.1 三大页面

| 页面 | 必须提供的体验 |
| --- | --- |
| 应用中心 App Hub | 列出已创建应用；创建/打开/重命名应用；最近更新；示例入口 |
| AI Studio | 左侧对话与意图、中央应用预览、右侧Schema和Morph Diff；加载与错误状态可见 |
| 应用运行时 App Runtime | 真实表单、表格、状态修改、筛选、统计、CSV导出；独立于AI模式运行 |

## 3.2 开发范围（P0/P1/P2）

| 级别 | 能力 | 验收定义 |
| --- | --- | --- |
| P0 | 应用中心及多个应用 | 创建两个应用并持久化；刷新或重启后仍可打开 |
| P0 | 动态数据实体与字段 | string/number/date/boolean/enum；合法校验及默认值 |
| P0 | 动态表单、表格与CRUD | 真正创建、查询、编辑、按授权删除单条记录 |
| P0 | 筛选、计数/分组、CSV导出 | 基于受控表达式，结果来自真实记录 |
| P0 | AI生成首版配置与增量Patch | 调用真实API；输出只作为建议，须校验并由用户批准 |
| P0 | Typed Ports + Binding Validator | 类型/字段/循环/来源/副作用白名单检查 |
| P0 | Morph Diff、版本记录、配置回滚 | 展示增改项，恢复旧UI配置而不回滚业务记录 |
| P0 | 离线可运行示例 | 没Key仍能手动使用已有应用，固定样例明显标注为演示数据 |
| P0 | 异常与测试 | 错误Patch拒绝；错误提示清晰；基本自动化测试通过 |
| P1 | 简单状态工作流 | 借出/归还等显式状态变化规则，可做受约束enum状态更新 |
| P1 | 一条主动演进建议 | 检测活动开始或某个状态阈值，建议追加组件，不自动修改 |
| P2 | 可视化拖拽反推意图、跨行业插件、支付、多租户 | 省赛明确不做，作为国赛迭代方向 |

## 3.3 基础组件库：少而真

| 组件 | Typed Input | Typed Output / 实际作用 |
| --- | --- | --- |
| CollectionSource | appId + entityId | RecordSet<Entity>（数据库读取） |
| Filter | RecordSet<T> + FilterDSL | RecordSet<T>（非任意JavaScript） |
| Table | RecordSet<T> + columns | 显示/搜索/编辑（受运行时权限约束） |
| Form | EntitySchema + mode | 有效提交后写入指定实体 |
| Metric / Chart | RecordSet<T> + aggregate | number / grouped counts |
| MessageDraft | RecordSet<T> + text template | 草稿/复制或站内模拟记录；不伪装真实发送 |
| CSVExport | RecordSet<T> | 可下载CSV文件 |
| StatusAction（P1） | Record<T> + AllowedTransition | 状态变化及审计记录 |

# 04  通用数据模型、Schema与数据绑定

## 4.1 AppDefinition（版本化配置）

每个应用包含应用元数据、实体定义、工作区节点、绑定边、操作规则以及版本号。数据配置必须支持稳定ID而不是仅依赖展示名；内部标识使用slug/UUID，避免“重命名字段导致数据丢失”。

```json
{
  "appId": "app_equipment_01",
  "version": 1,
  "name": "设备借用管理",
  "entities": [
    {
      "id": "equipment",
      "label": "设备",
      "fields": [
        {"id": "name", "type": "string", "required": true},
        {"id": "status", "type": "enum", "options": ["可借用", "已借出", "已归还"], "default": "可借用"},
        {"id": "borrowedAt", "type": "date", "required": false}
      ]
    }
  ],
  "nodes": [
    {"id": "source1", "type": "CollectionSource", "params": {"entityId": "equipment"}},
    {"id": "table1", "type": "Table", "params": {"columns": ["name", "status", "borrowedAt"]}}
  ],
  "bindings": [
    {"from": "source1.records", "to": "table1.rows"}
  ]
}
```

## 4.2 Typed Ports与绑定语义

每种组件预先在注册表中声明输入端口、输出端口、数据类型、必填字段、权限和副作用类型。AI只负责推荐节点组合与边连接，运行时负责解释和执行。RecordSet<Entity>只能连接到接收同一实体记录集合的端口；统计组件可接数值聚合结果；不能把人员列表当作金额直接绑定。

字段引用必须以Schema中真实存在的entityId/fieldId为准。绑定图需要进行拓扑排序；不支持循环依赖，发现环时明确报错。对泛型RecordSet<T>做实体一致性检查；必要时通过显式转换组件进行合法类型转换。

## 4.3 筛选DSL与安全边界

```json
{
  "type": "and",
  "conditions": [
    {"fieldId": "major", "operator": "eq", "value": "计算机"},
    {"fieldId": "checkedIn", "operator": "eq", "value": false}
  ]
}
```

只允许eq/ne/gt/gte/lt/lte/contains/in及and/or等明确支持的操作；禁止eval、原始SQL、任意脚本、动态import等。字段类型与操作符兼容性必须校验，运行时使用安全的查询/过滤函数，避免SQL注入和表达式注入。

## 4.4 数据与配置分离

应用配置（Schema、组件布局、绑定、版本）和业务记录独立存储。数据记录建议采用“entityId + JSON payload + recordId + createdAt/updatedAt”通用存储模式，适合一周内构建受约束低代码引擎；所有写入在服务端根据当前Schema进行验证。多实体关联、复杂索引和大规模性能优化留到后续版本。

新增字段采用非破坏性迁移：可空，或设置合法默认值。删除字段、修改字段类型等高风险Schema变更在省赛直接拒绝或标为“不支持”，不应假装能够零风险回滚。

# 05  Intent-to-App、Patch与Morph Diff

## 5.1 核心流水线

输入意图/既有配置 → Intent Parser → Capability Planner → Patch生成 → JSON Schema/Zod校验 → Typed Ports/Binding Validator → 副作用与权限校验 → Morph Diff预览 → 人工批准 → 原子写入配置版本 → Runtime渲染与执行。

## 5.2 Patch允许的操作

| 操作 | 含义 | 执行规则 |
| --- | --- | --- |
| addEntity | 新增实体 | 禁止与已有entityId冲突 |
| addField | 为实体增加字段 | 必须可空或有有效默认值；不得隐式删除旧值 |
| addNode / removeNode | 添加或移除UI节点 | 仅从组件白名单选择；移除组件不删除记录 |
| moveNode / setParams | 修改布局或组件参数 | 布局需有边界，参数遵循组件Schema |
| bind / unbind | 连接或断开类型化端口 | 双方端口存在、类型匹配、图无环 |
| setFilter / setView | 配置筛选与显示 | 字段和操作符必须在白名单 |
| addTransition（P1） | 增加有限状态转换 | 校验状态集合和权限 |
| 禁止：dropCollection/deleteRecords/rawCode/rawSQL | 破坏性操作或任意执行 | Validator无条件拒绝，业务删除仅由独立授权接口完成 |

## 5.3 Patch示例：新增工作区并绑定已有记录

```json
{
  "baseVersion": 2,
  "reason": "筛选计算机专业未签到人员并生成草稿",
  "operations": [
    {"op": "addNode", "id": "filter1", "type": "Filter", "params": {"entityId": "attendee"}},
    {"op": "setFilter", "nodeId": "filter1", "filter": {"type": "and", "conditions": [
      {"fieldId": "major", "operator": "eq", "value": "计算机"},
      {"fieldId": "checkedIn", "operator": "eq", "value": false}
    ]}},
    {"op": "addNode", "id": "draft1", "type": "MessageDraft", "params": {"template": "同学你好，请尽快完成签到。"}},
    {"op": "bind", "from": "source1.records", "to": "filter1.records"},
    {"op": "bind", "from": "filter1.result", "to": "draft1.recipients"}
  ]
}
```

## 5.4 Validator检查清单

- JSON结构正确、schemaVersion/baseVersion与目标应用匹配，拒绝并发覆盖过期版本。
- 所有组件ID、实体ID、字段ID真实存在或在本次Patch中合法新增，不允许悬空引用。
- 组件注册表白名单、参数类型、Typed Ports连接合法，绑定图无不支持的循环。
- 字段筛选操作符/值类型匹配、枚举值有效、权限及副作用范围满足规则。
- 不允许未经明确批准写业务数据，不允许AI通过Patch直接操作数据库。
- Validator失败返回可理解原因和建议修改方式；不能仅返回500或“失败”。
## 5.5 Morph Diff与版本语义

Morph Diff应至少显示：新增组件、移除/重排组件、数据字段/筛选条件变化、新增绑定边、兼容性和风险提示。用户可以批准、修改意图、拒绝。批准后写入新的配置快照与审计记录。UI配置回滚可以恢复布局、节点和绑定；已发生的真实业务写入不会被回滚。字段新增不应在回滚时破坏性丢失数据；采用“历史配置重新激活、当前数据保留”的语义。

# 06  技术架构、仓库和工程规范

## 6.1 推荐技术栈

| 层次 | 建议方案 | 选择理由 |
| --- | --- | --- |
| 前端 | React + TypeScript + Vite | 启动快、适合动态组件运行时 |
| 交互UI | Tailwind CSS + shadcn/ui + Framer Motion | 卡片与差异动画；避免为了炫酷牺牲性能 |
| 节点视图 | React Flow（可选） | 绑定关系调试或查看，不必先做复杂可视化编辑器 |
| 后端 | Node.js + Express + TypeScript | 前后端共享类型和Schema；减少多语言维护 |
| 数据库 | SQLite + 轻量ORM/SQL访问层 | 本地快速复现，适合个人赛 |
| 验证 | Zod + 服务端业务校验 | 严格限制模型输出与写入 |
| 模型 | OpenAI兼容接口的真实LLM API | API Key通过环境变量注入，禁止写死 |
| 测试 | Vitest + Supertest + Playwright（最少一条E2E） | 自动验证业务保存与非法变更阻断 |

## 6.2 逻辑组件

前端：App Hub、Studio、Runtime Renderer、Morph Diff、Version History、Error UI。后端：App Service、Entity/Data Service、AI Planner Adapter、Patch Validator、Version Service、Export Service。共用schemas/保存所有Zod校验、组件注册表和基本领域类型。

## 6.3 推荐仓库结构

```text
morphos/
  apps/
    web/             # React工作台、运行时UI
    server/          # Express API、AI调用、版本与记录服务
  packages/
    shared/          # AppDefinition、Patch、Zod及组件端口定义
  tests/
    fixtures/        # event / equipment / invalid-patch样例
    e2e/             # 至少一个端到端场景
  docs/
    requirements.md  # 本文档对应的开发规格
    prompts/         # 原始AI交互记录导出/截图索引
    decisions/       # 关键架构决策与bug修复记录
  .env.example
  CLAUDE.md
  README.md
```
## 6.4 外部依赖与异常降级

无API Key时，应用运行、数据操作、预置样例和验证测试仍可使用；“自然语言生成新应用”在无Key时不可用，应明确显示“未配置模型API”。可提供标注为“固定演示样例”的离线Patch用于复现，而不得冒充实时模型生成。出现API错误时不修改当前应用，返回重试建议与原有有效版本。

# 07  数据库设计和后端API

## 7.1 建议持久化表

| 表/实体 | 关键字段 | 用途 |
| --- | --- | --- |
| applications | id, name, created_at, updated_at, active_version | 应用元数据 |
| app_versions | app_id, version, definition_json, created_at, reason | 完整应用配置快照 |
| collections | id, app_id, entity_id | 实体注册与隔离 |
| records | id, app_id, entity_id, data_json, created_at, updated_at | 通用业务数据（每次服务端Schema验证） |
| change_requests | id, app_id, base_version, patch_json, status, errors_json | AI变更提案/批准/拒绝 |
| audit_events | id, app_id, actor, event_type, detail_json, created_at | 重要操作审计 |

## 7.2 推荐API

| Method/Path | 能力 | 要点 |
| --- | --- | --- |
| POST /api/apps | 创建应用或草稿 | 只接受校验后的AppDefinition |
| GET /api/apps / GET /api/apps/:id | 列表与详情 | 返回当前有效配置版本 |
| POST /api/apps/:id/ai/plan | AI生成Patch建议 | 返回proposal，绝不直接落库 |
| POST /api/apps/:id/patches/validate | 校验变更 | 返回errors/warnings/diff |
| POST /api/apps/:id/patches/:proposalId/approve | 提交批准变更 | 校验baseVersion且原子提交新配置 |
| GET /api/apps/:id/versions | 历史与版本 | 支持选取旧UI配置 |
| POST /api/apps/:id/versions/:v/restore | 配置恢复 | 不修改业务记录 |
| GET/POST /api/apps/:id/entities/:entity/records | 查询/新增数据 | 严格服务端字段和权限校验 |
| PATCH/DELETE /api/apps/:id/entities/:entity/records/:rid | 编辑/授权删除 | 独立业务端点，不接受AI Patch调用 |
| GET /api/apps/:id/entities/:entity/export | CSV导出 | 遵循当前筛选及字段配置 |

实现时统一返回明确的成功/失败结构，错误至少包含code、message、details；所有写操作用数据库事务保障一致性。对于动态筛选，API可以由受控DSL驱动，不暴露原始SQL。

# 08  验收标准、自动测试与评价指标

## 8.1 必须通过的验收用例

| 编号 | 输入/操作 | 期望结果 |
| --- | --- | --- |
| AC-01 | 自然语言生成活动报名应用 | Schema合法、能打开真实表单/表格 |
| AC-02 | 新增报名记录并刷新/重启 | 记录仍存在且字段值一致 |
| AC-03 | 新增签到字段与筛选逻辑 | 原数据不丢失；新字段有默认值；筛选正确 |
| AC-04 | 从0生成设备借用应用 | 无场景专用React页面；能录入设备与修改状态 |
| AC-05 | 绑定RecordSet到不兼容端口 | Validator拒绝并解释类型不匹配 |
| AC-06 | 绑定节点形成非法环 | 拒绝，不应用Patch |
| AC-07 | AI提出dropCollection/deleteRecords | 拒绝；数据库记录不变 |
| AC-08 | Patch的baseVersion过期 | 拒绝冲突或提示重新规划 |
| AC-09 | 批准后回滚UI配置 | 旧工作区恢复；业务记录保持不变 |
| AC-10 | 关闭AI Key运行已有应用 | CRUD、筛选、导出、历史记录仍正常 |
| AC-11 | 导出数据 | CSV字段与记录匹配；中文内容编码正常 |
| AC-12 | 运行README的启动命令 | 从干净环境在10分钟内启动并跑通示例 |

## 8.2 建议评测指标

生成成功率（合法AppDefinition比例）、Patch通过率（合理需求获得有效提案比例）、数据保持率（新增字段/视图后旧记录完整比例）、任务完成率（可执行操作达成比例）、非法操作阻断率、配置回滚正确率、P50/P95响应时间、首屏可用时间。所有指标以实际测试为准，不得预填虚假百分比。

建议整理至少10个创建类需求、10个变更类需求、5个非法或边界用例；标记模型、温度、提示词版本、是否使用固定示例，确保结果可解释。

# 09  7天推进计划与砍功能原则

| 日期 | 当日交付 | 验收门槛 |
| --- | --- | --- |
| 11月11日 | 架构/Schema/Patch/CLAUDE.md/样例验收定义 | 共享类型可以编译；协议与组件端口表冻结v0 |
| 11月12日 | 数据库和通用记录CRUD、动态Schema | 无AI也能创建实体并持久化记录 |
| 11月13日 | 动态Form/Table/Filter/Metric/Export组件 | 活动和设备两类记录都可跑通 |
| 11月14日 | AI Planner + Patch Zod校验 + Typed Binding | 一条真实模型需求生成合法Patch并可拒绝错误 |
| 11月15日 | Morph Diff预览/批准/版本历史/回滚 | 演进后数据保留；错误Patch被拦 |
| 11月16日 | UX打磨与自动测试、离线降级 | E2E和异常测试通过；页面不卡顿 |
| 11月17日 | README、真实Prompt证据、技术PDF、演示视频 | 10分钟复现；视频至少2分钟展示AI编码过程 |
| 11月18日 | 提交检查与备份 | 仓库可访问；链接/视频/资料齐全 |

> **砍功能顺序** 遇到进度风险时先删除拖拽编辑器、主动推荐、复杂审批、消息通道、额外图表动画；坚决保留真实CRUD、AI增量Patch、Validator、Morph Diff和双场景共用引擎。

# 10  比赛资料与演示视频

## 10.1 过程证据链要求

每完成一个核心模块就提交Git：需求/Prompt → AI建议或修改 → 实施代码 → 验证结果/错误 → 修复 → Git commit。至少记录3条真实、完整的核心迭代Prompt链；不能事后伪造AI修改或Bug。Git历史必须细粒度，不做包含全部功能的一次性initial commit。

建议真实Prompt链：① 通用数据模型与动态表单；② Typed Binding与Patch Validator；③ Morph Diff/版本回滚与真实Bug修复。每条记录起始需求、用户约束、AI回应、生成文件、运行测试、出现的问题及追问、最终commit SHA。

## 10.2 提交材料清单

| 材料 | 必备内容 |
| --- | --- |
| 代码仓库 | GitHub/Gitee公开或授权评审访问；完整提交历史 |
| Prompt记录 | 至少3个核心功能完整交互历史或导出/截图/录屏 |
| README.md | 10分钟复现：依赖、系统版本、安装、启动、测试、.env.example、无Key模式说明 |
| 5–8分钟MP4视频 | 1080p；真实功能演示 + 至少2分钟AI编码/调试复现 |
| 技术PDF（≤30页） | 痛点、创新、架构、意图控制、测试结果、复现与局限 |
| 安全与真实性声明 | 无真实短信伪装、AI离线样例明确标注、演示数据为样例 |

## 10.3 建议7分钟视频脚本

| 时间 | 内容 |
| --- | --- |
| 0:00–0:45 | 痛点：不同轻量业务都要重复搭表单和流程；产品定位 |
| 0:45–2:00 | 自然语言创建活动报名应用、真实填写记录并刷新验证 |
| 2:00–3:20 | 自然语言增加签到字段/筛选/统计；Morph Diff批准并显示数据保持 |
| 3:20–4:10 | 非法Patch被Validator拒绝，改为隐藏显示后成功 |
| 4:10–4:45 | 从0创建设备借用应用，证明同一引擎的通用性 |
| 4:45–6:50 | 展示2分钟以上真实AI编码/修Bug过程、对应Git提交与测试 |
| 6:50–7:10 | 架构、复现命令与后续迭代方向 |

# 11  风险清单与技术纪律

| 风险 | 典型表现 | 预防措施 |
| --- | --- | --- |
| 只生成漂亮UI | 点击按钮没有真实结果 | 先做CRUD与动态模型，再接AI |
| 伪通用 | 两个场景各有一套业务代码 | 同一Entity/Component/Action引擎，场景只体现为Schema数据 |
| 模型输出失控 | 生成JS/SQL或不存在的字段 | Zod+端口图校验+Patch白名单+人工确认 |
| 数据损坏 | 新增字段、回滚删除旧数据 | 非破坏性迁移、配置/数据分离、事务 |
| 演示不稳定 | API超时导致界面空白 | 已有App无Key可用；固定样例标注；错误不修改有效配置 |
| 性能和范围失控 | 过多组件及复杂功能 | 只交付6–8个组件，延后拖拽/插件生态 |
| 评分证据不完整 | 最后一天补Git与Prompt | 每天真实提交，保留原始会话记录 |

# 附录A  可直接交给Claude Code的项目总提示词

使用方法：将下方整段提示词粘贴到Claude Code / Claude CLI。如果你同时将此文档的“开发需求规格.md”置于项目docs/requirements.md，可要求Claude先阅读；提示词已包含核心边界，即使暂时没放文档也能启动阶段0。

```text
你现在担任我的资深全栈架构师、AI Coding 工程师和测试负责人。请在当前仓库从0到1实现 MorphOS（意图驱动的通用轻量应用生成与演进平台），面向全国高校 Vibe Coding 挑战赛研究生组，截止2026-11-18。目标是“可运行、可测试、可复现的全栈 MVP”，不是只会演示动画的静态 Demo，也不是无限制生成任何软件的商业 SaaS。

【产品与验收目标】
用户通过自然语言创建表单/数据管理类小应用，生成的应用能够真实完成新增、查询、修改、受权删除、筛选、计数统计、CSV导出，并把记录持久化。用户可以继续输入修改需求，AI生成增量Patch，系统校验后展示Morph Diff，等待用户明确批准再应用。必须用同一套通用引擎实现两个不同实例：①校园活动报名+签到；②实验室设备借用+借还状态，不能分别硬编码两套业务页面。已有应用在没有AI Key时也要正常运行。

【核心架构，不许偏离】
1) 技术栈优先 React + TypeScript + Vite + Tailwind/shadcn/ui；Node.js + Express + TypeScript；SQLite；Zod；Vitest/Supertest；至少一条Playwright E2E。允许依据当前仓库作等价、理由充分的调整。
2) 采用Schema-driven通用运行时：AppDefinition包含entities(fields: string/number/date/boolean/enum)、nodes、typed bindings、view配置、actions及version。数据与应用配置分离保存。
3) AI只输出结构化AppDefinition或Patch提案，不得直接生成、eval或执行任意JS、SQL、shell。Patch操作白名单包括addEntity/addField/addNode/removeNode/moveNode/setParams/bind/unbind/setFilter/setView；禁止dropCollection/deleteRecords/rawSQL/rawCode。
4) 组件注册表至少包含CollectionSource、Filter、Table、Form、Metric、MessageDraft、CSVExport；每个组件具有明确typed输入输出端口。Validator校验Zod、实体/字段引用、参数、端口类型、绑定DAG无环、版本冲突、权限与副作用范围；错误要可读。
5) Morph Diff需要呈现节点/字段/绑定的增改及风险，AI提案先预览再人工批准。界面配置版本可恢复，但已有业务记录不得因为UI回滚被删除。新增字段仅支持可空/有默认值等非破坏性迁移；删除或改类型暂不支持。
6) UI必须完成三个页面：App Hub、AI Studio（对话/应用预览/Schema与Diff）、App Runtime。真实数据处理优先于动画。消息发送仅实现草稿、复制或明确标注的站内模拟，不伪装短信微信真实发送。
7) 支持真实LLM API（通过.env读取可替换的OpenAI兼容endpoint/model/key）。无Key时能启动、使用已有应用、加载清晰标注的固定示例和运行测试；不得将预设样例冒充实时AI生成。

【请严格分阶段推进】
阶段0：先检查目录、运行环境和现有代码；若为空仓库，则初始化最小monorepo。先生成 docs/requirements.md、docs/architecture.md、CLAUDE.md、docs/acceptance-tests.md、.env.example 和一份精简任务清单。标注假设、风险与不做的功能。不要在这一阶段一口气生成全部项目。
阶段1：定义共享AppDefinition/Patch/Zod Schema/Typed Port注册表，补最小单元测试。
阶段2：完成SQLite存储与通用实体CRUD API、Schema校验和动态Form/Table/Filter/Metric/CSVExport；用两个领域的数据证明通用。
阶段3：完成AI Planner的真实接口、Patch Validator、Morph Diff、approve和配置版本历史，保证业务数据独立保存。
阶段4：实现并打磨Studio UI、错误态、加载态、必要的变形动画、无Key降级和非法Patch拦截演示。
阶段5：按验收清单运行单元/API/E2E测试，修复真实错误，并准备README、完整复现命令、演示样例和技术说明。

【工程纪律】
- 每个阶段结束必须先运行适用的lint/typecheck/tests，修复失败后才进入下一阶段；没有运行过的测试不得声称通过。
- 每次提交只包含一个相对独立的功能，使用清晰的Git commit信息；不得一次性提交全部功能，也不要重写/伪造Git历史。
- 保留真实AI交互Prompt记录、关键决策和实际Bug修复过程，便于赛后导出。
- 所有写数据的操作由服务端校验，并通过事务提交。未批准Patch不能修改有效应用配置。
- 优先完成“创建应用→录入记录→增量变更→Diff审批→新功能真实可用→刷新数据保留→配置回滚”闭环。
- 如时间不足，先砍拖拽画布、主动阶段建议、复杂审批、短信邮件、商业化功能；不可砍真实CRUD、同引擎双场景、Patch校验、Morph Diff和基础测试。

【第一次回复具体要求】
请先审视当前仓库，给出：A.你判断的现状；B.分阶段文件清单与依赖；C.最小可运行里程碑及验收方式；D.最危险的3个工程风险。然后立即完成阶段0的文件落地，并展示新增文件、可运行的命令和本阶段检查结果。不要凭空宣称已运行/已提交；如需要API Key，先用.env.example占位，不要索要明文密钥。后续我会逐阶段继续下达指令。
```

# 附录B  与Claude迭代的三个补充提示词

## 阶段1：先冻结协议

请先只实现 shared package 的 AppDefinition、FieldSchema、Node、TypedPorts、Binding、Patch 的Zod Schema与Validator骨架，并提供至少5条单元测试（合法绑定、字段缺失、端口不兼容、循环、非法操作）。先不要做漂亮UI。每处设计明确说明如何支持多个业务场景以及版本兼容。测试通过后才建议进入下一阶段。

## 阶段2：证明同一引擎真正通用

请基于同一通用Schema与Runtime，先创建活动报名与设备借用两个fixtures，不要编写EventPage/EquipmentPage这类专用页面。完成记录新增、刷新保留、列表筛选、更新、导出；给出两组HTTP或Playwright可重现实测步骤。保留项目已有实现，避免大范围重构。

## 阶段3：Morph Diff与阻断演示

请实现AI Patch提案→校验→差异预览→人工批准→配置版本快照→恢复旧UI配置的完整闭环。新增一条非法Patch用例，验证deleteRecords/dropCollection/rawCode被拒绝且业务记录不变。记录真实测试失败与修复的Prompt链，但不要伪造错误，也不要把UI配置恢复等同于业务数据回滚。

# 附录C  CLAUDE.md建议约束摘要

- 产品必须保持通用运行时，不准为活动/设备分别硬编码页面。
- 所有AI配置变更先生成提案，必须通过Zod+业务Validator和用户批准后应用。
- 不允许任意执行模型生成的SQL/JS/脚本；只允许已注册组件和Action。
- 业务数据与界面配置分离；UI回滚不自动回滚CRUD产生的业务记录。
- 新字段先做兼容性与默认值处理，禁止静默破坏性Schema迁移。
- 每次阶段开发前说明目标与验收，结束后实际运行相应测试并汇报结果。
- 真实Git提交记录和AI协同过程留痕；不能伪造Bug、历史记录或测试结果。
- 截止日期前，以真实业务闭环、双场景通用性、非法Patch阻断、稳定演示优先。
# 实施成功的最终判定

当评委能够使用MorphOS，在同一平台中从0生成两个不同的小型业务应用，填写的数据真实保存；随后对其中一个应用提出新的自然语言需求，观察增量Patch、Validator和Morph Diff，经确认后立即使用新功能，且旧数据与配置恢复语义正确时，本项目达到了省赛MVP的目标。

> **最终定位** 这是一款面向轻量表单与数据管理场景的通用AI应用生成与演进平台，而非展示几套硬编码Demo的模板网站。
