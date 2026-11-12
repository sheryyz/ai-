import { asRows, type ParamsOf, renderTemplate } from '@morphos/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, MessageSquareText, Send } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/feedback'
import { errorMessage } from '../../lib/api'
import { relativeTime } from '../../lib/format'
import { keys, useOutbox } from '../../lib/queries'
import { type NodeProps, useRuntime } from '../context'
import { NodeFrame } from '../NodeFrame'

const MAX_SHOWN = 4

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Drafts only: messages are copied or logged to a simulated outbox, never sent to a real channel. */
export function MessageDraftNode({ nodeId, title, params, ev, mark }: NodeProps<ParamsOf<'MessageDraft'>>) {
  const { appId, entity, mode, timeZone, ops } = useRuntime()
  const qc = useQueryClient()
  const recipients = asRows(ev?.inputs.recipients)
  const outbox = useOutbox(appId, mode === 'live')
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const live = mode === 'live'
  const canRecord = mode !== 'preview'
  const drafts = recipients.map((r) => ({
    id: r.id,
    to: String(r.values[entity.displayField] ?? r.id),
    body: renderTemplate(params.template, r, entity, timeZone),
  }))
  const history = (outbox.data ?? []).filter((e) => e.nodeId === nodeId)

  async function copyOne(id: string, body: string) {
    if (await copy(body)) {
      setCopied(id)
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200)
    } else toast.error('浏览器不允许访问剪贴板，请手动选择文本复制')
  }

  async function record() {
    setBusy(true)
    try {
      const entry = await ops.recordOutbox(nodeId)
      if (live) await qc.invalidateQueries({ queryKey: keys.outbox(appId) })
      toast.success(`已记录 ${entry.recipientCount} 条草稿到模拟发件箱（未真实发送）`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <NodeFrame
      title={title ?? '消息草稿'}
      icon={<MessageSquareText className="size-4" />}
      subtitle={`${drafts.length} 位收件人 · ${params.channelLabel}`}
      mark={mark}
      actions={<Badge>模拟 · 不会真实发送</Badge>}
    >
      {drafts.length === 0 ? (
        <EmptyState
          className="py-6"
          icon={<Check className="size-5" />}
          title="当前没有收件人"
          hint="符合条件的记录会自动出现在这里"
        />
      ) : (
        <>
          <ul className="space-y-2">
            {drafts.slice(0, MAX_SHOWN).map((d) => (
              <li
                key={d.id}
                className="group rounded-[var(--radius-control)] border border-border bg-surface-2/50 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">致 {d.to}</span>
                  <button
                    type="button"
                    onClick={() => copyOne(d.id, d.body)}
                    className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg"
                  >
                    {copied === d.id ? <Check className="size-3" /> : <Copy className="size-3" />}
                    {copied === d.id ? '已复制' : '复制'}
                  </button>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed">{d.body}</p>
              </li>
            ))}
          </ul>
          {drafts.length > MAX_SHOWN ? (
            <p className="mt-2 text-xs text-muted">还有 {drafts.length - MAX_SHOWN} 条草稿</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={async () => {
                if (await copy(drafts.map((d) => `【${d.to}】${d.body}`).join('\n')))
                  toast.success(`已复制 ${drafts.length} 条草稿`)
                else toast.error('浏览器不允许访问剪贴板')
              }}
            >
              <Copy className="size-3.5" /> 复制全部
            </Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!canRecord} onClick={record}>
              <Send className="size-3.5" /> 记录到模拟发件箱
            </Button>
          </div>
        </>
      )}
      {history.length ? (
        <p className="mt-3 text-[11px] text-muted">
          模拟发件箱已记录 {history.length} 次 · 最近 {relativeTime(history[0]?.createdAt ?? '', timeZone)}（
          {history[0]?.recipientCount} 人）
        </p>
      ) : null}
    </NodeFrame>
  )
}
