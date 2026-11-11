import type { FieldDef } from '@morphos/shared'
import { Input, Select, Textarea } from '../components/ui/input'
import { Switch } from '../components/ui/switch'

export type DraftValue = string | boolean

/** Draft value for an input: booleans stay booleans, everything else edits as a string. */
export function toDraft(f: FieldDef, v: unknown): DraftValue {
  if (f.type === 'boolean') return v === true
  if (v === null || v === undefined) return ''
  return String(v)
}

export function initialDraft(fields: FieldDef[]): Record<string, DraftValue> {
  return Object.fromEntries(fields.map((f) => [f.id, toDraft(f, f.default)]))
}

/** Converts drafts to request values; the server coerces and validates against the schema. */
export function fromDraft(fields: FieldDef[], draft: Record<string, DraftValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const v = draft[f.id]
    if (v === undefined) continue
    out[f.id] = typeof v === 'string' && v.trim() === '' ? null : v
  }
  return out
}

export function FieldInput({
  id,
  field,
  value,
  onChange,
  disabled,
  invalid,
}: {
  id: string
  field: FieldDef
  value: DraftValue
  onChange: (v: DraftValue) => void
  disabled?: boolean
  invalid?: boolean
}) {
  const common = { id, disabled, 'aria-invalid': invalid || undefined }
  const str = typeof value === 'string' ? value : ''
  switch (field.type) {
    case 'boolean':
      return (
        <div className="flex h-9 items-center gap-2.5">
          <Switch id={id} checked={value === true} onCheckedChange={onChange} disabled={disabled} />
          <span className="text-sm text-muted">{value === true ? '是' : '否'}</span>
        </div>
      )
    case 'enum':
      return (
        <Select {...common} value={str} onChange={(e) => onChange(e.target.value)}>
          <option value="">{field.required ? '请选择' : '（不填）'}</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      )
    case 'text':
      return <Textarea {...common} value={str} onChange={(e) => onChange(e.target.value)} rows={3} />
    case 'number':
      return (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'date':
      return <Input {...common} type="date" value={str} onChange={(e) => onChange(e.target.value)} />
    default:
      return (
        <Input
          {...common}
          value={str}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.description ?? ''}
          autoComplete="off"
        />
      )
  }
}
