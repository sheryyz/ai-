import type { FieldDef, ParamsOf } from '@morphos/shared'
import { PenLine } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Label } from '../../components/ui/input'
import { errorMessage, fieldErrors } from '../../lib/api'
import { type NodeProps, useRuntime } from '../context'
import { type DraftValue, FieldInput, fromDraft, initialDraft } from '../FieldInput'
import { NodeFrame } from '../NodeFrame'

export function FormNode({ nodeId, title, params, mark }: NodeProps<ParamsOf<'Form'>>) {
  const { entity, mode, ops } = useRuntime()
  const uid = useId()
  const fields = params.fields
    .map((id) => entity.fields.find((f) => f.id === id))
    .filter((f): f is FieldDef => Boolean(f))
  const [draft, setDraft] = useState<Record<string, DraftValue>>(() => initialDraft(fields))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const preview = mode === 'preview'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (preview) return
    setBusy(true)
    setErrors({})
    try {
      await ops.createRecord(nodeId, fromDraft(fields, draft))
      await ops.refresh()
      toast.success(params.successMessage ?? '已保存')
      setDraft(initialDraft(fields))
    } catch (err) {
      const fe = fieldErrors(err)
      setErrors(fe)
      toast.error(Object.keys(fe).length ? '请检查标红的字段' : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <NodeFrame title={title ?? '录入'} icon={<PenLine className="size-4" />} mark={mark}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        {fields.map((f) => {
          const id = `${uid}-${f.id}`
          return (
            <div key={f.id}>
              <Label htmlFor={id} required={f.required && f.default === undefined}>
                {f.label}
              </Label>
              <FieldInput
                id={id}
                field={f}
                value={draft[f.id] ?? ''}
                onChange={(v) => setDraft((d) => ({ ...d, [f.id]: v }))}
                disabled={preview || busy}
                invalid={Boolean(errors[f.id])}
              />
              {errors[f.id] ? <p className="mt-1 text-xs text-danger">{errors[f.id]}</p> : null}
            </div>
          )
        })}
        <Button
          type="submit"
          variant="primary"
          className="w-full justify-center"
          loading={busy}
          disabled={preview}
        >
          {params.submitLabel}
        </Button>
        {preview ? <p className="text-center text-[11px] text-muted">预览中不可提交，批准后生效</p> : null}
      </form>
    </NodeFrame>
  )
}
