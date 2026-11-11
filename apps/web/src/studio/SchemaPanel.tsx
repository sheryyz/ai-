import { type AppDefinition, FIELD_TYPE_LABELS, primaryEntity, REGISTRY } from '@morphos/shared'
import { Badge } from '../components/ui/badge'
import { describeValue } from '../runtime/describe'

/** Read-only view of the data model and the typed binding graph. */
export function SchemaPanel({ definition }: { definition: AppDefinition }) {
  const entity = primaryEntity(definition)
  const title = (id: string) => {
    const n = definition.nodes.find((x) => x.id === id)
    return n ? (n.title ?? REGISTRY[n.type].label) : id
  }
  return (
    <div className="space-y-5 p-4">
      <section>
        <h4 className="mb-2 text-xs font-semibold">
          实体 {entity.label}{' '}
          <code className="font-mono text-[10.5px] font-normal text-muted">{entity.id}</code>
        </h4>
        <table className="w-full text-left text-xs">
          <thead className="text-[11px] text-muted">
            <tr className="border-b border-border">
              <th className="py-1 font-medium">字段</th>
              <th className="py-1 font-medium">类型</th>
              <th className="py-1 font-medium">默认</th>
            </tr>
          </thead>
          <tbody>
            {entity.fields.map((f) => (
              <tr key={f.id} className="border-b border-border/60 align-top">
                <td className="py-1.5">
                  {f.label}
                  {f.required ? <span className="text-danger">*</span> : null}
                  {f.id === entity.displayField ? <Badge className="ml-1">标题</Badge> : null}
                  <div className="font-mono text-[10.5px] text-muted">{f.id}</div>
                </td>
                <td className="py-1.5 text-muted">
                  {FIELD_TYPE_LABELS[f.type]}
                  {f.options ? <div className="text-[10.5px]">{f.options.join(' / ')}</div> : null}
                </td>
                <td className="py-1.5 text-muted">
                  {f.default !== undefined ? describeValue(f.default) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h4 className="mb-2 text-xs font-semibold">类型化数据流（{definition.bindings.length} 条连接）</h4>
        <ul className="space-y-1 font-mono text-[11px]">
          {definition.bindings.map((b) => (
            <li key={b.id} className="rounded-[var(--radius-control)] bg-surface-2/60 px-2 py-1">
              <span className="font-sans">{title(b.from.node)}</span>
              <span className="text-muted">.{b.from.port}</span> →{' '}
              <span className="font-sans">{title(b.to.node)}</span>
              <span className="text-muted">.{b.to.port}</span>
              <span className="float-right text-muted">
                {
                  REGISTRY[definition.nodes.find((n) => n.id === b.to.node)?.type ?? 'Table'].inputs.find(
                    (p) => p.name === b.to.port,
                  )?.type
                }
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4 className="mb-2 text-xs font-semibold">组件（{definition.nodes.length}）</h4>
        <ul className="space-y-1 text-xs">
          {definition.nodes.map((n) => (
            <li key={n.id} className="flex items-center gap-1.5">
              <span>{n.title ?? REGISTRY[n.type].label}</span>
              <code className="font-mono text-[10.5px] text-muted">{n.type}</code>
              {n.hidden ? <Badge>已隐藏</Badge> : null}
            </li>
          ))}
        </ul>
      </section>

      <details>
        <summary className="cursor-pointer text-xs text-muted hover:text-fg">
          查看完整 AppDefinition JSON
        </summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-[var(--radius-control)] bg-surface-2 p-2 font-mono text-[10.5px] leading-relaxed">
          {JSON.stringify(definition, null, 2)}
        </pre>
      </details>
    </div>
  )
}
