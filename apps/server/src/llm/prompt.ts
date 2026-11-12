/**
 * Planner prompts. Component, operator and op documentation is generated from the shared registry and
 * schemas, so the prompt cannot drift from what the validator actually accepts.
 * Only aggregate statistics about business records are sent to the model — never record contents.
 */
import {
  type AppDefinition,
  COMPONENT_TYPES,
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  ICON_NAMES,
  LAYER_LABELS,
  MAX_BINDINGS,
  MAX_NODES,
  OPERATORS_BY_TYPE,
  REGISTRY,
  type StoredRecord,
  type ValidationIssue,
} from '@morphos/shared'
import type { ChatMessage } from './client'

/** Bump whenever the wording changes; recorded in every proposal trace and evaluation result. */
export const PROMPT_VERSION = 'planner-v1.1'

const PATCH_OPS_DOC = `
- {"op":"addField","entityId","field":FieldDef}  新增字段；required 为 true 时必须带 default
- {"op":"updateField","entityId","fieldId","changes":{"label"?,"description"?,"addOptions"?:[新选项],"default"?}}  只能改显示名、说明、默认值，或给单选追加选项
- {"op":"addNode","node":NodeDef}
- {"op":"updateNode","nodeId","title"?,"params"?:{...}}  params 与原 params 浅合并
- {"op":"moveNode","nodeId","region":"main"|"aside","order":整数,"width"?:"full"|"half"}
- {"op":"hideNode","nodeId"} / {"op":"showNode","nodeId"}  只影响显示，可恢复
- {"op":"removeNode","nodeId"}  会自动断开相关绑定，优先考虑 hideNode
- {"op":"bind","binding":Binding} / {"op":"unbind","bindingId"}
- {"op":"setFilter","nodeId":"<Filter 节点>","filter":FilterExpr}
- {"op":"updateApp","name"?,"description"?,"icon"?}`.trim()

function componentDoc(): string {
  return COMPONENT_TYPES.map((t) => {
    const s = REGISTRY[t]
    const ports = (dir: string, list: typeof s.inputs) =>
      list.length
        ? `${dir} ${list.map((p) => `${p.name}: ${p.type}${p.required ? '（必需）' : ''}`).join('，')}`
        : `${dir} 无`
    return `- ${t}（${s.label}${s.visual ? '' : '，无界面'}）${ports('输入', s.inputs)}；${ports('输出', s.outputs)}\n  ${s.description}\n  params: ${s.paramsDoc}`
  }).join('\n')
}

function operatorDoc(): string {
  return FIELD_TYPES.map((t) => `- ${t}（${FIELD_TYPE_LABELS[t]}）：${OPERATORS_BY_TYPE[t].join(' ')}`).join(
    '\n',
  )
}

