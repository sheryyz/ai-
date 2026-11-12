# MorphOS 协议规范 v1.1（schemaVersion = 1）

> 本文件定义 AppDefinition、组件端口、筛选 DSL、Patch、校验结果和 Morph Diff。
> 阶段 1 将其逐条实现为 `packages/shared` 中的 Zod Schema 与纯函数；**代码与本文件不一致时，先改本文件再改代码**。
>
> **v1.1（2026-11-11，ADR-0007）**：新增角色视图（§2.2、§3.1）、敏感字段标记、视图相关 Patch（§6.1）、L7 暴露校验（§7）、Diff 暴露栏（§8）与视图访问规则（§11）。新增内容全部是可选字段，v1 定义无需迁移即合法，`schemaVersion` 不变。实现进度见 `roadmap.md`。

## 0. 设计原则

1. **AI 只产出数据，不产出代码。** 模型输出只能是本协议定义的 JSON，由系统解释执行。
2. **配置与数据分离。** AppDefinition 描述“应用长什么样、怎么连”；业务记录独立存储，协议中**不存在任何能修改业务记录的操作**。
3. **稳定 ID。** 字段、节点、绑定都用不变的 slug ID 引用，显示名可随意改，避免“改名丢数据”。
4. **只增不毁。** Schema 演进只支持非破坏性变更；删除字段、改字段类型一律拒绝。
5. **前后端同一套逻辑。** 校验、Patch 应用、Diff、筛选求值、绑定图求值全部是 `packages/shared` 中的纯函数，浏览器与服务器共用。
6. **可见范围靠计算，不靠模型自述。** 每个角色视图能逐条看到、只能统计、能修改哪些字段，由系统从组件与绑定**算出来**（§11.1）。越过用户声明的界限即拒绝；让持链接的人看到敏感字段，必须由人显式确认。

## 1. 标识符

```
Slug := /^[a-z][a-zA-Z0-9_]{0,39}$/      例：attendee, checkedIn, filter_unchecked
保留字段 ID：id, createdAt, updatedAt   （系统字段，只读，可在列、排序、筛选中引用）
```

## 2. AppDefinition

```ts
interface AppDefinition {
  schemaVersion: 1
  name: string                 // 1..40 字
  description?: string         // ≤ 200 字
  icon: IconName               // 白名单图标名，如 "calendar" | "flask" | "package" | "users" ...
  entities: EntityDef[]        // 省赛限定恰好 1 个；数组形态为国赛多实体预留
  nodes: NodeDef[]             // ≤ 32（v1 为 24；视图组件计入总数）
  bindings: Binding[]          // ≤ 48
  views?: ViewDef[]            // ≤ 6，角色视图（§2.2）；缺省视为 []
}
```

应用 ID 与版本号**不在** AppDefinition 内，而由存储层管理（`apps.id`、`app_versions.version`）。

### 2.1 EntityDef / FieldDef

```ts
interface EntityDef {
  id: Slug
  label: string                // 如 “报名者”
  displayField: Slug           // 作为记录标题的字段，必须是 string 类型字段
  fields: FieldDef[]           // 1..30
}

type FieldType = 'string' | 'text' | 'number' | 'date' | 'boolean' | 'enum'

interface FieldDef {
  id: Slug
  label: string
  type: FieldType
  required: boolean
  default?: FieldValue         // 类型须与 type 一致；enum 须在 options 内
  options?: string[]           // 仅 enum，1..20 个，不重复
  description?: string
  sensitive?: boolean          // 个人敏感信息，默认 false；含义与用途见 §11.3
}

type FieldValue = string | number | boolean | null   // date 以 'YYYY-MM-DD' 字符串存储
```

**默认值的“虚拟填充”语义：** 新增字段时不回写旧记录。读取记录时，缺失字段按 `default ?? null` 补齐。因此新增字段零迁移成本，恢复旧版本也不会丢任何数据。

### 2.2 ViewDef（角色视图）

