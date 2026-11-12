/**
 * protocol.md §2–§4, §6 — AppDefinition, Patch and Proposal schemas (v1.1: role views, sensitive fields).
 * Domain types are inferred from these schemas (CLAUDE.md: no duplicated hand-written interfaces).
 */
import { FilterExprSchema } from './filter'
import { SlugSchema } from './ids'
import { z } from './zod'

export const PROTOCOL_VERSION = 1 as const

export const FIELD_TYPES = ['string', 'text', 'number', 'date', 'boolean', 'enum'] as const
export const FieldTypeSchema = z.enum(FIELD_TYPES)

export const FIELD_TYPE_LABELS: Record<(typeof FIELD_TYPES)[number], string> = {
  string: '短文本',
  text: '长文本',
  number: '数字',
  date: '日期',
  boolean: '是/否',
  enum: '单选',
}

export const FieldValueSchema = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])

export const FieldDefSchema = z.object({
  id: SlugSchema,
  label: z.string().trim().min(1).max(40),
  type: FieldTypeSchema,
  required: z.boolean().default(false),
  default: FieldValueSchema.optional(),
  options: z.array(z.string().trim().min(1).max(30)).min(1).max(20).optional(),
  description: z.string().max(200).optional(),
  // protocol §11.3: identifies a person (phone, ID number…). Only affects role views.
  sensitive: z.boolean().optional(),
})
export type FieldDef = z.infer<typeof FieldDefSchema>

export const EntityDefSchema = z.object({
  id: SlugSchema,
  label: z.string().trim().min(1).max(40),
  displayField: SlugSchema,
  fields: z.array(FieldDefSchema).min(1).max(30),
})
export type EntityDef = z.infer<typeof EntityDefSchema>

export const COMPONENT_TYPES = [
  'CollectionSource',
  'Filter',
  'Table',
  'Form',
  'Metric',
  'Chart',
  'QuickAction',
  'MessageDraft',
  'CSVExport',
] as const
export const ComponentTypeSchema = z.enum(COMPONENT_TYPES)
export type ComponentType = z.infer<typeof ComponentTypeSchema>

export const REGIONS = ['main', 'aside'] as const
export const RegionSchema = z.enum(REGIONS)
export type Region = z.infer<typeof RegionSchema>

export const NodeDefSchema = z.object({
  id: SlugSchema,
  type: ComponentTypeSchema,
  title: z.string().trim().max(40).optional(),
  region: RegionSchema.optional(),
  order: z.number().int().min(0).max(999).optional(),
  width: z.enum(['full', 'half']).optional(),
  hidden: z.boolean().optional(),
  /** protocol §3.1: the role view this node belongs to; absent = the admin page. */
  view: SlugSchema.optional(),
  params: z.record(z.string(), z.unknown()).default({}),
})
export type NodeDef = z.infer<typeof NodeDefSchema>

export const PortRefSchema = z.object({
  node: SlugSchema,
  port: z.string().min(1).max(40),
})
export const BindingSchema = z.object({
  id: SlugSchema,
  from: PortRefSchema,
  to: PortRefSchema,
})
export type Binding = z.infer<typeof BindingSchema>

export const ICON_NAMES = [
  'calendar',
  'users',
  'flask',
  'package',
  'clipboard',
  'book',
  'wrench',
  'trophy',
  'heart',
  'briefcase',
  'graduation',
  'sparkles',
] as const
export const IconNameSchema = z.enum(ICON_NAMES)
export type IconName = z.infer<typeof IconNameSchema>

export const MAX_NODES = 32
export const MAX_BINDINGS = 48
export const MAX_VIEWS = 6

/** protocol §2.2 — a page for one kind of person, reached through a share link. */
export const ViewDefSchema = z.object({
  id: SlugSchema,
  label: z.string().trim().min(1).max(20),
  audience: z.string().trim().min(1).max(20),
  description: z.string().trim().max(100).optional(),
  /** Fields the user explicitly forbade this view to touch (neither read row by row nor write). */
  restrictedFields: z.array(SlugSchema).max(30).optional(),
})
export type ViewDef = z.infer<typeof ViewDefSchema>

export const AppDefinitionSchema = z.object({
  schemaVersion: z.literal(PROTOCOL_VERSION),
  name: z.string().trim().min(1).max(40),
  description: z.string().max(200).optional(),
  icon: IconNameSchema.default('sparkles'),
  // Provincial scope: exactly one entity. The array form reserves room for multi-entity apps.
  entities: z.array(EntityDefSchema).min(1).max(1, { error: '当前版本每个应用只支持 1 个数据实体' }),
  nodes: z.array(NodeDefSchema).max(MAX_NODES),
  bindings: z.array(BindingSchema).max(MAX_BINDINGS),
  // Optional rather than defaulted so v1 definitions parse back unchanged; read through viewsOf().
  views: z
    .array(ViewDefSchema)
    .max(MAX_VIEWS, { error: `每个应用最多 ${MAX_VIEWS} 个分享页` })
    .optional(),
})
export type AppDefinition = z.infer<typeof AppDefinitionSchema>

export function viewsOf(def: AppDefinition): ViewDef[] {
  return def.views ?? []
}

// ── Patch operations (protocol §6.1) ────────────────────────────────────────

