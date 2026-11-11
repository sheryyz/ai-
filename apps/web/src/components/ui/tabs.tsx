import { Tabs as RTabs } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export const Tabs = RTabs.Root
export const TabsContent = RTabs.Content

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <RTabs.List className={cn('flex gap-1 border-b border-border px-3', className)}>{children}</RTabs.List>
  )
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RTabs.Trigger
      value={value}
      className="-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent px-2 text-[13px] font-medium text-muted transition-colors duration-150 hover:text-fg data-[state=active]:border-fg data-[state=active]:text-fg"
    >
      {children}
    </RTabs.Trigger>
  )
}