一个视图是“给某一类人用的页面”，通过分享链接访问（§11.4）。未归属任何视图的组件构成**管理页**，即 v1 的运行界面，行为不变。

```ts
interface ViewDef {
  id: Slug
  label: string                // 1..20 字，页面名，如 “报名页”“签到台”
  audience: string             // 1..20 字，面向谁，如 “报名的同学”“门口志愿者”；显示在 Diff 暴露栏
  description?: string         // ≤ 100 字，显示在分享页顶部
  restrictedFields?: Slug[]    // 用户明确禁止此视图接触的字段：既不能逐条看到，也不能修改（§11.2）
}
```

`restrictedFields` 只在用户明确表达禁令时填写（如“别让志愿者看到手机号”），模型不得自行推断；它把一句话里的禁令变成此后每次改动都要通过的约束。

## 3. 节点与布局

```ts
interface NodeDef {
  id: Slug
  type: ComponentType
  title?: string
  region?: 'main' | 'aside'     // 可视组件必填；无界面组件（CollectionSource）忽略
  order?: number                // 同区域内升序排列
  width?: 'full' | 'half'       // 仅 main 区域，默认 full
  hidden?: boolean              // 隐藏只影响显示，不影响数据流
  view?: Slug                   // 所属角色视图（§2.2）；缺省 = 管理页
  params: Record<string, unknown>   // 按组件类型校验，见 §4
}
```

### 3.1 页面

| 页面 | 包含的组件 | 布局 | 访问 |
|---|---|---|---|
| 管理页 | 所有未设置 `view` 的可视组件 | 与 v1 相同：`region` / `order` / `width` | 平台内 `/apps/:id`，仅本机（ADR-0008） |
| 视图页 | `view` 等于该视图 id 的可视组件 | 单列、按 `order` 升序（手机优先）；`region` / `width` 可省略，写了也忽略 | 分享链接 `/v/:token`（§11.4） |

- `CollectionSource` 等无界面组件不属于任何页面，设置 `view` 视为错误（`REF_VIEW_NOT_ALLOWED`）。
- 绑定可以跨页面：视图组件可以接入管理页组件或无界面组件的输出。数据只沿绑定流动，页面归属只决定“在哪里显示、谁能操作”。
- 组件不能在页面之间移动；需要时在目标页面新增组件。

## 4. 组件注册表与类型化端口

端口类型：

```
RecordSet<E>   某实体 E 的记录集合（E 由数据源推导，沿绑定边传播）
Number         一个数值
```

| 组件 | 有界面 | 输入端口 | 输出端口 | 关键 params | 副作用 |
|---|---|---|---|---|---|
| **CollectionSource** | 否 | — | `records: RecordSet<E>` | `entityId`, `sort?: {field, dir}` | 读取 |
| **Filter** | 是（条件标签条） | `input: RecordSet<E>` ✱ | `result: RecordSet<E>` | `filter: FilterExpr`, `showChips` | 无 |
| **Table** | 是 | `rows: RecordSet<E>` ✱ | — | `columns: Slug[]`, `searchable`, `editable`, `allowDelete`, `pageSize` | 更新 / 删除记录（用户在界面确认） |
| **Form** | 是 | — | — | `entityId`, `fields: Slug[]`, `submitLabel`, `successMessage?` | 新增记录 |
| **Metric** | 是 | `rows: RecordSet<E>` ✱ | `value: Number` | `label`, `aggregate`, `field?`, `where?`, `format`, `goal?` | 无 |
| **Chart** | 是 | `rows: RecordSet<E>` ✱ | — | `kind: 'bar'\|'donut'`, `groupBy: Slug` | 无 |
| **QuickAction** | 是 | `rows: RecordSet<E>` ✱ | — | `label`, `searchFields`, `ask?: Slug[]`, `set: Record<Slug, Value\|Token>`, `availableWhen?: FilterExpr`, `buttonLabel` | 更新记录 |
| **MessageDraft** | 是 | `recipients: RecordSet<E>` ✱ | — | `template`（可含 `{{fieldId}}`）, `channelLabel` | 写入模拟发件箱 |
| **CSVExport** | 是（按钮卡片） | `rows: RecordSet<E>` ✱ | — | `columns?: Slug[]`, `filename`（不含扩展名，末尾的 `.csv` 会被规范化去掉） | 无（下载文件） |

