import {
  asRows,
  type FieldValue,
  fieldLabel,
  formatValue,
  getRowValue,
  type ParamsOf,
  type Row,
} from '@morphos/shared'
import { ChevronLeft, ChevronRight, FileDown, Pencil, Search, Table2, Trash } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { EmptyState } from '../../components/ui/feedback'
import { Input } from '../../components/ui/input'
import { api, errorMessage } from '../../lib/api'
import { type NodeProps, useInvalidateRecords, useRuntime } from '../context'
import { NodeFrame } from '../NodeFrame'
import { RecordDialog } from '../RecordDialog'

export function TableNode({ nodeId, title, params, ev, mark }: NodeProps<ParamsOf<'Table'>>) {
  const { appId, entity, mode, timeZone, totalRecords, ops } = useRuntime()
  const rows = asRows(ev?.inputs.rows)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Row | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const invalidate = useInvalidateRecords(appId)
  const live = mode === 'live'
  const fieldOf = (id: string) => entity.fields.find((f) => f.id === id)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      params.columns.some((c) =>
        formatValue(getRowValue(r, c), c, entity, timeZone).toLowerCase().includes(q),
      ),
    )
  }, [rows, query, params.columns, entity, timeZone])

  const pages = Math.max(1, Math.ceil(filtered.length / params.pageSize))
  const current = Math.min(page, pages - 1)
  const visible = filtered.slice(current * params.pageSize, (current + 1) * params.pageSize)
  const hasActions = live && (params.editable || params.allowDelete)

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await api.deleteRecord(appId, nodeId, deleting.id)
      await invalidate()
      toast.success('已删除 1 条记录')
      setDeleting(null)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const cell = (r: Row, c: string) => {
    const v: FieldValue = getRowValue(r, c)
    const f = fieldOf(c)
    if (v === null || v === '') return <span className="text-muted">—</span>
    if (f?.type === 'boolean') return <Badge tone={v ? 'add' : 'neutral'}>{v ? '是' : '否'}</Badge>
    if (f?.type === 'enum') return <Badge>{String(v)}</Badge>
    return formatValue(v, c, entity, timeZone)
  }

  return (
    <NodeFrame
      title={title ?? entity.label}
      icon={<Table2 className="size-4" />}
      subtitle={`${filtered.length}${filtered.length !== rows.length ? ` / ${rows.length}` : ''} 条`}
      mark={mark}
      actions={
        mode !== 'preview' && rows.length ? (
          <a
            href={ops.exportUrl(nodeId)}
            className="inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-muted hover:bg-surface-2 hover:text-fg"
            title="导出当前表格为 CSV"
            aria-label="导出当前表格为 CSV"
          >
            <FileDown className="size-4" />
          </a>
        ) : null
      }
    >
      {params.searchable && rows.length > 0 ? (
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
            placeholder="搜索…"
            className="pl-8"
            aria-label={`搜索${title ?? entity.label}`}
          />
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title={totalRecords === 0 ? '还没有记录' : '没有符合条件的记录'}
          hint={
            totalRecords === 0 ? '用表单录入第一条，它会立刻出现在这里。' : '上游筛选条件排除了全部记录。'
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="没有匹配的记录" hint={`没有记录包含「${query}」`} />
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-max text-left text-[13px]">
            <thead>
              <tr className="border-y border-border bg-surface-2/60 text-xs text-muted">
                {params.columns.map((c) => (
                  <th key={c} className="px-4 py-2 font-medium whitespace-nowrap first:pl-4">
                    {fieldLabel(entity, c)}
                  </th>
                ))}
                {hasActions ? <th className="w-px px-4 py-2" aria-label="操作" /> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="group border-b border-border last:border-0 hover:bg-surface-2/50">
                  {params.columns.map((c) => (
                    <td key={c} className="max-w-60 truncate px-4 py-2 tabular-nums">
                      {cell(r, c)}
                    </td>
                  ))}
                  {hasActions ? (
                    <td className="px-2 py-1 whitespace-nowrap">
                      <div className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                        {params.editable ? (
                          <Button size="icon" variant="ghost" aria-label="编辑" onClick={() => setEditing(r)}>
                            <Pencil className="size-3.5" />
                          </Button>
                        ) : null}
                        {params.allowDelete ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="删除"
                            onClick={() => setDeleting(r)}
                          >
                            <Trash className="size-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted tabular-nums">
          <span>
            第 {current + 1} / {pages} 页
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="上一页"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="下一页"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}

      <RecordDialog
        row={editing}
        fields={entity.fields}
        title={`编辑${entity.label}`}
        onClose={() => setEditing(null)}
        onSave={async (values) => {
          if (!editing) return
          await api.updateRecord(appId, nodeId, editing.id, values)
          await invalidate()
          toast.success('已保存修改')
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="删除这条记录？"
        description={
          <>
            将删除「{deleting ? String(deleting.values[entity.displayField] ?? deleting.id) : ''}」。
            这是你在运行界面中的手动操作；记录会被软删除并写入审计日志。
          </>
        }
        confirmLabel="删除"
        danger
        loading={busy}
        onConfirm={confirmDelete}
      />
    </NodeFrame>
  )
}