export const AddFieldOpSchema = z.object({
  op: z.literal('addField'),
  entityId: SlugSchema,
  field: FieldDefSchema,
})
export const UpdateFieldOpSchema = z.object({
  op: z.literal('updateField'),
  entityId: SlugSchema,
  fieldId: SlugSchema,
  // Strict: unknown keys such as `type` must not be silently dropped (they are destructive changes).
  changes: z.strictObject({
    label: z.string().trim().min(1).max(40).optional(),
    description: z.string().max(200).optional(),
    addOptions: z.array(z.string().trim().min(1).max(30)).min(1).max(20).optional(),
    default: FieldValueSchema.optional(),
    sensitive: z.boolean().optional(),
  }),
})
export const AddNodeOpSchema = z.object({ op: z.literal('addNode'), node: NodeDefSchema })
export const UpdateNodeOpSchema = z.object({
  op: z.literal('updateNode'),
  nodeId: SlugSchema,
  title: z.string().trim().max(40).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
})
export const MoveNodeOpSchema = z.object({
  op: z.literal('moveNode'),
  nodeId: SlugSchema,
  region: RegionSchema,
  order: z.number().int().min(0).max(999),
  width: z.enum(['full', 'half']).optional(),
})
export const HideNodeOpSchema = z.object({ op: z.literal('hideNode'), nodeId: SlugSchema })
export const ShowNodeOpSchema = z.object({ op: z.literal('showNode'), nodeId: SlugSchema })
export const RemoveNodeOpSchema = z.object({ op: z.literal('removeNode'), nodeId: SlugSchema })
export const BindOpSchema = z.object({ op: z.literal('bind'), binding: BindingSchema })
export const UnbindOpSchema = z.object({ op: z.literal('unbind'), bindingId: SlugSchema })
export const SetFilterOpSchema = z.object({
  op: z.literal('setFilter'),
  nodeId: SlugSchema,
  filter: FilterExprSchema,
})
export const UpdateAppOpSchema = z.object({
  op: z.literal('updateApp'),
  name: z.string().trim().min(1).max(40).optional(),
  description: z.string().max(200).optional(),
  icon: IconNameSchema.optional(),
})
export const AddViewOpSchema = z.object({ op: z.literal('addView'), view: ViewDefSchema })
export const UpdateViewOpSchema = z.object({
  op: z.literal('updateView'),
  viewId: SlugSchema,
  changes: z.strictObject({
    label: z.string().trim().min(1).max(20).optional(),
    audience: z.string().trim().min(1).max(20).optional(),
    description: z.string().trim().max(100).optional(),
    /** Replaces the whole list; removing a field is a loosening the Diff flags as high risk. */
    restrictedFields: z.array(SlugSchema).max(30).optional(),
  }),
})
export const RemoveViewOpSchema = z.object({ op: z.literal('removeView'), viewId: SlugSchema })

export const PatchOpSchema = z.discriminatedUnion('op', [
  AddFieldOpSchema,
  UpdateFieldOpSchema,
  AddNodeOpSchema,
  UpdateNodeOpSchema,
  MoveNodeOpSchema,
  HideNodeOpSchema,
  ShowNodeOpSchema,
  RemoveNodeOpSchema,
  BindOpSchema,
  UnbindOpSchema,
  SetFilterOpSchema,
  UpdateAppOpSchema,
  AddViewOpSchema,
  UpdateViewOpSchema,
  RemoveViewOpSchema,
])
export type PatchOp = z.infer<typeof PatchOpSchema>
export type PatchOpName = PatchOp['op']

export const PATCH_OP_NAMES: readonly PatchOpName[] = [
  'addField',
  'updateField',
  'addNode',
  'updateNode',
  'moveNode',
  'hideNode',
  'showNode',
  'removeNode',
  'bind',
  'unbind',
  'setFilter',
  'updateApp',
  'addView',
  'updateView',
  'removeView',
]

/**
 * protocol §6.2 — explicitly forbidden operations. Safety comes from the whitelist above;
 * this list only lets the validator explain *why* a destructive request was refused.
 */
export const FORBIDDEN_OP_NAMES = [
  'deleteRecords',
  'deleteRecord',
  'clearData',
  'resetData',
  'truncate',
  'dropEntity',
  'dropCollection',
  'dropTable',
  'removeField',
  'deleteField',
  'changeFieldType',
  'renameFieldId',
  'rawSQL',
  'rawCode',
  'executeScript',
  'eval',
  'runShell',
] as const

export const MAX_PATCH_OPS = 40

// ── Proposal (protocol §6) ──────────────────────────────────────────────────

export const CreateProposalSchema = z.object({
  kind: z.literal('create'),
  intent: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(300),
  definition: z.unknown(),
})
export const PatchProposalSchema = z.object({
  kind: z.literal('patch'),
  intent: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(300),
  baseVersion: z.number().int().min(1),
  operations: z.array(z.unknown()).min(1).max(MAX_PATCH_OPS),
})
export const RefusalProposalSchema = z.object({
  kind: z.literal('refusal'),
  intent: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(1).max(500),
  suggestion: z.string().trim().max(500).optional(),
})
/** Envelope only: definition / operations are validated in depth by validate.ts with precise paths. */
export const ProposalEnvelopeSchema = z.discriminatedUnion('kind', [
  CreateProposalSchema,
  PatchProposalSchema,
  RefusalProposalSchema,
])

export type CreateProposal = Omit<z.infer<typeof CreateProposalSchema>, 'definition'> & {
  definition: AppDefinition
}
export type PatchProposal = Omit<z.infer<typeof PatchProposalSchema>, 'operations'> & {
  operations: PatchOp[]
}
export type RefusalProposal = z.infer<typeof RefusalProposalSchema>
export type Proposal = CreateProposal | PatchProposal | RefusalProposal
