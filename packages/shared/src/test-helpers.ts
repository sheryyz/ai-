// Test-only helpers. Not exported from index.ts.
import checkinPatch from '../../../fixtures/proposals/event-checkin.patch.json'
import deskPatch from '../../../fixtures/proposals/event-desk.patch.json'
import signupPagePatch from '../../../fixtures/proposals/event-signup-page.patch.json'
import equipmentTemplate from '../../../fixtures/templates/equipment-lending.json'
import eventTemplate from '../../../fixtures/templates/event-registration.json'
import type { Row } from './filter'
import { validateProposal } from './proposal'
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

/** Validates `operations` as a patch on `definition` (treated as v1). */
export function patchOn(definition: AppDefinition, operations: unknown[]) {
  return validateProposal(
    { kind: 'patch', intent: '测试', summary: '测试', baseVersion: 1, operations },
    { current: { definition, version: 1 } },
  )
}
function applied(definition: AppDefinition, operations: unknown[]): AppDefinition {
  const r = patchOn(definition, operations)
  if (!r.ok || !r.after) throw new Error(`fixture patch invalid: ${JSON.stringify(r.issues, null, 2)}`)
  return r.after
}
export const signupPageOps = () => structuredClone(signupPagePatch.operations) as unknown[]
export const deskOps = () => structuredClone(deskPatch.operations) as unknown[]
/** Event app after the check-in evolution (AC-03). */
export const withCheckin = () => applied(eventDef(), checkinProposal().operations)
/** …plus the volunteer desk view: search by name, tick checked-in, see the rate; phone restricted. */
export const withDesk = () => applied(withCheckin(), deskOps())

let seq = 0
export function row(values: Row['values'], createdAt = '2026-11-10T09:00:00.000Z'): Row {
  seq += 1
  return { id: `r${seq}`, createdAt, updatedAt: createdAt, values }
}

export const CTX = { today: '2026-11-11' }
