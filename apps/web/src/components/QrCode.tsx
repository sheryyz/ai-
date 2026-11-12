/** QR code drawn locally from `uqr`'s module matrix (no network, no innerHTML). */
import { useMemo } from 'react'
import { encode } from 'uqr'

export function QrCode({ value, size = 168, label }: { value: string; size?: number; label: string }) {
  const { n, d } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 })
    let path = ''
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) path += `M${x} ${y}h1v1h-1z`
      })
    })
    return { n: qr.size, d: path }
  }, [value])
  return (
    <svg
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="rounded-[var(--radius-control)]"
    >
      <rect width={n} height={n} fill="var(--qr-light)" />
      <path d={d} fill="var(--qr-dark)" />
    </svg>
  )
}
