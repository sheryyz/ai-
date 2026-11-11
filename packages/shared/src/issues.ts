/** protocol.md §7 — validation issue shape shared by server, web and the planner's repair loop. */
import { z } from './zod'

export const LAYERS = ['schema', 'reference', 'type', 'graph', 'safety', 'version'] as const
export type Layer = (typeof LAYERS)[number]

export const LAYER_LABELS: Record<Layer, string> = {
  schema: 'L1 结构',
  reference: 'L2 引用',
  type: 'L3 类型',
  graph: 'L4 数据流图',
  safety: 'L5 安全',
  version: 'L6 版本',
}

export const ValidationIssueSchema = z.object({
  level: z.enum(['error', 'warning']),
  layer: z.enum(LAYERS),
  code: z.string(),
  path: z.string(),
  message: z.string(),
  hint: z.string().optional(),
})
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>

export function formatPath(path: readonly PropertyKey[]): string {
  let out = ''
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`
    else out += out ? `.${String(seg)}` : String(seg)
  }
  return out
}

export function joinPath(prefix: string, path: string): string {
  if (!prefix) return path
  if (!path) return prefix
  return path.startsWith('[') ? `${prefix}${path}` : `${prefix}.${path}`
}

export function issue(
  layer: Layer,
  code: string,
  path: readonly PropertyKey[] | string,
  message: string,
  hint?: string,
  level: 'error' | 'warning' = 'error',
): ValidationIssue {
  return {
    level,
    layer,
    code,
    path: typeof path === 'string' ? path : formatPath(path),
    message,
    ...(hint ? { hint } : {}),
  }
}

export function zodIssues(
  error: z.ZodError,
  basePath: readonly PropertyKey[],
  code = 'SCHEMA_INVALID',
): ValidationIssue[] {
  return error.issues.map((i) =>
    issue(
      'schema',
      code,
      [...basePath, ...i.path],
      `${formatPath([...basePath, ...i.path]) || '根'}：${i.message}`,
    ),
  )
}

const LAYER_ORDER: Record<Layer, number> = {
  schema: 0,
  reference: 1,
  type: 2,
  graph: 3,
  safety: 4,
  version: 5,
}

export function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort(
    (a, b) =>
      (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1) || LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer],
  )
}

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((i) => i.level === 'error')
}
