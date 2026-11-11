# MorphOS 协议规范 v1（schemaVersion = 1）

> 本文件定义 AppDefinition、组件端口、筛选 DSL、Patch、校验结果和 Morph Diff。
> 阶段 1 将其逐条实现为 `packages/shared` 中的 Zod Schema 与纯函数；**代码与本文件不一致时，先改本文件再改代码**。

## 0. 设计原则

1. **AI 只产出数据，不产出代码。** 模型输出只能是本协议定义的 JSON，由系统解释执行。
2. **配置与数据分离。** AppDefinition 描述“应用长什么样、怎么连”；业务记录独立存储，协议中**不存在任何能修改业务记录的操作**。
3. **稳定 ID。** 字段、节点、绑定都用不变的 slug ID 引用，显示名可随意改，避免“改名丢数据”。
4. **只增不毁。** Schema 演进只支持非破坏性变更；删除字段、改字段类型一律拒绝。
5. **前后端同一套逻辑。** 校验、Patch 应用、Diff、筛选求值、绑定图求值全部是 `packages/shared` 中的纯函数，浏览器与服务器共用。

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
  nodes: NodeDef[]             // ≤ 24
  bindings: Binding[]          // ≤ 48
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
}

type FieldValue = string | number | boolean | null   // date 以 'YYYY-MM-DD' 字符串存储
```

**默认值的“虚拟填充”语义：** 新增字段时不回写旧记录。读取记录时，缺失字段按 `default ?? null` 补齐。因此新增字段零迁移成本，恢复旧版本也不会丢任何数据。

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
  params: Record<string, unknown>   // 按组件类型校验，见 §4
}
```

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
| **CSVExport** | 是（按钮卡片） | `rows: RecordSet<E>` ✱ | — | `columns?: Slug[]`, `filename` | 无（下载文件） |

✱ = 必须恰好有一条绑定接入。

补充规则：

- **Metric.aggregate**：`count | sum | avg | min | max | ratio`。`sum/avg/min/max` 需要 `field` 且为 number；`ratio = count(where) / count(rows)`，需要 `where`，`format` 通常为 `percent`。
- **QuickAction 是通用的“一键改状态”**。签到 = `set: {checkedIn: true}`；借出 = `ask: [borrower]`, `set: {status: "已借出", borrowedAt: "$today"}`, `availableWhen: status = 可借用`。值令牌：`$today`、`$now`。
- 所有 params 中引用的字段 ID 必须属于该节点输入端口推导出的实体 E。

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
| `addField` | `entityId`, `field: FieldDef` | ID 不冲突；`required: true` 时必须带合法 `default` |
| `updateField` | `entityId`, `fieldId`, `changes: {label?, description?, addOptions?, default?}` | enum 选项**只增不减**；不能改 type |
| `addNode` | `node: NodeDef` | 组件在注册表内；params 合法 |
| `updateNode` | `nodeId`, `title?`, `params?` | params 浅合并后整体重新校验 |
| `moveNode` | `nodeId`, `region`, `order`, `width?` | — |
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

```ts
interface ValidationIssue {
  level: 'error' | 'warning'
  layer: 'schema' | 'reference' | 'type' | 'graph' | 'safety' | 'version'
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
  risk:     'low' | 'medium' | 'high'
}
```

## 9. 版本语义

- 版本**只追加**。批准提案 → 新版本；恢复旧版本 → 生成一个内容等于旧版本的**新版本**（记录 `restoredFrom`），历史永不改写。
- 恢复只替换 AppDefinition，**不触碰 records 表**。旧版本没有的字段，其数据仍保存在记录中，只是不显示；再次前进即完整恢复。
- 写记录时只校验当前版本的字段；记录中当前版本未知的旧键原样保留。

## 10. 业务数据接口约束

业务记录的增删改只能来自运行界面中的用户操作（Form / Table / QuickAction），经服务端按当前 Schema 校验后在事务中写入。删除为软删除并记录审计事件。**AI 与 Patch 永远无法调用这些接口。**
