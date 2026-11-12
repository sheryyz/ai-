import {
  type AppDefinition,
  type Binding,
  type ExposureChange,
  FIELD_TYPE_LABELS,
  type FieldDef,
  fieldLabelOf,
  LAYER_LABELS,
  LAYERS,
  type MorphDiff,
  type NodeDef,
  type ProposalRecord,
  REGISTRY,
} from '@morphos/shared'
import { Check, Database, Info, Lock, ShieldCheck, TriangleExclamationPoint, Users } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { cn } from '../lib/cn'
import { describeValue } from '../runtime/describe'
import { IssueList } from './IssueList'
import { OriginBadge } from './TurnCard'

const RISK = {
  low: { tone: 'neutral', text: '低风险' },
  medium: { tone: 'change', text: '中风险' },
  high: { tone: 'danger', text: '高风险' },
} as const

const REGION = { main: '主区', aside: '侧栏' } as const

function Section({
  title,
  count,
  tone,
  children,
}: {
  title: string
  count?: number
  tone: 'add' | 'change' | 'danger' | 'neutral'
  children: ReactNode
}) {
  return (
    <section>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
        <span
          className={cn(
            'size-1.5 rounded-full',
            tone === 'add'
              ? 'bg-add'
              : tone === 'change'
                ? 'bg-change'
                : tone === 'danger'
                  ? 'bg-danger'
                  : 'bg-muted',
          )}
        />
        {title}
        {count !== undefined ? <span className="font-normal text-muted tabular-nums">{count}</span> : null}
      </h4>
      <ul className="space-y-1">{children}</ul>
    </section>
  )
}

function Item({ tone, children }: { tone: 'add' | 'change' | 'danger' | 'neutral'; children: ReactNode }) {
  return (
    <li
      className={cn(
        'rounded-[var(--radius-control)] border-l-2 bg-surface-2/60 px-2.5 py-1.5 text-xs leading-relaxed',
        tone === 'add'
          ? 'border-add'
          : tone === 'change'
            ? 'border-change'
            : tone === 'danger'
              ? 'border-danger'
              : 'border-border',
      )}
    >
      {children}
    </li>
  )
}

const nodeName = (n: Pick<NodeDef, 'type' | 'title'>) => `${n.title ?? REGISTRY[n.type].label}`

function fieldLine(f: FieldDef) {
  return (
    <>
      <span className="font-medium">{f.label}</span>{' '}
      <code className="font-mono text-[10.5px] text-muted">{f.id}</code>
      <span className="text-muted">
        {' '}
        · {FIELD_TYPE_LABELS[f.type]}
        {f.required ? ' · 必填' : ''}
        {f.default !== undefined ? ` · 默认「${describeValue(f.default)}」` : ''}
        {f.options ? ` · ${f.options.join(' / ')}` : ''}
      </span>
    </>
  )
}

function bindingLine(b: Binding, names: Map<string, string>) {
  return (
    <>
      {names.get(b.from.node) ?? b.from.node}
      <code className="font-mono text-[10.5px] text-muted">.{b.from.port}</code> →{' '}
      {names.get(b.to.node) ?? b.to.node}
      <code className="font-mono text-[10.5px] text-muted">.{b.to.port}</code>
    </>
  )
}

// ── data exposure (protocol §8, §11; design.md §3 “Diff 暴露栏”) ────────────

export type Labeler = (id: string) => string

export function labeler(...defs: (AppDefinition | null)[]): Labeler {
  const def = defs.find((d): d is AppDefinition => d !== null)
  return (id) => (def?.entities[0] ? fieldLabelOf(def.entities[0], id) : id)
}

function Chip({
  children,
  tone,
}: {
  children: ReactNode
  tone: 'new' | 'sensitive' | 'restricted' | 'plain'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-[6px] border px-1.5 py-0.5 text-[11px] leading-none',
        tone === 'new' && 'border-add/50 text-add',
        tone === 'sensitive' && 'border-danger/60 text-danger',
        tone === 'restricted' && 'border-border text-muted line-through',
        tone === 'plain' && 'border-border text-fg',
      )}
    >
      {children}
    </span>
  )
}

