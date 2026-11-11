/**
 * protocol.md §4 — component registry: typed ports, params schema, side effects.
 * The registry is the *only* source of what the AI may compose; the renderer maps each type to a React component.
 */
import { FilterExprSchema } from './filter'
import { SlugSchema } from './ids'
import { type ComponentType, FieldValueSchema } from './schema'
import { z } from './zod'

export type PortType = 'RecordSet' | 'Number'

export interface PortDef {
  name: string
  type: PortType
  label: string
  /** Inputs only: must be bound by exactly one binding. */
  required?: boolean
}

export type Effect = 'read' | 'none' | 'create' | 'update' | 'outbox'

/** Where a node's entity comes from: its own `entityId` param, or the RecordSet flowing into it. */
export type EntitySource = 'param' | 'input' | 'none'

const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max', 'ratio'] as const
export type Aggregate = (typeof AGGREGATES)[number]

export const PARAM_SCHEMAS = {
  CollectionSource: z.object({
    entityId: SlugSchema,
    sort: z.object({ field: SlugSchema, dir: z.enum(['asc', 'desc']).default('asc') }).optional(),
  }),
  Filter: z.object({
    filter: FilterExprSchema,
    showChips: z.boolean().default(true),
  }),
  Table: z.object({
    columns: z.array(SlugSchema).min(1).max(12),
    searchable: z.boolean().default(true),
    editable: z.boolean().default(true),
    allowDelete: z.boolean().default(false),
    pageSize: z.number().int().min(5).max(100).default(10),
  }),
  Form: z.object({
    entityId: SlugSchema,
    fields: z.array(SlugSchema).min(1).max(30),
    submitLabel: z.string().trim().min(1).max(20).default('提交'),
    successMessage: z.string().trim().max(60).optional(),
  }),
  Metric: z.object({
    label: z.string().trim().min(1).max(30),
    aggregate: z.enum(AGGREGATES),
    field: SlugSchema.optional(),
    where: FilterExprSchema.optional(),
    format: z.enum(['number', 'percent']).default('number'),
    goal: z.number().positive().optional(),
  }),
  Chart: z.object({
    kind: z.enum(['bar', 'donut']).default('bar'),
    groupBy: SlugSchema,
  }),
  QuickAction: z.object({
    label: z.string().trim().min(1).max(30),
    searchFields: z.array(SlugSchema).min(1).max(4),
    ask: z.array(SlugSchema).max(4).optional(),
    set: z
      .record(SlugSchema, FieldValueSchema)
      .refine((s) => Object.keys(s).length > 0, { error: 'set 至少要修改 1 个字段' }),
    availableWhen: FilterExprSchema.optional(),
    buttonLabel: z.string().trim().min(1).max(10).default('确认'),
  }),
  MessageDraft: z.object({
    template: z.string().trim().min(1).max(500),
    channelLabel: z.string().trim().min(1).max(20).default('站内模拟通道'),
  }),
  CSVExport: z.object({
    columns: z.array(SlugSchema).min(1).max(30).optional(),
    filename: z.string().trim().min(1).max(40).default('导出数据'),
  }),
} satisfies Record<ComponentType, z.ZodType>

export type ParamsOf<T extends ComponentType> = z.infer<(typeof PARAM_SCHEMAS)[T]>

export interface ComponentSpec {
  type: ComponentType
  label: string
  /** Shown to the model in the planner prompt and to users in the Diff. */
  description: string
  /** Human-readable params reference for the planner prompt. */
  paramsDoc: string
  visual: boolean
  inputs: PortDef[]
  outputs: PortDef[]
  effect: Effect
  entitySource: EntitySource
}

const RS = (name: string, label: string, required = false): PortDef => ({
  name,
  type: 'RecordSet',
  label,
  required,
})