✱ = 必须恰好有一条绑定接入。

补充规则：

- **Metric.aggregate**：`count | sum | avg | min | max | ratio`。`sum/avg/min/max` 需要 `field` 且为 number；`ratio = count(where) / count(rows)`，需要 `where`，`format` 通常为 `percent`。
- **QuickAction 是通用的“一键改状态”**。签到 = `set: {checkedIn: true}`；借出 = `ask: [borrower]`, `set: {status: "已借出", borrowedAt: "$today"}`, `availableWhen: status = 可借用`。值令牌：`$today`、`$now`。
- 所有 params 中引用的字段 ID 必须属于该节点输入端口推导出的实体 E。
- **视图中的 Table 只读**：省略 `editable` / `allowDelete` 时按 `false` 处理（与管理页的默认值不同）；显式写 `true` 被 L7 拒绝（§11.2）。分享页改记录只能通过 QuickAction，因为它预先限定了能改哪些字段、改成什么。

### 4.1 绑定

```ts
interface Binding {
  id: Slug
  from: { node: Slug; port: string }   // 输出端口
  to:   { node: Slug; port: string }   // 输入端口
}
```

合法性：两端节点存在；端口存在且方向正确；类型兼容（`RecordSet<E>` 只接 `RecordSet<E>`，同一 E）；每个输入端口至多一条绑定；整张图无环。

## 5. 筛选 DSL

```ts
type FilterExpr = FilterGroup | Condition

interface FilterGroup { op: 'and' | 'or'; conditions: FilterExpr[] }   // 1..10 项，嵌套深度 ≤ 3

interface Condition {
  field: Slug                  // 可为保留字段 createdAt / updatedAt
  operator: Operator
  value?: FieldValue | FieldValue[] | RelativeDate
}

type RelativeDate =
  | { relative: 'today' }
  | { relative: 'daysAgo'; days: number }
  | { relative: 'daysFromNow'; days: number }
```

| 字段类型 | 允许的操作符 |
|---|---|
| string / text | `eq ne contains notContains startsWith in notIn isEmpty notEmpty` |
| number | `eq ne gt gte lt lte isEmpty notEmpty` |
| date | `eq ne gt gte lt lte isEmpty notEmpty`（值可为 RelativeDate） |
| boolean | `eq ne` |
| enum | `eq ne in notIn isEmpty notEmpty`（值必须在 options 内） |

求值是纯函数 `evaluateFilter(expr, record, entity, now)`，**不使用 eval、不拼接 SQL**；服务器导出 CSV 与浏览器渲染调用同一实现。

例：计算机专业且未签到

```json
{ "op": "and", "conditions": [
  { "field": "major", "operator": "eq", "value": "计算机" },
  { "field": "checkedIn", "operator": "eq", "value": false }
]}
```

例：借出超过 7 天

```json
{ "op": "and", "conditions": [
  { "field": "status", "operator": "eq", "value": "已借出" },
  { "field": "borrowedAt", "operator": "lt", "value": { "relative": "daysAgo", "days": 7 } }
]}
```

## 6. AI 输出：Proposal

模型每次只能输出以下三种之一：

```ts
type Proposal =
  | { kind: 'create';  intent: string; summary: string; definition: AppDefinition }
  | { kind: 'patch';   intent: string; summary: string; baseVersion: number; operations: PatchOp[] }  // 1..40 项
  | { kind: 'refusal'; intent: string; reason: string; suggestion?: string }
```

### 6.1 允许的 PatchOp

