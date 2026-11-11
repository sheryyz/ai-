import {
  asRows,
  evaluateFilter,
  type FieldDef,
  fieldTypesOf,
  formatValue,
  getRowValue,
  type ParamsOf,
  type Row,
} from '@morphos/shared'
import { Search, Zap } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Modal } from '../../components/ui/dialog'
import { Input, Label } from '../../components/ui/input'
import { api, errorMessage, fieldErrors } from '../../lib/api'
import { type NodeProps, useInvalidateRecords, useRuntime } from '../context'
import { type DraftValue, FieldInput, fromDraft, initialDraft } from '../FieldInput'
import { NodeFrame } from '../NodeFrame'

const MAX_SHOWN = 5

/** Generic "find one record and set some fields" — check-in, lend, return… all from params. */
export function QuickActionNode({ nodeId, title, params, ev, mark }: NodeProps<ParamsOf<'QuickAction'>>) {
  const { appId, entity, mode, timeZone, today } = useRuntime()
  const uid = useId()
  const rows = asRows(ev?.inputs.rows)
  const types = fieldTypesOf(entity)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [asking, setAsking] = useState<Row | null>(null)
  const askFields = (params.ask ?? [])
    .map((id) => entity.fields.find((f) => f.id === id))
    .filter((f): f is FieldDef => Boolean(f))
  const [answers, setAnswers] = useState<Record<string, DraftValue>>(() => initialDraft(askFields))
  const [askErrors, setAskErrors] = useState<Record<string, string>>({})
  const invalidate = useInvalidateRecords(appId)

  const isEligible = (r: Row) =>
    !params.availableWhen || evaluateFilter(params.availableWhen, r, types, { today })
  const eligibleCount = rows.filter(isEligible).length
  const text = (r: Row, f: string) => formatValue(getRowValue(r, f), f, entity, timeZone)

  // Lists are small (one entity, ≤ a few thousand rows); recomputing per render keeps this simple.
  const q = query.trim().toLowerCase()
  const shown = (
    q
      ? rows.filter((r) => params.searchFields.some((f) => text(r, f).toLowerCase().includes(q)))
      : rows.filter(isEligible)
  ).slice(0, MAX_SHOWN)

  async function run(r: Row, ans: Record<string, unknown> = {}) {
    setPending(r.id)
    try {
      await api.runAction(appId, nodeId, r.id, ans)
      await invalidate()
      toast.success(`${text(r, entity.displayField) || '记录'} · ${params.label}完成`)
      setAsking(null)
      setQuery('')
    } catch (e) {
      const fe = fieldErrors(e)
      if (Object.keys(fe).length) setAskErrors(fe)
      else toast.error(errorMessage(e))
    } finally {
      setPending(null)
    }
  }

  const stateOf = (r: Row) =>
    Object.keys(params.set)
      .map((f) => `${entity.fields.find((x) => x.id === f)?.label ?? f}：${text(r, f) || '—'}`)
      .join(' · ')

  return (
    <NodeFrame
      title={title ?? params.label}
      icon={<Zap className="size-4" />}
      subtitle={`可${params.label} ${eligibleCount} / ${rows.length} 条`}
      mark={mark}
    >
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`按${params.searchFields.map((f) => entity.fields.find((x) => x.id === f)?.label ?? f).join(' / ')}搜索`}
          className="pl-8"
          aria-label={`${params.label}：搜索记录`}
        />
      </div>
      {shown.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted">
          {query ? `没有匹配「${query}」的记录` : rows.length ? `全部记录都已${params.label}` : '暂无记录'}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {!query ? <li className="pb-1 text-[11px] text-muted">待{params.label}</li> : null}
          {shown.map((r) => {
            const ok = isEligible(r)
            const secondary = params.searchFields
              .filter((f) => f !== entity.displayField)
              .map((f) => text(r, f))
            return (
              <li key={r.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{text(r, entity.displayField) || r.id}</p>
                  <p className="truncate text-xs text-muted">
                    {ok ? secondary.filter(Boolean).join(' · ') : stateOf(r)}
                  </p>
                </div>
                {ok ? (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={pending === r.id}
                    disabled={mode === 'preview' || (pending !== null && pending !== r.id)}
                    onClick={() => {
                      if (askFields.length) {
                        setAnswers(initialDraft(askFields))
                        setAskErrors({})
                        setAsking(r)
                      } else void run(r)
                    }}
                  >
                    {params.buttonLabel}
                  </Button>
                ) : (
                  <Badge>不可{params.label}</Badge>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {mode === 'preview' ? <p className="mt-2 text-[11px] text-muted">预览中不可执行，批准后生效</p> : null}

      <Modal
        open={asking !== null}
        onOpenChange={(o) => !o && setAsking(null)}
        title={`${params.label} · ${asking ? text(asking, entity.displayField) : ''}`}
        description={`将修改：${Object.keys(params.set)
          .map((f) => entity.fields.find((x) => x.id === f)?.label ?? f)
          .join('、')}`}
        footer={
          <>
            <Button onClick={() => setAsking(null)}>取消</Button>
            <Button
              variant="primary"
              loading={pending !== null}
              onClick={() => asking && run(asking, fromDraft(askFields, answers))}
            >
              {params.buttonLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {askFields.map((f) => (
            <div key={f.id}>
              <Label htmlFor={`${uid}-${f.id}`} required>
                {f.label}
              </Label>
              <FieldInput
                id={`${uid}-${f.id}`}
                field={f}
                value={answers[f.id] ?? ''}
                onChange={(v) => setAnswers((a) => ({ ...a, [f.id]: v }))}
                invalid={Boolean(askErrors[f.id])}
              />
              {askErrors[f.id] ? <p className="mt-1 text-xs text-danger">{askErrors[f.id]}</p> : null}
            </div>
          ))}
        </div>
      </Modal>
    </NodeFrame>
  )
}