export const REGISTRY: Record<ComponentType, ComponentSpec> = {
  CollectionSource: {
    type: 'CollectionSource',
    label: '数据源',
    description: '读取实体的全部记录，是所有记录流的起点。无界面。',
    paramsDoc: 'entityId: 实体 id；sort?: {field, dir: "asc"|"desc"}',
    visual: false,
    inputs: [],
    outputs: [RS('records', '全部记录')],
    effect: 'read',
    entitySource: 'param',
  },
  Filter: {
    type: 'Filter',
    label: '筛选',
    description: '按条件过滤输入记录，输出子集；界面上显示条件标签。',
    paramsDoc: 'filter: FilterExpr；showChips?: boolean',
    visual: true,
    inputs: [RS('input', '待筛选记录', true)],
    outputs: [RS('result', '筛选结果')],
    effect: 'none',
    entitySource: 'input',
  },
  Table: {
    type: 'Table',
    label: '数据表',
    description: '以表格展示记录，支持搜索、编辑、删除（删除需用户手动确认）。',
    paramsDoc:
      'columns: 字段 id 数组（可含 createdAt）；searchable?; editable?; allowDelete?（默认 false）; pageSize?（5–100）',
    visual: true,
    inputs: [RS('rows', '展示的记录', true)],
    outputs: [],
    effect: 'update',
    entitySource: 'input',
  },
  Form: {
    type: 'Form',
    label: '表单',
    description: '录入新记录。提交后由服务端按 Schema 校验并写入。',
    paramsDoc:
      'entityId；fields: 字段 id 数组（必须包含所有无默认值的必填字段）；submitLabel?; successMessage?',
    visual: true,
    inputs: [],
    outputs: [],
    effect: 'create',
    entitySource: 'param',
  },
  Metric: {
    type: 'Metric',
    label: '指标',
    description: '对输入记录做聚合：计数、求和、平均、最值、比例（如签到率）。',
    paramsDoc:
      'label；aggregate: count|sum|avg|min|max|ratio；field?（sum/avg/min/max 需数字字段）；where?: FilterExpr（ratio 必填：分子条件）；format?: number|percent；goal?: 目标值',
    visual: true,
    inputs: [RS('rows', '参与统计的记录', true)],
    outputs: [{ name: 'value', type: 'Number', label: '指标值' }],
    effect: 'none',
    entitySource: 'input',
  },
  Chart: {
    type: 'Chart',
    label: '分布图',
    description: '按某字段分组计数，以条形图或环形图展示。',
    paramsDoc: 'kind?: bar|donut；groupBy: 字段 id（单选、是/否或短文本字段）',
    visual: true,
    inputs: [RS('rows', '参与统计的记录', true)],
    outputs: [],
    effect: 'none',
    entitySource: 'input',
  },
  QuickAction: {
    type: 'QuickAction',
    label: '快捷操作',
    description:
      '搜索一条记录并一键修改其字段（如签到、借出、归还）。可先询问用户输入 ask 中的字段。只修改，不删除。',
    paramsDoc:
      'label；searchFields: 用于搜索的字段 id；ask?: 执行时需用户填写的字段 id；set: {字段id: 值}，日期字段可用 "$today"；availableWhen?: FilterExpr（哪些记录可执行）；buttonLabel?',
    visual: true,
    inputs: [RS('rows', '可操作的记录', true)],
    outputs: [],
    effect: 'update',
    entitySource: 'input',
  },
  MessageDraft: {
    type: 'MessageDraft',
    label: '消息草稿',
    description: '为输入的收件人逐条生成消息草稿，可复制或记录到站内模拟发件箱；不会真实发送短信或微信。',
    paramsDoc: 'template: 文本，可用 {{字段id}} 插入收件人字段；channelLabel?',
    visual: true,
    inputs: [RS('recipients', '收件人', true)],
    outputs: [],
    effect: 'outbox',
    entitySource: 'input',
  },
  CSVExport: {
    type: 'CSVExport',
    label: '导出',
    description: '把输入记录导出为 CSV 文件（UTF-8，Excel 可直接打开）。',
    paramsDoc: 'columns?: 字段 id 数组（默认全部字段）；filename?',
    visual: true,
    inputs: [RS('rows', '导出的记录', true)],
    outputs: [],
    effect: 'none',
    entitySource: 'input',
  },
}

export function getPort(
  type: ComponentType,
  direction: 'input' | 'output',
  name: string,
): PortDef | undefined {
  const spec = REGISTRY[type]
  return (direction === 'input' ? spec.inputs : spec.outputs).find((p) => p.name === name)
}

export function parseParams<T extends ComponentType>(
  type: T,
  params: unknown,
): ReturnType<(typeof PARAM_SCHEMAS)[T]['safeParse']> {
  return PARAM_SCHEMAS[type].safeParse(params) as ReturnType<(typeof PARAM_SCHEMAS)[T]['safeParse']>
}

/** Typed params of an already-validated node. Throws if the node is invalid (programming error). */
export function paramsOf<T extends ComponentType>(node: { type: T; params: unknown }): ParamsOf<T> {
  const r = PARAM_SCHEMAS[node.type].safeParse(node.params)
  if (!r.success) throw new Error(`Invalid params for ${node.type}: ${r.error.message}`)
  return r.data as ParamsOf<T>
}

/** Date tokens accepted in QuickAction.set for date fields. */
export const DATE_TOKENS = ['$today', '$now'] as const
