import type { IconName } from '@morphos/shared'
import {
  BookOpen,
  Briefcase,
  Calendar,
  ClipboardList,
  FlaskConical,
  GraduationCap,
  Heart,
  type LucideIcon,
  Package,
  Sparkles,
  Trophy,
  Users,
  Wrench,
} from 'lucide-react'
import { cn } from '../lib/cn'

const ICONS: Record<IconName, LucideIcon> = {
  calendar: Calendar,
  users: Users,
  flask: FlaskConical,
  package: Package,
  clipboard: ClipboardList,
  book: BookOpen,
  wrench: Wrench,
  trophy: Trophy,
  heart: Heart,
  briefcase: Briefcase,
  graduation: GraduationCap,
  sparkles: Sparkles,
}

export function AppIcon({
  name,
  className,
  size = 'md',
}: {
  name: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const Icon = ICONS[name as IconName] ?? Sparkles
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-2 text-fg',
        size === 'sm' ? 'size-7' : size === 'lg' ? 'size-11' : 'size-9',
        className,
      )}
    >
      <Icon className={size === 'lg' ? 'size-5' : 'size-4'} />
    </span>
  )
}
