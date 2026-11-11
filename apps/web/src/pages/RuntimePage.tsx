import { ArrowLeft, Wand } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { AppIcon } from '../components/AppIcon'
import { Badge } from '../components/ui/badge'
import { ErrorState, Skeleton } from '../components/ui/feedback'
import { ApiError, errorMessage } from '../lib/api'
import { useApp, useRecords } from '../lib/queries'
import { AppRuntime } from '../runtime/AppRuntime'

export function RuntimePage() {
  const { id = '' } = useParams()
  const app = useApp(id)
  const records = useRecords(id)

  if (app.isError || records.isError) {
    const err = app.error ?? records.error
    const missing = err instanceof ApiError && err.status === 404
    return (
      <main className="mx-auto max-w-xl px-4 py-24">
        <ErrorState
          title={missing ? '应用不存在' : '加载失败'}
          message={missing ? '它可能已被移除，或链接有误。返回应用中心查看全部应用。' : errorMessage(err)}
          onRetry={missing ? undefined : () => Promise.all([app.refetch(), records.refetch()])}
        />
        <p className="mt-4 text-center">
          <Link to="/" className="text-sm font-medium underline-offset-4 hover:underline">
            返回应用中心
          </Link>
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-[1400px] px-4 pt-6 pb-16 sm:px-6">
      <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
        <ArrowLeft className="size-3.5" /> 应用中心
      </Link>
      {app.isPending || records.isPending ? (
        <div className="mt-4 space-y-4">
          <Skeleton className="h-12 w-80" />
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <AppIcon name={app.data.definition.icon} size="lg" />
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold tracking-tight">{app.data.definition.name}</h1>
                {app.data.definition.description ? (
                  <p className="mt-0.5 truncate text-sm text-muted">{app.data.definition.description}</p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge>v{app.data.version}</Badge>
              <Badge>{records.data.length} 条记录</Badge>
              <Link
                to={`/apps/${id}/studio`}
                className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] bg-morph px-3 text-[13px] font-medium text-on-morph hover:opacity-90"
              >
                <Wand className="size-3.5" /> 在 AI Studio 中演进
              </Link>
            </div>
          </div>
          <AppRuntime appId={id} definition={app.data.definition} records={records.data} />
        </>
      )}
    </main>
  )
}