function FieldChips({
  ids,
  label,
  fresh = [],
  sensitive = [],
  restricted = false,
}: {
  ids: string[]
  label: Labeler
  fresh?: string[]
  sensitive?: string[]
  restricted?: boolean
}) {
  if (!ids.length) return <span className="text-[11px] text-muted">无</span>
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const isSensitive = sensitive.includes(id)
        return (
          <Chip
            key={id}
            tone={
              restricted ? 'restricted' : isSensitive ? 'sensitive' : fresh.includes(id) ? 'new' : 'plain'
            }
          >
            {isSensitive ? <Lock className="size-2.5" aria-label="敏感" /> : null}
            {label(id)}
            {fresh.includes(id) && !restricted ? <span className="sr-only">（新增）</span> : null}
          </Chip>
        )
      })}
    </span>
  )
}

function ExposureRow({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-start gap-2">
      <span className="pt-0.5 text-[11px] text-muted">{name}</span>
      {children}
    </div>
  )
}

function ExposureCard({ e, label, changes }: { e: ExposureChange; label: Labeler; changes: string[] }) {
  const a = e.after
  // Record scope per component that shows data: one may see every record while another sees a filtered subset.
  const scopes = new Map<string, string[]>()
  for (const n of a?.nodes ?? []) {
    if (!n.read.length && !n.aggregate.length) continue
    const scope = n.filters.join(' → ') || '全部记录'
    scopes.set(scope, [...(scopes.get(scope) ?? []), n.title ?? REGISTRY[n.type].label])
  }
  const withdrawn = a && e.before ? e.before.read.filter((f) => !a.read.includes(f)) : []
  const status = !e.before ? '新增分享页' : !a ? '将停用' : e.changed ? '有变化' : '不变'
  return (
    <li
      className={cn(
        'rounded-[var(--radius-control)] border bg-surface-2/60 px-2.5 py-2 text-xs',
        e.newlySensitive.length || e.loosened.length ? 'border-danger/50' : 'border-border',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Users className="size-3.5 text-muted" />
        <span className="font-medium">{e.label}</span>
        <span className="text-muted">· 面向{e.audience}</span>
        <Badge
          tone={!e.before ? 'add' : !a ? 'danger' : e.changed ? 'change' : 'neutral'}
          className="ml-auto"
        >
          {status}
        </Badge>
      </div>
      {!a ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          持链接的人打开会看到“此页面已停用”；恢复到包含它的版本即可重新启用
        </p>
      ) : e.changed ? (
        <div className="mt-2 space-y-1.5">
          <ExposureRow name="逐条可见">
            <FieldChips ids={a.read} label={label} fresh={e.newlyRead} sensitive={a.sensitiveRead} />
          </ExposureRow>
          {a.aggregate.length ? (
            <ExposureRow name="仅统计">
              <FieldChips ids={a.aggregate} label={label} />
            </ExposureRow>
          ) : null}
          <ExposureRow name="可写">
            <FieldChips ids={a.write} label={label} fresh={e.newlyWritable} />
          </ExposureRow>
          {a.restricted.length ? (
            <ExposureRow name="禁止接触">
              <FieldChips ids={a.restricted} label={label} restricted />
            </ExposureRow>
          ) : null}
          {withdrawn.length ? (
            <ExposureRow name="收回">
              <FieldChips ids={withdrawn} label={label} />
            </ExposureRow>
          ) : null}
          <ExposureRow name="记录范围">
            <span className="space-y-0.5 text-[11px]">
              {scopes.size ? (
                [...scopes].map(([scope, names]) => (
                  <span key={scope} className="block">
                    {scope}
                    <span className="text-muted">（{names.join('、')}）</span>
                  </span>
                ))
              ) : (
                <span className="text-muted">不显示已有记录</span>
              )}
            </span>
          </ExposureRow>
          {e.loosened.length ? (
            <p className="flex items-center gap-1 text-[11px] text-danger">
              <TriangleExclamationPoint className="size-3" /> 放宽保护：{e.loosened.map(label).join('、')}
            </p>
          ) : null}
          {changes.length ? <p className="text-[11px] text-muted">{changes.join('；')}</p> : null}
        </div>
      ) : null}
    </li>
  )
}

const VIEW_KEY_LABEL = {
  label: '名称',
  audience: '面向',
  description: '说明',
  restrictedFields: '禁止接触',
} as const

function ExposureSection({ diff, label }: { diff: MorphDiff; label: Labeler }) {
  // Proposals stored before protocol v1.1 have no exposure section.
  const items = diff.exposure ?? []
  if (!items.length) return null
  const changes = (viewId: string) =>
    (diff.views?.changed ?? [])
      .filter((c) => c.viewId === viewId)
      .flatMap((c) =>
        c.changes.map((x) => {
          const show = (v: unknown) =>
            Array.isArray(v) ? v.map((id) => label(String(id))).join('、') || '无' : describeValue(v)
          return `${VIEW_KEY_LABEL[x.key]}：${show(x.before)} → ${show(x.after)}`
        }),
      )
  return (
    <Section
      title="数据暴露"
      count={items.filter((e) => e.changed).length}
      tone={diff.confirmExposure ? 'danger' : 'neutral'}
    >
      {items.map((e) => (
        <ExposureCard key={e.viewId} e={e} label={label} changes={changes(e.viewId)} />
      ))}
      <li className="pt-0.5 text-[11px] leading-relaxed text-muted">
        由系统根据组件与数据连接计算，不采信 AI 的描述。
        <Lock className="inline size-2.5" /> 为敏感字段。
      </li>
    </Section>
  )
}

/** What approving would publish that needs an explicit yes (protocol §11.5), one line per view. */
export function exposureConfirmLines(diff: MorphDiff, label: Labeler): string[] {
  return (diff.exposure ?? [])
    .filter((e) => e.newlySensitive.length || e.loosened.length)
    .map((e) => {
      const fields = [...new Set([...e.newlySensitive, ...e.loosened])].map(label).join('、')
      return `确认向「${e.label}」的${e.audience}公开：${fields}`
    })
}

export function ExposureConfirm({
  lines,
  checked,
  onChange,
}: {
  lines: string[]
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] border border-danger/50 bg-surface px-2.5 py-2 text-xs leading-relaxed">
      <input
        type="checkbox"
        checked={checked}
        onChange={(ev) => onChange(ev.target.checked)}
        className="mt-0.5 size-3.5 accent-[var(--danger)]"
      />
      <span>
        {lines.map((l) => (
          <span key={l} className="block">
            {l}
          </span>
        ))}
      </span>
    </label>
  )
}

