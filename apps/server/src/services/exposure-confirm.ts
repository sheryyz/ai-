/**
 * protocol.md §11.5 — approving (or restoring) a change that shows sensitive fields on a share page, or lifts
 * a restriction, must be confirmed explicitly. The UI checkbox is only a rendering of this rule.
 */
import { type AppDefinition, fieldLabelOf, type MorphDiff, primaryEntity } from '@morphos/shared'
import { HttpError } from '../errors'

export interface ExposureToConfirm {
  viewId: string
  label: string
  audience: string
  /** Sensitive fields newly shown row by row, and fields whose protection is lifted. */
  fields: { id: string; label: string }[]
}

export function exposureToConfirm(diff: MorphDiff, after: AppDefinition): ExposureToConfirm[] {
  const entity = primaryEntity(after)
  return diff.exposure
    .filter((e) => e.newlySensitive.length || e.loosened.length)
    .map((e) => ({
      viewId: e.viewId,
      label: e.label,
      audience: e.audience,
      fields: [...new Set([...e.newlySensitive, ...e.loosened])].map((id) => ({
        id,
        label: fieldLabelOf(entity, id),
      })),
    }))
}

/**
 * Throws 409 unless the caller confirmed. Returns what was confirmed (null when nothing needed it) so the
 * caller can audit it once the version is committed.
 */
export function requireExposureConfirmation(
  diff: MorphDiff,
  after: AppDefinition,
  confirmed: boolean | undefined,
): ExposureToConfirm[] | null {
  if (!diff.confirmExposure) return null
  const items = exposureToConfirm(diff, after)
  if (!confirmed) {
    const text = items
      .map((i) => `「${i.label}」（${i.audience}）：${i.fields.map((f) => f.label).join('、')}`)
      .join('；')
    throw new HttpError(
      409,
      'EXPOSURE_CONFIRM_REQUIRED',
      `这次变更会公开敏感信息或解除限制，需要确认后才能生效。${text}`,
      items,
    )
  }
  return items
}
