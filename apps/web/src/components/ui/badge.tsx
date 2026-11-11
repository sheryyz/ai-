import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type Tone = 'neutral' | 'morph' | 'add' | 'change' | 'danger'

const TONES: Record<Tone, string> = {
  neutral: 'border-border text-muted',
  morph: 'border-morph/40 bg-morph-soft text-morph',
  add: 'border-add/30 bg-add/10 text-add',
  change: 'border-change/30 bg-change/10 text-change',
  danger: 'border-danger/30 bg-danger/10 text-danger',
}

export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap tabular-nums',
        TONES[tone],
        className,
      )}
      {...rest}
    />
  )
}