export function DiffBody({
  diff,
  before,
  after,
}: {
  diff: MorphDiff
  before: AppDefinition | null
  after: AppDefinition | null
}) {
  const names = new Map<string, string>()
  for (const n of [...(before?.nodes ?? []), ...(after?.nodes ?? [])]) names.set(n.id, nodeName(n))
  const n = diff.nodes
  return (
    <div className="space-y-4">
      <ExposureSection diff={diff} label={labeler(after, before)} />
      {diff.fields.added.length ? (
        <Section title="新增字段" count={diff.fields.added.length} tone="add">
          {diff.fields.added.map((f) => (
            <Item key={f.id} tone="add">
              {fieldLine(f)}
            </Item>
          ))}
        </Section>
      ) : null}
      {diff.fields.changed.length ? (
        <Section title="修改字段" count={diff.fields.changed.length} tone="change">
          {diff.fields.changed.map((c) => (
            <Item key={c.fieldId} tone="change">
              <span className="font-medium">{c.label}</span>：
              {c.changes
                .map((x) => `${x.key} ${describeValue(x.before)} → ${describeValue(x.after)}`)
                .join('；')}
            </Item>
          ))}
        </Section>
      ) : null}
      {n.added.filter((x) => REGISTRY[x.type].visual).length ? (
        <Section title="新增组件" count={n.added.filter((x) => REGISTRY[x.type].visual).length} tone="add">
          {n.added
            .filter((x) => REGISTRY[x.type].visual)
            .map((x) => (
              <Item key={x.id} tone="add">
                <span className="font-medium">{nodeName(x)}</span>
                <span className="text-muted">
                  {' '}
                  · {REGISTRY[x.type].label} · {REGION[x.region ?? 'main']}
                </span>
              </Item>
            ))}
        </Section>
      ) : null}
      {n.changed.length || n.moved.length || n.hidden.length || n.shown.length ? (
        <Section
          title="调整组件"
          count={n.changed.length + n.moved.length + n.hidden.length + n.shown.length}
          tone="change"
        >
          {n.changed.map((c) => (
            <Item key={`c-${c.nodeId}`} tone="change">
              <span className="font-medium">{names.get(c.nodeId)}</span>
              <span className="text-muted"> · 修改 </span>
              <code className="font-mono text-[10.5px]">{c.keys.join(', ')}</code>
            </Item>
          ))}
          {n.moved.map((m) => (
            <Item key={`m-${m.nodeId}`} tone="change">
              <span className="font-medium">{names.get(m.nodeId)}</span>
              <span className="text-muted">
                {' '}
                · 移动 {REGION[m.from.region]}#{m.from.order ?? '-'} → {REGION[m.to.region]}#
                {m.to.order ?? '-'}
                {m.from.width !== m.to.width ? `，宽度 ${m.to.width === 'half' ? '半宽' : '全宽'}` : ''}
              </span>
            </Item>
          ))}
          {n.hidden.map((id) => (
            <Item key={`h-${id}`} tone="change">
              <span className="font-medium">{names.get(id)}</span>
              <span className="text-muted"> · 隐藏（可恢复显示，数据不受影响）</span>
            </Item>
          ))}
          {n.shown.map((id) => (
            <Item key={`s-${id}`} tone="change">
              <span className="font-medium">{names.get(id)}</span>
              <span className="text-muted"> · 重新显示</span>
            </Item>
          ))}
        </Section>
      ) : null}
      {n.removed.length ? (
        <Section title="移除组件" count={n.removed.length} tone="danger">
          {n.removed.map((x) => (
            <Item key={x.id} tone="danger">
              <span className="font-medium">{nodeName(x)}</span>
              <span className="text-muted"> · {REGISTRY[x.type].label}</span>
            </Item>
          ))}
        </Section>
      ) : null}
      {diff.bindings.added.length || diff.bindings.removed.length ? (
        <Section
          title="数据连接"
          count={diff.bindings.added.length + diff.bindings.removed.length}
          tone="neutral"
        >
          {diff.bindings.added.map((b) => (
            <Item key={`a-${b.id}`} tone="add">
              <span className="text-add">+ </span>
              {bindingLine(b, names)}
            </Item>
          ))}
          {diff.bindings.removed.map((b) => (
            <Item key={`r-${b.id}`} tone="danger">
              <span className="text-danger">− </span>
              {bindingLine(b, names)}
            </Item>
          ))}
        </Section>
      ) : null}
      {diff.app.changed.length ? (
        <Section title="应用信息" tone="change">
          <Item tone="change">
            修改{' '}
            {diff.app.changed.map((k) => ({ name: '名称', description: '简介', icon: '图标' })[k]).join('、')}
          </Item>
        </Section>
      ) : null}

      {before ? (
        <Section title="保留" tone="neutral">
          <Item tone="neutral">
            <span className="flex items-center gap-1.5">
              <Database className="size-3.5 text-muted" />
              复用已有 <b className="tabular-nums">{diff.preserved.recordCount}</b> 条记录与{' '}
              {diff.preserved.fieldIds.length} 个字段，业务数据不会被修改
            </span>
          </Item>
        </Section>
      ) : null}

      {diff.impacts.length ? (
        <Section
          title="影响"
          count={diff.impacts.length}
          tone={diff.impacts.some((i) => i.severity === 'danger') ? 'danger' : 'neutral'}
        >
          {diff.impacts.map((i) => (
            <Item
              key={`${i.kind}:${i.fieldId ?? i.nodeId ?? i.message}`}
              tone={i.severity === 'danger' ? 'danger' : i.severity === 'warning' ? 'change' : 'neutral'}
            >
              <span className="flex gap-1.5">
                {i.severity === 'info' ? (
                  <Info className="mt-0.5 size-3.5 shrink-0 text-muted" />
                ) : (
                  <TriangleExclamationPoint className="mt-0.5 size-3.5 shrink-0 text-change" />
                )}
                {i.message}
              </span>
            </Item>
          ))}
        </Section>
      ) : null}
    </div>
  )
}