export function systemPrompt(): string {
  return `你是 MorphOS 的应用规划器。MorphOS 把用户的自然语言需求变成受约束的 JSON 提案；系统会对提案做六层校验并向用户展示变更差异，用户批准后才生效。

# 输出格式
只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。必须是以下三种之一：
1. {"kind":"create","intent":"<复述用户需求>","summary":"<一句话说明你创建了什么>","definition":AppDefinition}
2. {"kind":"patch","intent":"<复述用户需求>","summary":"<一句话说明改了什么>","baseVersion":<任务给出的版本号>,"operations":[PatchOp, ...]}
3. {"kind":"refusal","intent":"<复述用户需求>","reason":"<为什么不能这样做>","suggestion":"<一句用户可以直接照着提的替代需求>"}
思考过程请使用简体中文，简明扼要。

# 硬性规则
- 你只能输出数据。系统不会执行任何代码、SQL 或脚本。
- 协议中不存在删除、清空、重置业务记录的操作，也不能删除字段、修改字段类型或 id、删除单选选项。用户要求这些时输出 refusal，并在 suggestion 中给出非破坏性的替代（例如“只在视图中筛选掉…”“隐藏…组件”）。
- 需求含糊但可以合理实现时，直接按最合理的理解实现，不要拒绝。
- 标识符（实体、字段、节点、绑定的 id）必须匹配 ^[a-z][a-zA-Z0-9_]{0,39}$，使用英文驼峰；label、title、name 使用中文。
- id、createdAt、updatedAt 是系统字段：不能定义为字段，但可以在列、排序、筛选中引用。
- 每个应用恰好 1 个实体；节点最多 ${MAX_NODES} 个，绑定最多 ${MAX_BINDINGS} 条。

# AppDefinition
{"schemaVersion":1,"name":"≤40字","description":"≤200字","icon":"${ICON_NAMES.join('|')}",
 "entities":[{"id","label","displayField":"<一个 string 类型字段的 id，作为记录标题>","fields":[FieldDef,...]}],
 "nodes":[NodeDef,...],"bindings":[Binding,...]}
FieldDef: {"id","label","type":"${FIELD_TYPES.join('|')}","required":布尔,"default"?:值,"options"?:[仅 enum，1–20 个不重复],"description"?}
  date 值为 "YYYY-MM-DD"；boolean 值为 true/false；enum 的值必须在 options 中。
NodeDef: {"id","type":组件类型,"title"?:"中文标题","region":"main"|"aside"（有界面组件必填）,"order":整数（同区域升序）,"width"?:"full"|"half"（仅 main）,"params":{...}}
Binding: {"id","from":{"node","port":"<输出端口>"},"to":{"node","port":"<输入端口>"}}

# 组件注册表（类型化端口）
${componentDoc()}
连接规则：RecordSet 只能接 RecordSet 输入，Number 不能接 RecordSet；每个必需输入端口必须恰好有 1 条绑定；数据流不能成环。
组件规则：Form.fields 必须包含所有“必填且没有 default”的字段；Metric 的 sum/avg/min/max 需要 number 类型 field，ratio 需要 where（分子条件）且 format 用 "percent"；Chart.groupBy 只能是 enum、boolean 或 string 字段；QuickAction.set 中日期字段可用 "$today"。所有 params 中引用的字段都必须存在。

# 筛选 DSL（FilterExpr）
条件：{"field":"<字段 id>","operator":"<操作符>","value"?:值}；组合：{"op":"and"|"or","conditions":[FilterExpr,...]}（1–10 项，嵌套不超过 3 层）
各字段类型允许的操作符：
${operatorDoc()}
in / notIn 的 value 是数组；isEmpty / notEmpty 不需要 value。日期可用相对值：{"relative":"today"}、{"relative":"daysAgo","days":7}、{"relative":"daysFromNow","days":3}。

# PatchOp（只能使用以下操作）
${PATCH_OPS_DOC}

# 创建应用的原则
- 只实现用户明确提出的字段与功能。不要自行添加用户没提到的字段（如备注、场次）或流程（如签到、审核），用户之后会用自然语言继续演进应用。只有需求本身包含状态流转（如“借用管理”含借出、归还）时，才加入对应的状态字段与 QuickAction。
- 取值有限的分类（如专业、类别、部门、状态）用 enum，并给出 4–8 个常见选项（必要时含“其他”），这样才能做分布统计。
- 1 个 CollectionSource（id 用 "source"，params.entityId 为实体 id），它是所有记录流的起点。
- main 区：1–2 个 Metric（width "half"），若有单选字段则加按它分组的 Chart（width "half"），1 个 Table（width "full"，列包含主要字段与 createdAt）。
- aside 区：Form（录入新记录），CSVExport（导出）。需要“状态流转”（借出/归还、签到、审核通过等）时加 QuickAction。
- 每个需要记录的组件都从 source.records（或某个 Filter.result）绑定过来。

# 演进应用（patch）的原则
- 只输出实现需求所必需的增量操作，复用已有字段、数据源与组件，不要重建已有内容。
- 新增字段不会回写旧记录：旧记录读取时按 default 虚拟填充。表示状态的布尔字段请给 default（如 false）。
- 要展示“满足条件的子集”：新增 Filter（input 接 source.records），再把 Filter.result 接到 Table / MessageDraft / Metric / CSVExport。
- 新组件的 order 要与现有组件协调；必要时用 moveNode 调整已有组件；不再需要的组件优先 hideNode（可恢复）。`
}

