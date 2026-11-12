/**
 * A share page (/v/:token, design.md §3): one view for one kind of person, phone first. No platform
 * navigation, AI status or Studio entry; data is the server's trimmed snapshot, refreshed every few seconds.
 */
import { useQuery } from '@tanstack/react-query'
import { Link2Off, WifiOff } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { useParams } from 'react-router'
import { AppIcon } from '../components/AppIcon'
import { EmptyState, ErrorState, Skeleton } from '../components/ui/feedback'
import { ApiError, errorMessage, shareApi } from '../lib/api'
import { keys, POLL_MS } from '../lib/queries'
import { ShareRuntime } from '../runtime/ShareRuntime'

/** 404 / 410 end the page; a network blip while data is on screen only shows a banner. */
const isFinal = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 410)
const isNetwork = (e: unknown) => e instanceof ApiError && e.status === 0

export function SharePage() {
  const { token = '' } = useParams()
  const snap = useQuery({
    queryKey: keys.snapshot(token),
    queryFn: () => shareApi.snapshot(token),
    refetchInterval: (q) => (isFinal(q.state.error) ? false : POLL_MS),
  })

  const title = snap.data ? `${snap.data.view.label} · ${snap.data.app.name}` : 'MorphOS 分享页'
  useEffect(() => {
    document.title = title
  }, [title])

  let body: ReactNode
  if (snap.isError && (isFinal(snap.error) || !snap.data)) {
    const e = snap.error
    body =
      e instanceof ApiError && e.status === 410 ? (
        <EmptyState
          className="py-24"
          icon={<Link2Off className="size-6" />}
          title="此页面已停用"
          hint="组织者暂时关闭了这个页面。如需继续使用，请联系组织者。"
        />
      ) : e instanceof ApiError && e.status === 404 ? (
        <EmptyState
          className="py-24"
          icon={<Link2Off className="size-6" />}
          title="链接无效"
          hint="链接可能已被组织者重置，或复制时不完整。请向组织者索取新的链接。"
        />
      ) : (
        <ErrorState
          className="py-16"
          title={isNetwork(e) ? '连接不上组织者的电脑' : '加载失败'}
          message={
            isNetwork(e)
              ? '请确认手机和运行 MorphOS 的电脑在同一个网络（同一 Wi-Fi 或热点），然后重试。'
              : errorMessage(e)
          }
          onRetry={() => snap.refetch()}
        />
      )
  } else if (!snap.data) {
    body = (
      <div className="space-y-4">
        <Skeleton className="h-14 w-2/3" />
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    )
  } else {
    const { app, view } = snap.data
    body = (
      <>
        <header className="mb-5">
          <p className="flex items-center gap-2 text-xs text-muted">
            <AppIcon name={app.icon} size="sm" />
            <span className="truncate">{app.name}</span>
          </p>
          <h1 className="mt-3 text-xl font-semibold tracking-tight">{view.label}</h1>
          {view.description ? (
            <p className="mt-1 text-sm leading-relaxed text-muted">{view.description}</p>
          ) : null}
        </header>
        {snap.isError ? (
          <p
            role="status"
            className="mb-4 flex items-center gap-2 rounded-[var(--radius-control)] border border-change/40 bg-surface px-3 py-2 text-xs text-change"
          >
            <WifiOff className="size-3.5 shrink-0" />
            连接中断，正在重试；下面显示的是最近一次的数据
          </p>
        ) : null}
        <ShareRuntime token={token} snapshot={snap.data} />
      </>
    )
  }

  return (
    <div className="min-h-dvh bg-bg">
      <main className="mx-auto max-w-[480px] px-4 pt-6 pb-10">
        {body}
        <p className="mt-10 text-center text-[11px] text-muted">由 MorphOS 生成 · 只显示本页需要的信息</p>
      </main>
    </div>
  )
}