| op | 字段 | 规则 |
|---|---|---|
| `addField` | `entityId`, `field: FieldDef` | ID 不冲突；`required: true` 时必须带合法 `default`；可带 `sensitive` |
| `updateField` | `entityId`, `fieldId`, `changes: {label?, description?, addOptions?, default?, sensitive?}` | enum 选项**只增不减**；不能改 type；`sensitive: false` 取消敏感标记属于放宽，Diff 标为高风险 |
| `addNode` | `node: NodeDef` | 组件在注册表内；params 合法；`node.view` 须指向已有视图 |
| `updateNode` | `nodeId`, `title?`, `params?` | params 浅合并后整体重新校验 |
| `moveNode` | `nodeId`, `region`, `order`, `width?` | 不改变组件所属页面 |
| `addView` | `view: ViewDef` | ID 不冲突；总数 ≤ 6 |
| `updateView` | `viewId`, `changes: {label?, audience?, description?, restrictedFields?}` | `restrictedFields` 整体替换；移出字段属于放宽，Diff 标为高风险 |
| `removeView` | `viewId` | 级联移除该视图的全部组件及其绑定，并在 Diff 中列出；分享链接随即停用（恢复版本可复原） |
| `hideNode` / `showNode` | `nodeId` | 只影响显示 |
| `removeNode` | `nodeId` | 自动级联移除相关绑定，并在 Diff 中以警告列出 |
| `bind` | `binding: Binding` | 见 §4.1 |
| `unbind` | `bindingId` | — |
| `setFilter` | `nodeId`, `filter: FilterExpr` | 目标须为 Filter 节点 |
| `updateApp` | `name?`, `description?`, `icon?` | — |

### 6.2 显式禁止的 op

`deleteRecords` `deleteRecord` `clearData` `resetData` `truncate` `dropEntity` `dropCollection` `dropTable` `removeField` `deleteField` `changeFieldType` `renameFieldId` `rawSQL` `rawCode` `executeScript` `eval` `runShell`

这些名字被 Validator 识别后返回专门的 `SAFETY_FORBIDDEN_OP` 错误与改写建议；**任何未知 op 同样被拒绝**（`SCHEMA_UNKNOWN_OP`）。安全性来自白名单，而非关键词黑名单。

### 6.3 Patch 应用语义

`applyPatch(definition, patch) → definition'` 是纯函数：按顺序应用每个 op，任一 op 失败则整体失败（原子性）。应用后对 `definition'` 做完整校验，再与 `definition` 计算 Morph Diff。

## 7. 分层校验

| 层 | 检查 | 典型错误码 |
|---|---|---|
| L1 schema | JSON 结构、Zod 类型、数量上限、未知 op | `SCHEMA_INVALID` `SCHEMA_UNKNOWN_OP` |
| L2 reference | 节点 / 字段 / 实体 / 绑定 ID 存在且唯一，无悬空引用 | `REF_MISSING_FIELD` `REF_DUPLICATE_ID` |
| L3 type | 端口存在与方向、端口类型与实体一致、操作符与字段类型匹配、枚举值合法、默认值类型 | `TYPE_PORT_MISMATCH` `TYPE_OPERATOR_INVALID` |
| L4 graph | 必需输入已接、单输入单绑定、无环 | `GRAPH_CYCLE` `GRAPH_INPUT_UNBOUND` |
| L5 safety | 禁止 op、破坏性 Schema 变更（删字段、改类型、删枚举项） | `SAFETY_FORBIDDEN_OP` `SAFETY_DESTRUCTIVE_SCHEMA` |
| L6 version | `baseVersion` 等于当前版本 | `VERSION_CONFLICT` |
| L7 exposure | 角色视图的可见与可写范围：受限字段、视图内自由编辑、敏感字段逐条可见（§11.2） | `EXPOSURE_RESTRICTED_FIELD` `EXPOSURE_FREE_EDIT` `EXPOSURE_SENSITIVE_FIELD`（警告） |

视图相关的引用错误归 L2：`node.view` 或 `restrictedFields` 指向不存在的视图或字段（`REF_MISSING_VIEW` `REF_MISSING_FIELD`），无界面组件设置 `view`（`REF_VIEW_NOT_ALLOWED`）。

