// Test-only helpers. Not exported from index.ts.
import checkinPatch from '../../../fixtures/proposals/event-checkin.patch.json'
import equipmentTemplate from '../../../fixtures/templates/equipment-lending.json'
import eventTemplate from '../../../fixtures/templates/event-registration.json'
import type { Row } from './filter'
import type { AppDefinition } from './schema'
import { validateDefinition } from './validate'

export function loadDefinition(raw: unknown): AppDefinition {
  const r = validateDefinition(raw)
  if (!r.ok || !r.definition) throw new Error(`fixture invalid: ${JSON.stringify(r.issues, null, 2)}`)
  return r.definition
}

export const eventDef = () => loadDefinition(eventTemplate)
export const equipmentDef = () => loadDefinition(equipmentTemplate)
export const checkinProposal = () =>
  structuredClone(checkinPatch) as Record<string, unknown> & { operations: unknown[] }
export const rawEvent = () => structuredClone(eventTemplate) as unknown as AppDefinition

let seq = 0
export function row(values: Row['values'], createdAt = '2026-11-10T09:00:00.000Z'): Row {
  seq += 1
  return { id: `r${seq}`, createdAt, updatedAt: createdAt, values }
}

export const CTX = { today: '2026-11-11' }
