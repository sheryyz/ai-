import type { ReactNode } from 'react'
import { Badge } from '../components/ui/badge'
import { Card, CardHeader } from '../components/ui/card'
import { cn } from '../lib/cn'

/** How a node relates to a pending proposal (design.md: AI-proposed content is dashed + morph colour). */
export type Mark = 'added' | 'changed' | 'moved' | 'hidden'

const MARK_STYLE: Record<Mark, string> = {
  added: 'border-dashed border-morph shadow-[0_0_0_3px_var(--morph-soft)]',
  changed: 'border-change/60 shadow-[0_0_0_3px_color-mix(in_oklab,var(--change)_12%,transparent)]',
  moved: 'border-change/40',
  hidden: 'border-dashed opacity-45',
}
const MARK_BADGE: Record<Mark, { tone: 'morph' | 'change' | 'neutral'; text: string }> = {
  added: { tone: 'morph', text: '新增' },
  changed: { tone: 'change', text: '修改' },
  moved: { tone: 'change', text: '移动' },
  hidden: { tone: 'neutral', text: '将隐藏' },
}

export function NodeFrame({
  title,
  icon,
  subtitle,
  actions,
  mark,
  children,
  className,
}: {
  title: ReactNode
  icon?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  mark?: Mark
  children?: ReactNode
  className?: string
}) {
  const badge = mark ? MARK_BADGE[mark] : null
  return (
    <Card
      className={cn(
        'flex h-full flex-col transition-shadow duration-200',
        mark && MARK_STYLE[mark],
        className,
      )}
    >
      <CardHeader
        title={title}
        icon={icon}
        subtitle={subtitle}
        actions={
          <>
            {actions}
            {badge ? <Badge tone={badge.tone}>{badge.text}</Badge> : null}
          </>
        }
      />
      <div className="flex-1 px-4 pb-4">{children}</div>
    </Card>
  )
}
