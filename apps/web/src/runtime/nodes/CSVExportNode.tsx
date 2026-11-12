import { asRows, defaultColumns, fieldLabel, type ParamsOf } from '@morphos/shared'
import { FileDown } from 'lucide-react'
import { cn } from '../../lib/cn'
import { type NodeProps, useRuntime } from '../context'
import { NodeFrame } from '../NodeFrame'

export function CSVExportNode({ nodeId, title, params, ev, mark, data }: NodeProps<ParamsOf<'CSVExport'>>) {
  const { entity, mode, ops } = useRuntime()
  const count = data?.kind === 'count' ? data.count : asRows(ev?.inputs.rows).length
  const columns = params.columns ?? defaultColumns(entity)
  const disabled = mode === 'preview' || count === 0
  return (
    <NodeFrame
      title={title ?? '导出'}
      icon={<FileDown className="size-4" />}
      subtitle={`${count} 条 · ${columns.length} 列 · UTF-8（Excel 可直接打开）`}
      mark={mark}
    >
      <p className="mb-3 line-clamp-2 text-xs text-muted">
        {columns.map((c) => fieldLabel(entity, c)).join('、')}
      </p>
      <a
        href={disabled ? undefined : ops.exportUrl(nodeId)}
        download={`${params.filename}.csv`}
        aria-disabled={disabled}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-[13px] font-medium transition-colors duration-150 hover:bg-surface-2',
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        <FileDown className="size-3.5" /> 下载 {params.filename}.csv
      </a>
      {mode === 'preview' ? <p className="mt-2 text-[11px] text-muted">批准后可下载</p> : null}
    </NodeFrame>
  )
}
