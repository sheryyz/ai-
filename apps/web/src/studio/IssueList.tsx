import { LAYER_LABELS, type ValidationIssue } from '@morphos/shared'
import { cn } from '../lib/cn'

export function IssueList({ issues, compact }: { issues: ValidationIssue[]; compact?: boolean }) {
  return (
    <ul className="space-y-1.5">
      {issues.map((i, n) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: issues are an immutable list
          key={n}
          className={cn(
            'rounded-[var(--radius-control)] border px-2.5 py-1.5 text-xs leading-relaxed',
            i.level === 'error' ? 'border-danger/30 bg-danger/5' : 'border-change/30 bg-change/5',
          )}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('font-medium', i.level === 'error' ? 'text-danger' : 'text-change')}>
              {LAYER_LABELS[i.layer]}
            </span>
            <code className="font-mono text-[10.5px] text-muted">{i.code}</code>
            {!compact && i.path ? (
              <code className="font-mono text-[10.5px] text-muted">@ {i.path}</code>
            ) : null}
          </div>
          <p className="mt-0.5">{i.message}</p>
          {i.hint ? <p className="mt-0.5 text-muted">建议：{i.hint}</p> : null}
        </li>
      ))}
    </ul>
  )
}
