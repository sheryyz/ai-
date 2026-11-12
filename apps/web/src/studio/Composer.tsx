import type { RecordingInfo } from '@morphos/shared'
import { ArrowUp, PlayCircle } from 'lucide-react'
import { forwardRef, type KeyboardEvent } from 'react'
import { Button } from '../components/ui/button'
import { cn } from '../lib/cn'

export interface ComposerProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onReplay: (r: RecordingInfo) => void
  /** Why input is disabled, or null when the user can type. */
  lockedReason: string | null
  /** Why AI input is unavailable (offline, server unreachable), or null when live. */
  aiBlocker: string | null
  recordings: RecordingInfo[]
  placeholder: string
}

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  { value, onChange, onSubmit, onReplay, lockedReason, aiBlocker, recordings, placeholder },
  ref,
) {
  const disabled = lockedReason !== null || aiBlocker !== null
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!disabled && value.trim().length >= 2) onSubmit()
    }
  }
  return (
    <div className="space-y-2">
      <div
        className={cn(
          'rounded-[var(--radius-card)] border bg-surface p-2 transition-colors duration-150 focus-within:border-morph',
          disabled ? 'border-border' : 'border-border shadow-[0_1px_2px_rgb(0_0_0/0.04)]',
        )}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          disabled={disabled}
          rows={3}
          maxLength={500}
          placeholder={aiBlocker ?? lockedReason ?? placeholder}
          aria-label="描述你的需求"
          className="block w-full resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed placeholder:text-muted focus:outline-none disabled:cursor-not-allowed"
        />
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[11px] text-muted">{disabled ? '' : 'Enter 发送 · Shift+Enter 换行'}</span>
          <Button
            size="icon"
            variant="morph"
            aria-label="发送"
            disabled={disabled || value.trim().length < 2}
            onClick={onSubmit}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
      {recordings.length && lockedReason === null ? (
        <div className="space-y-1">
          <p className="text-[11px] text-muted">
            演示样例 · 录制的真实模型响应回放，经当前系统重新校验，界面会标注“非实时生成”
          </p>
          <div className="flex flex-wrap gap-1.5">
            {recordings.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onReplay(r)}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-change/40 px-2.5 py-1 text-[11px] text-change hover:bg-change/10"
                title={r.intent}
              >
                <PlayCircle className="size-3 shrink-0" />
                <span className="truncate">{r.title}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
})