export function ValidationSummary({ proposal }: { proposal: ProposalRecord }) {
  const warnings = proposal.issues.filter((i) => i.level === 'warning')
  const repairs = proposal.trace.rounds.length - 1
  return (
    <section>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
        <ShieldCheck className="size-3.5 text-add" /> 七层校验
        {repairs > 0 ? <span className="font-normal text-muted">（自修复 {repairs} 轮后通过）</span> : null}
      </h4>
      <div className="grid grid-cols-3 gap-1">
        {LAYERS.map((l) => {
          const w = warnings.filter((i) => i.layer === l).length
          return (
            <span
              key={l}
              className={cn(
                'flex items-center gap-1 rounded-[var(--radius-control)] border px-1.5 py-1 text-[11px]',
                w ? 'border-change/40 text-change' : 'border-border text-muted',
              )}
            >
              <Check className={cn('size-3', w ? 'text-change' : 'text-add')} />
              {LAYER_LABELS[l]}
              {w ? ` · ${w}` : ''}
            </span>
          )
        })}
      </div>
      {warnings.length ? (
        <div className="mt-2">
          <IssueList issues={warnings} compact />
        </div>
      ) : null}
    </section>
  )
}

export function DiffPanel({
  proposal,
  before,
  busy,
  onApprove,
  onRevise,
  onReject,
}: {
  proposal: ProposalRecord
  before: AppDefinition | null
  busy: 'approve' | 'reject' | null
  /** confirmExposure: the user ticked the exposure confirmation (only offered when the Diff asks for it). */
  onApprove: (confirmExposure: boolean) => void
  onRevise: () => void
  onReject: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const diff = proposal.diff
  if (!diff) return null
  const risk = RISK[diff.risk]
  const confirmLines = diff.confirmExposure ? exposureConfirmLines(diff, labeler(proposal.after, before)) : []
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="space-y-2 rounded-[var(--radius-card)] border border-dashed border-morph bg-morph-soft p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="morph">Morph Diff · 待批准</Badge>
            <Badge tone={risk.tone}>{risk.text}</Badge>
            <OriginBadge origin={proposal.origin} model={proposal.trace.model} proposal={proposal} />
          </div>
          <p className="text-sm leading-relaxed font-medium">{diff.summary}</p>
          {before ? (
            <p className="text-[11px] text-muted">
              基于 v{diff.fromVersion}，批准后生成 v{diff.fromVersion + 1}；可随时在版本中恢复
            </p>
          ) : (
            <p className="text-[11px] text-muted">批准后创建应用（v1）</p>
          )}
          {proposal.trace.notes.length ? (
            <ul className="space-y-0.5 text-[11px] text-change">
              {proposal.trace.notes.map((n) => (
                <li key={n}>注：{n}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <DiffBody diff={diff} before={before} after={proposal.after} />
        <ValidationSummary proposal={proposal} />
      </div>
      {confirmLines.length ? (
        <div className="border-t border-border bg-surface px-3 pt-3">
          <ExposureConfirm lines={confirmLines} checked={confirmed} onChange={setConfirmed} />
        </div>
      ) : null}
      <div className="flex gap-2 border-t border-border bg-surface p-3">
        <Button
          variant="morph"
          className="flex-1 justify-center"
          loading={busy === 'approve'}
          disabled={busy !== null || (confirmLines.length > 0 && !confirmed)}
          title={confirmLines.length && !confirmed ? '请先勾选上方的公开确认' : undefined}
          onClick={() => onApprove(confirmLines.length > 0 && confirmed)}
        >
          批准并生效
        </Button>
        <Button disabled={busy !== null} onClick={onRevise}>
          继续修改
        </Button>
        <Button
          variant="ghost"
          className="text-danger hover:text-danger"
          loading={busy === 'reject'}
          disabled={busy !== null}
          onClick={onReject}
        >
          拒绝
        </Button>
      </div>
    </div>
  )
}
