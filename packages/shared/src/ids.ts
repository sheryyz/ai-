import { z } from './zod'

/** protocol.md §1 — stable identifier for fields, nodes and bindings. */
export const SLUG_PATTERN = /^[a-z][a-zA-Z0-9_]{0,39}$/

/** protocol.md §1 — system fields: read-only, referenceable, never user-defined. */
export const RESERVED_FIELD_IDS = ['id', 'createdAt', 'updatedAt'] as const
export type ReservedFieldId = (typeof RESERVED_FIELD_IDS)[number]

export const SYSTEM_FIELD_LABELS: Record<string, string> = {
  id: '记录编号',
  createdAt: '创建时间',
  updatedAt: '更新时间',
}

export function isSlug(value: string): boolean {
  return SLUG_PATTERN.test(value)
}

export function isReservedFieldId(value: string): value is ReservedFieldId {
  return (RESERVED_FIELD_IDS as readonly string[]).includes(value)
}

export const SlugSchema = z
  .string()
  .regex(SLUG_PATTERN, { error: '标识符须以小写字母开头，只含字母、数字、下划线，最长 40 位' })
