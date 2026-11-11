import type { FieldDef, Row } from '@morphos/shared'
import { useEffect, useId, useState } from 'react'
import { Button } from '../components/ui/button'
import { Modal } from '../components/ui/dialog'
import { Label } from '../components/ui/input'
import { fieldErrors } from '../lib/api'
import { type DraftValue, FieldInput, fromDraft, toDraft } from './FieldInput'

/** Edits one record. Only fields the user actually changed are sent. */
export function RecordDialog({
  row,
  fields,
  title,
  onClose,
  onSave,
}: {
  row: Row | null
  fields: FieldDef[]
  title: string
  onClose: () => void
  onSave: (values: Record<string, unknown>) => Promise<void>
}) {
  const uid = useId()
  const [draft, setDraft] = useState<Record<string, DraftValue>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (row) setDraft(Object.fromEntries(fields.map((f) => [f.id, toDraft(f, row.values[f.id])])))
    setErrors({})
  }, [row, fields])

  async function save() {
    if (!row) return
    const changed = fields.filter((f) => draft[f.id] !== toDraft(f, row.values[f.id]))
    if (!changed.length) return onClose()
    setBusy(true)
    try {
      await onSave(fromDraft(changed, draft))
      onClose()
    } catch (e) {
      setErrors(fieldErrors(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={row !== null}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            保存
          </Button>
        </>
      }
    >
      <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        {fields.map((f) => (
          <div key={f.id}>
            <Label htmlFor={`${uid}-${f.id}`} required={f.required}>
              {f.label}
            </Label>
            <FieldInput
              id={`${uid}-${f.id}`}
              field={f}
              value={draft[f.id] ?? ''}
              onChange={(v) => setDraft((d) => ({ ...d, [f.id]: v }))}
              invalid={Boolean(errors[f.id])}
            />
            {errors[f.id] ? <p className="mt-1 text-xs text-danger">{errors[f.id]}</p> : null}
          </div>
        ))}
      </div>
    </Modal>
  )
}
