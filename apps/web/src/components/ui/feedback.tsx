import { Inbox, RotateCw, TriangleExclamationPoint } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="加载中"
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
    />
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-[var(--radius-control)] bg-surface-2', className)} />
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  hint?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <span className="mb-3 text-muted">{icon ?? <Inbox className="size-6" />}</span>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/** Every error says what went wrong and what to do next (design.md §1.4). */
export function ErrorState({
  title = '加载失败',
  message,
  onRetry,
  className,
}: {
  title?: string
  message: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-danger/30 bg-danger/5 px-6 py-8 text-center',
        className,
      )}
    >
      <TriangleExclamationPoint className="size-5 text-danger" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs leading-relaxed text-muted">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-fg underline-offset-4 hover:underline"
        >
          <RotateCw className="size-3.5" /> 重试
        </button>
      ) : null}
    </div>
  )
}
