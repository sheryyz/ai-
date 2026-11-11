import { Switch as RSwitch } from 'radix-ui'

export function Switch({
  id,
  checked,
  onCheckedChange,
  disabled,
}: {
  id?: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <RSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className="relative h-5 w-9 shrink-0 rounded-full border border-border bg-surface-2 transition-colors duration-150 data-[state=checked]:border-morph data-[state=checked]:bg-morph disabled:opacity-50"
    >
      <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-surface shadow transition-transform duration-150 data-[state=checked]:translate-x-[17px]" />
    </RSwitch.Root>
  )
}
