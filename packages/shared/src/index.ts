/**
 * @morphos/shared — pure protocol logic shared by server and web.
 * Must not import IO, Node built-ins or React (see CLAUDE.md, constraint 5).
 * Phase 1 implements docs/protocol.md here: schema, registry, validate, patch, diff, runtime.
 */
export const PROTOCOL_VERSION = 1 as const

/** protocol.md §1 — stable identifier for fields, nodes and bindings. */
export const SLUG_PATTERN = /^[a-z][a-zA-Z0-9_]{0,39}$/

/** protocol.md §1 — system fields: read-only, referenceable, never user-defined. */
export const RESERVED_FIELD_IDS = ['id', 'createdAt', 'updatedAt'] as const

export function isSlug(value: string): boolean {
  return SLUG_PATTERN.test(value)
}