```ts
interface ValidationIssue {
  level: 'error' | 'warning'
  layer: 'schema' | 'reference' | 'type' | 'graph' | 'safety' | 'version' | 'exposure'
  code: string
  path: string          // 如 "operations[2].binding.to.port"
  message: string       // 面向用户的中文说明
  hint?: string         // 建议的改法，同时回馈给模型用于自修复
}
```

## 8. Morph Diff

由 `computeDiff(before, after, ctx)` 基于**两份完整定义**计算，而非复述 Patch，因此无论 AI 怎么写 Patch，用户看到的都是真实影响。

```ts
interface MorphDiff {
  fromVersion: number
  summary: string
  fields:   { added: FieldDef[]; changed: FieldChange[] }
  nodes:    { added: NodeDef[]; removed: NodeDef[]; changed: NodeChange[]; moved: NodeMove[]; hidden: Slug[]; shown: Slug[] }
  bindings: { added: Binding[]; removed: Binding[] }
  preserved:{ recordCount: number; fieldIds: Slug[] }
  impacts:  Impact[]    // 例：{kind:'defaultFill', field:'checkedIn', value:false, affectedRecords:37}
  views:    { added: ViewDef[]; removed: ViewDef[]; changed: ViewChange[] }   // ViewChange：视图 id + 名称 / 受众 / 说明 / 受限字段的前后值
  exposure: ExposureChange[]   // 每个视图改动前后的暴露对比，见下
  risk:     'low' | 'medium' | 'high'
  confirmExposure: boolean     // true 时批准请求必须带 confirmExposure: true（§11.5）
}

interface ViewExposure {        // computeExposure(definition, viewId) 的结果，§11.1
  viewId: Slug; label: string; audience: string
  read: Slug[]                  // 逐条可见
  aggregate: Slug[]             // 只参与统计（计数、比例、分组），不逐条下发
  write: Slug[]                 // 可新增或修改
  canCreate: boolean            // 视图内有 Form
  sensitiveRead: Slug[]         // read ∩ 敏感字段
  restricted: Slug[]
  nodes: {                      // 页面顺序；每个组件各自的 read / aggregate / write
    nodeId: Slug; type: ComponentType; title?: string
    read: Slug[]; aggregate: Slug[]; write: Slug[]; creates: boolean
    filters: string[]           // 记录范围：上游经过的筛选标题（源头在前），空数组 = 全部记录
  }[]
}

interface ExposureChange {
  viewId: Slug; label: string; audience: string
  before: ViewExposure | null   // null = 新视图
  after:  ViewExposure | null   // null = 视图被移除
  newlyRead: Slug[]; newlyWritable: Slug[]
  newlySensitive: Slug[]        // 因本次改动变为逐条可见的敏感字段
  loosened: Slug[]              // 移出 restrictedFields 的字段；或取消 sensitive、且该视图逐条可见的字段
  changed: boolean              // 暴露是否有任何变化（界面折叠未变化的视图）
}
```

**风险规则补充**：`newlySensitive` 或 `loosened` 非空 → `risk = 'high'` 且 `confirmExposure = true`；移除视图 → 至少 `medium`；只新增视图且不涉及敏感字段 → 不提高风险。

## 9. 版本语义

- 版本**只追加**。批准提案 → 新版本；恢复旧版本 → 生成一个内容等于旧版本的**新版本**（记录 `restoredFrom`），历史永不改写。
- 恢复只替换 AppDefinition，**不触碰 records 表**。旧版本没有的字段，其数据仍保存在记录中，只是不显示；再次前进即完整恢复。
- 写记录时只校验当前版本的字段；记录中当前版本未知的旧键原样保留。

## 10. 业务数据接口约束

业务记录的增删改只能来自运行界面中的用户操作（Form / Table / QuickAction），经服务端按当前 Schema 校验后在事务中写入。删除为软删除并记录审计事件。**AI 与 Patch 永远无法调用这些接口。**

经分享链接发起的写入同样属于“运行界面中的用户操作”，额外受 §11.4 约束：只能经该视图内的 Form、QuickAction、MessageDraft（模拟发件箱），不能编辑或删除。

