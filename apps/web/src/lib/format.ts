import { formatTimestamp } from '@morphos/shared'

/** "刚刚 / 5 分钟前 / 3 小时前 / 2 天前", falling back to a business-time-zone timestamp. */
export function relativeTime(iso: string, timeZone: string, now = Date.now()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const s = Math.round((now - t) / 1000)
  if (s < 45) return '刚刚'
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`
  if (s < 86_400) return `${Math.round(s / 3600)} 小时前`
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)} 天前`
  return formatTimestamp(iso, timeZone)
}

export function formatMetric(value: number | null, format: 'number' | 'percent'): string {
  if (value === null || Number.isNaN(value)) return '—'
  if (format === 'percent') return `${(value * 100).toFixed(value === 0 || value === 1 ? 0 : 1)}%`
  return Number.isInteger(value) ? value.toLocaleString('zh-CN') : value.toFixed(2)
}