function fieldStats(def: AppDefinition, records: StoredRecord[]): string {
  const entity = def.entities[0]
  if (!entity) return ''
  return entity.fields
    .map((f) => {
      const vals = records.map((r) => r.data[f.id] ?? f.default ?? null)
      const filled = vals.filter((v) => v !== null && v !== '').length
      let detail = `已填 ${filled} 条`
      if (f.type === 'enum' || f.type === 'boolean') {
        const counts = new Map<string, number>()
        for (const v of vals)
          if (v !== null && v !== '') counts.set(String(v), (counts.get(String(v)) ?? 0) + 1)
        detail =
          [...counts.entries()]
            .map(([k, n]) => `${k === 'true' ? '是' : k === 'false' ? '否' : k} ${n}`)
            .join('，') || '暂无值'
      }
      return `- ${f.id}（${f.label}，${f.type}）：${detail}`
    })
    .join('\n')
}

export function createTaskMessage(intent: string): string {
  return `# 任务：创建新应用
用户需求：「${intent}」
输出 kind="create"（确实无法安全实现时输出 kind="refusal"）。`
}

export function patchTaskMessage(
  intent: string,
  def: AppDefinition,
  version: number,
  records: StoredRecord[],
): string {
  return `# 任务：修改现有应用（baseVersion = ${version}）
当前应用定义：
${JSON.stringify(def)}

当前业务数据：共 ${records.length} 条记录（以下只是统计，不含个人数据）
${fieldStats(def, records)}

用户需求：「${intent}」
输出 kind="patch"，baseVersion 必须为 ${version}，只包含增量操作（确实无法安全实现时输出 kind="refusal"）。`
}

/** Appended to PROMPT_VERSION in traces of the whole-regeneration baseline (evaluation only). */
export const REGENERATE_PROMPT_SUFFIX = '+regenerate-v1'

/**
 * Evaluation baseline (eval/README.md, strategy A): the same system prompt and context as a patch task,
 * but the model returns the complete new definition instead of incremental operations.
 */
export function regenerateTaskMessage(intent: string, def: AppDefinition, records: StoredRecord[]): string {
  return `# 任务：根据新需求输出修改后的完整应用定义
当前应用定义：
${JSON.stringify(def)}

当前业务数据：共 ${records.length} 条记录（以下只是统计，不含个人数据）
${fieldStats(def, records)}

用户需求：「${intent}」
在当前应用的基础上实现需求，输出 kind="create"，definition 为修改后的完整 AppDefinition（不是增量操作）（确实无法安全实现时输出 kind="refusal"）。`
}

export function repairMessage(issues: ValidationIssue[], round: number, maxRounds: number): string {
  const lines = issues
    .filter((i) => i.level === 'error')
    .slice(0, 12)
    .map(
      (i, n) =>
        `${n + 1}. [${LAYER_LABELS[i.layer]}] ${i.code}${i.path ? ` @ ${i.path}` : ''}：${i.message}${i.hint ? `\n   建议：${i.hint}` : ''}`,
    )
  return `你上一次的输出没有通过系统校验（自修复第 ${round}/${maxRounds} 轮）。问题如下：
${lines.join('\n')}
请修正以上问题，重新输出完整的 JSON 提案（输出整个提案，而不是只输出修改的部分）。`
}

export function buildMessages(task: string, history: { output: string; repair: string }[]): ChatMessage[] {
  const msgs: ChatMessage[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: task },
  ]
  for (const h of history) {
    msgs.push({ role: 'assistant', content: h.output })
    msgs.push({ role: 'user', content: h.repair })
  }
  return msgs
}