## 11. 角色视图：暴露计算与访问

### 11.1 暴露计算

`computeExposure(definition, viewId) → ViewExposure` 是纯函数，只看该视图内**未隐藏**的组件：

| 组件 | 逐条可见 `read` | 仅统计 `aggregate` | 可写 `write` | 记录范围 |
|---|---|---|---|---|
| Table | `columns` | — | —（视图中只读） | `rows` 输入 |
| QuickAction | `displayField` + `searchFields` | — | `set` 的键 + `ask` | `rows` 输入 |
| MessageDraft | `displayField` + 模板中的 `{{字段}}` | — | —（写入模拟发件箱） | `recipients` 输入 |
| CSVExport | `columns`；省略时为**全部字段** | — | — | `rows` 输入 |
| Form | — | — | `fields`（只新增，看不到已有记录） | — |
| Metric | — | `field`、`where` 中的字段 | — | `rows` 输入 |
| Chart | — | `groupBy` | — | `rows` 输入 |
| Filter | — | — | — | —（只显示条件标签与结果数） |

记录范围由该组件的输入沿绑定向上追溯得到：经过的每个 Filter 记一次标题，到 `CollectionSource` 为止。

### 11.2 L7 暴露校验

| 规则 | 级别 | 代码 |
|---|---|---|
| 视图中任一组件逐条可见或可写 `restrictedFields` 中的字段（只参与统计不算） | 错误 | `EXPOSURE_RESTRICTED_FIELD` |
| 视图中的 Table 显式开启 `editable` 或 `allowDelete` | 错误 | `EXPOSURE_FREE_EDIT` |
| 视图让持链接的人逐条看到敏感字段（`sensitiveRead` 非空） | 警告 | `EXPOSURE_SENSITIVE_FIELD` |
| 视图没有任何可见组件（链接打开会显示“已停用”） | 警告 | `EXPOSURE_VIEW_EMPTY` |

错误进入 Validator-in-the-loop 自修复，hint 指出越界的组件与字段。警告不阻止提案生成，但会触发 §11.5 的批准确认。

### 11.3 敏感字段

`sensitive: true` 表示“能定位到具体个人”的信息：手机号、证件号、学号 / 工号、住址、邮箱、精确出生日期等。

- 模型在创建应用或新增字段时按字段含义标记，Diff 中列出被标记的字段，用户可以一句话更正。
- 内置模板预先标记。
- 只影响角色视图：管理页本来就能看到全部字段。
- 经 Form 填写自己的敏感信息不算暴露；只有让别人逐条看到才算。

### 11.4 分享链接与服务端强制

- 每个视图对应一个服务端随机生成的令牌（≥ 128 位，base64url）。令牌**不属于** AppDefinition，不进入版本历史，不出现在提示词与模型输出中；组织者可以“重置链接”，旧令牌立即失效。
- 持链接的请求只能：读取该视图的页面快照，经该视图内组件新增记录、执行快捷操作、导出、写入模拟发件箱。服务端逐项检查组件属于该视图且未隐藏，写入沿用现有的按组件限定规则（Form 只收其 `fields`，QuickAction 只按其 `set` / `ask` 修改其输入范围内的记录）。
- 页面快照由服务端求值后下发：每个组件只下发它 `read` 的字段；统计类组件只下发统计结果；实体结构只含该视图用到的字段。浏览器拿不到快照以外的任何记录数据。
- 视图被移除或所属组件全部隐藏时，链接返回 `410 VIEW_INACTIVE`（“此页面已停用”）；恢复到含该视图的版本后，同一链接重新可用。

### 11.5 批准确认

`MorphDiff.confirmExposure` 为 `true` 时，`POST /api/proposals/:id/approve` 必须带 `{ "confirmExposure": true }`，否则服务端返回 `409 EXPOSURE_CONFIRM_REQUIRED`。确认动作写入审计事件，记录被公开的视图与字段。界面上的勾选框只是这一规则的表现，不是规则本身。
