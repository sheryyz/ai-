/**
 * AI Studio (design.md §3): conversation + pipeline | live / ghost preview | Morph Diff · versions · schema.
 * Works for an existing app (/apps/:id/studio) and for creating one (/studio/new?intent=… or ?recording=…).
 */
import type { AppDefinition, ProposalRecord, RecordingInfo } from '@morphos/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ClockArrowUp, ExternalLink, Eye, GitCompare, Layers, MessageSquare } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { AppIcon } from '../components/AppIcon'
import { Badge } from '../components/ui/badge'
import { EmptyState, ErrorState, Skeleton } from '../components/ui/feedback'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { ApiError, api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { keys, useHealth } from '../lib/queries'
import { AppRuntime } from '../runtime/AppRuntime'
import type { Mark } from '../runtime/NodeFrame'
import { Composer } from '../studio/Composer'
import { DiffPanel } from '../studio/DiffPanel'
import { diffMarks } from '../studio/marks'
import { SchemaPanel } from '../studio/SchemaPanel'
import { TurnCard } from '../studio/TurnCard'
import { fromRecord, type Turn } from '../studio/turn'
import { usePlanRunner } from '../studio/usePlanRunner'
import { VersionsPanel } from '../studio/VersionsPanel'

type View = 'live' | 'proposal'

export function StudioPage() {
  const { id } = useParams()
  const appId = id ?? null
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const health = useHealth()
  const aiConfigured = health.data?.ai.configured ?? false

  const app = useQuery({
    queryKey: keys.app(appId ?? ''),
    queryFn: () => api.app(appId ?? ''),
    enabled: Boolean(appId),
  })
  const records = useQuery({
    queryKey: keys.records(appId ?? ''),
    queryFn: () => api.records(appId ?? ''),
    enabled: Boolean(appId),
  })
  const proposals = useQuery({
    queryKey: keys.proposals(appId ?? ''),
    queryFn: () => api.proposals(appId ?? ''),
    enabled: Boolean(appId),
  })
  const recordings = useQuery({
    queryKey: keys.recordings(appId ?? undefined),
    queryFn: () => api.recordings(appId ?? undefined),
  })

  // A create proposal has no app yet, so it lives in local state until approved.
  const [localProposal, setLocalProposal] = useState<ProposalRecord | null>(null)
  const [draft, setDraft] = useState('')
  const [view, setView] = useState<View>('live')
  const [tab, setTab] = useState('diff')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [flash, setFlash] = useState<Map<string, Mark> | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const thread = useRef<HTMLDivElement>(null)

  const onFinished = useCallback(
    (t: Turn) => {
      if (appId) {
        void qc.invalidateQueries({ queryKey: keys.proposals(appId) })
      } else if (t.proposal) {
        setLocalProposal(t.proposal)
      }
      if (t.outcome === 'pending') {
        setView('proposal')
        setTab('diff')
      }
    },
    [appId, qc],
  )
  const runner = usePlanRunner(onFinished)

  const pending: ProposalRecord | null = appId
    ? (proposals.data?.findLast((p) => p.status === 'pending') ?? null)
    : localProposal?.status === 'pending'
      ? localProposal
      : null

  useEffect(() => {
    if (!pending) setView('live')
  }, [pending])

  const history = useMemo(
    () => (proposals.data ?? []).filter((p) => p.id !== runner.turn?.proposal?.id).map(fromRecord),
    [proposals.data, runner.turn?.proposal?.id],
  )

  // Keep the newest turn in view while thinking streams in.
  const lastLen = runner.turn ? runner.turn.rounds.reduce((n, r) => n + r.thinking.length, 0) : 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on stream progress and history size
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' })
  }, [lastLen, history.length, runner.turn?.done])

  const plan = useCallback(
    (intent: string) => {
      const text = intent.trim()
      if (text.length < 2) return
      setDraft('')
      setLocalProposal(null)
      void runner.start({ intent: text, appId: appId ?? undefined }, text)
    },
    [appId, runner],
  )
  const replay = useCallback(
    (r: RecordingInfo) => {
      setLocalProposal(null)
      void runner.start({ recordingId: r.id, appId: appId ?? undefined }, r.intent)
    },
    [appId, runner],
  )

  // /studio/new?intent=… or ?recording=… starts immediately (once).
  const autostarted = useRef(false)
  useEffect(() => {
    if (appId || autostarted.current) return
    const intent = params.get('intent')
    const recording = params.get('recording')
    if (!intent && !recording) return
    autostarted.current = true
    setParams({}, { replace: true })
    if (recording) {
      void runner.start({ recordingId: recording }, params.get('label') ?? '回放演示样例')
    } else if (intent) plan(intent)
  }, [appId, params, setParams, runner, plan])

  async function approve() {
    if (!pending) return
    setBusy('approve')
    try {
      const r = await api.approve(pending.id)
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.apps }),
        qc.invalidateQueries({ queryKey: ['recordings'] }),
        ...(appId
          ? [
              qc.invalidateQueries({ queryKey: keys.app(appId) }),
              qc.invalidateQueries({ queryKey: keys.versions(appId) }),
              qc.invalidateQueries({ queryKey: keys.proposals(appId) }),
            ]
          : []),
      ])
      toast.success(appId ? `已生效：v${r.version}` : `已创建「${r.app.name}」`)
      if (!appId) {
        navigate(`/apps/${r.appId}/studio`, { replace: true })
        return
      }
      // Briefly highlight what just changed in the live app (design.md §1.3).
      const marks = diffMarks(pending.diff)
      for (const [k, v] of marks) if (v === 'hidden') marks.delete(k)
      setFlash(marks)
      setTimeout(() => setFlash(null), 1800)
      setView('live')
      runner.clear()
    } catch (e) {
      toast.error(errorMessage(e))
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT' && appId) {
        void qc.invalidateQueries({ queryKey: keys.app(appId) })
      }
    } finally {
      setBusy(null)
    }
  }

  async function reject(revise: boolean) {
    if (!pending) return
    setBusy('reject')
    try {
      const rejected = await api.reject(pending.id)
      if (appId) await qc.invalidateQueries({ queryKey: keys.proposals(appId) })
      else setLocalProposal(rejected)
      runner.clear()
      if (revise) {
        setDraft(pending.intent)
        setTimeout(() => composer.current?.focus(), 50)
      } else toast('已拒绝，应用没有改动')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  // ── loading / error ─────────────────────────────────────────────────────────
  if (appId && (app.isError || records.isError)) {
    const missing = app.error instanceof ApiError && app.error.status === 404
    return (
      <main className="mx-auto max-w-xl px-4 py-24">
        <ErrorState
          title={missing ? '应用不存在' : '加载失败'}
          message={missing ? '返回应用中心查看全部应用。' : errorMessage(app.error ?? records.error)}
          onRetry={missing ? undefined : () => Promise.all([app.refetch(), records.refetch()])}
        />
      </main>
    )
  }
  const loading = appId !== null && (app.isPending || records.isPending)

  const current: AppDefinition | null = app.data?.definition ?? null
  const previewDef = view === 'proposal' && pending?.after ? pending.after : current
  const marks =
    view === 'proposal' && pending
      ? appId
        ? diffMarks(pending.diff)
        : new Map((pending.after?.nodes ?? []).map((n) => [n.id, 'added' as Mark]))
      : (flash ?? undefined)
  const applicable = (recordings.data ?? []).filter((r) =>
    appId ? r.kind !== 'create' && r.applicable : r.kind === 'create',
  )
  const lockedReason = runner.running
    ? 'AI 正在规划…'
    : pending
      ? '请先在右侧批准、继续修改或拒绝当前提案'
      : null
  const latestTurn = runner.turn

  return (
    <div className="grid min-h-[calc(100dvh-3.5rem)] grid-cols-1 xl:h-[calc(100dvh-3.5rem)] xl:grid-cols-[340px_minmax(0,1fr)_380px]">
      {/* ── left: conversation ─────────────────────────────────────────────── */}
      <section className="flex min-h-0 flex-col border-border xl:border-r" aria-label="对话">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Link to={appId ? `/apps/${appId}` : '/'} className="text-muted hover:text-fg" aria-label="返回">
            <ArrowLeft className="size-4" />
          </Link>
          {app.data ? <AppIcon name={app.data.icon} size="sm" /> : null}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{app.data?.name ?? '新建应用'}</h1>
            <p className="text-[11px] text-muted">
              AI Studio{app.data ? ` · v${app.data.version} · ${app.data.recordCount} 条记录` : ''}
            </p>
          </div>
          {appId ? (
            <Link
              to={`/apps/${appId}`}
              className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg"
              title="打开独立运行界面"
            >
              运行界面 <ExternalLink className="size-3" />
            </Link>
          ) : null}
        </div>
        <div ref={thread} className="flex-1 space-y-5 overflow-y-auto p-4">
          {history.length === 0 && !latestTurn ? (
            <EmptyState
              icon={<MessageSquare className="size-6" />}
              title={appId ? '用一句话让应用继续进化' : '描述你想要的应用'}
              hint={
                appId
                  ? '例如：“加一个签到功能，找出还没签到的人并生成提醒，旁边显示签到率”。AI 只会提出增量变更，你批准后才生效。'
                  : '例如：“创建一个校园讲座报名系统，包含姓名、学号、专业、手机号”。'
              }
            />
          ) : null}
          {history.map((t) => (
            <TurnCard
              key={t.key}
              turn={t}
              current={t.proposal?.id === pending?.id}
              onRetry={aiConfigured ? plan : undefined}
              onEdit={(i) => {
                setDraft(i)
                composer.current?.focus()
              }}
            />
          ))}
          {latestTurn ? (
            <TurnCard
              turn={latestTurn}
              current={Boolean(pending && latestTurn.proposal?.id === pending.id)}
              onRetry={aiConfigured ? plan : undefined}
              onEdit={(i) => {
                setDraft(i)
                composer.current?.focus()
              }}
            />
          ) : null}
        </div>
        <div className="border-t border-border p-3">
          <Composer
            ref={composer}
            value={draft}
            onChange={setDraft}
            onSubmit={() => plan(draft)}
            onReplay={replay}
            lockedReason={lockedReason}
            aiConfigured={aiConfigured}
            recordings={applicable}
            placeholder={appId ? '描述新的需求，例如：加一个签到功能…' : '描述你想要的应用…'}
          />
        </div>
      </section>

      {/* ── center: live app or ghost preview ─────────────────────────────── */}
      <section className="flex min-h-0 flex-col bg-bg" aria-label="预览">
        <div className="flex h-12 items-center gap-2 border-b border-border px-4">
          <div className="inline-flex rounded-[var(--radius-control)] border border-border bg-surface p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setView('live')}
              disabled={!current}
              className={cn(
                'rounded-[6px] px-2.5 py-1 font-medium transition-colors duration-150',
                view === 'live' ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
              )}
            >
              {current ? `当前 v${app.data?.version}` : '当前'}
            </button>
            <button
              type="button"
              onClick={() => setView('proposal')}
              disabled={!pending}
              className={cn(
                'inline-flex items-center gap-1 rounded-[6px] px-2.5 py-1 font-medium transition-colors duration-150 disabled:opacity-40',
                view === 'proposal' ? 'bg-morph-soft text-morph' : 'text-muted hover:text-fg',
              )}
            >
              <Eye className="size-3.5" /> 提案预览
            </button>
          </div>
          {view === 'proposal' && pending ? (
            <p className="truncate text-[11px] text-muted">
              用真实的 {records.data?.length ?? 0} 条记录渲染提案；虚线为 AI 新增，批准前不写入任何数据
            </p>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="grid gap-4">
              <Skeleton className="h-32" />
              <Skeleton className="h-72" />
            </div>
          ) : previewDef ? (
            <AppRuntime
              appId={appId ?? ''}
              definition={previewDef}
              records={records.data ?? []}
              mode={view === 'proposal' ? 'preview' : 'live'}
              marks={marks}
            />
          ) : (
            <EmptyState
              className="h-full"
              icon={<Layers className="size-6" />}
              title={runner.running ? 'AI 正在生成应用…' : '应用预览'}
              hint={
                runner.running
                  ? '生成并通过校验后，这里会显示完整的应用预览。'
                  : 'AI 生成的应用会在这里以真实组件预览。'
              }
            />
          )}
        </div>
      </section>

      {/* ── right: diff / versions / schema ───────────────────────────────── */}
      <section className="flex min-h-0 flex-col border-border bg-surface xl:border-l" aria-label="变更与版本">
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="pt-1">
            <TabsTrigger value="diff">
              <GitCompare className="size-3.5" /> 变更
              {pending ? <span className="size-1.5 rounded-full bg-morph" /> : null}
            </TabsTrigger>
            {appId ? (
              <TabsTrigger value="versions">
                <ClockArrowUp className="size-3.5" /> 版本
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="schema">
              <Layers className="size-3.5" /> 结构
            </TabsTrigger>
          </TabsList>
          <TabsContent value="diff" className="min-h-0 flex-1 data-[state=inactive]:hidden">
            {pending ? (
              <DiffPanel
                proposal={pending}
                before={current}
                busy={busy}
                onApprove={approve}
                onRevise={() => reject(true)}
                onReject={() => reject(false)}
              />
            ) : (
              <EmptyState
                className="h-full"
                icon={<GitCompare className="size-6" />}
                title="暂无待批准的变更"
                hint="AI 的每个提案都会先在这里以 Morph Diff 展示：新增、修改、保留、影响与六层校验结果。你批准后才会生效。"
              />
            )}
          </TabsContent>
          {appId && app.data ? (
            <TabsContent
              value="versions"
              className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
            >
              <VersionsPanel app={app.data} locked={Boolean(pending)} onRestored={() => setView('live')} />
            </TabsContent>
          ) : null}
          <TabsContent value="schema" className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden">
            {previewDef ? (
              <>
                {view === 'proposal' ? (
                  <div className="px-4 pt-3">
                    <Badge tone="morph">提案中的结构</Badge>
                  </div>
                ) : null}
                <SchemaPanel definition={previewDef} />
              </>
            ) : (
              <EmptyState className="h-full" title="还没有应用结构" />
            )}
          </TabsContent>
        </Tabs>
      </section>
    </div>
  )
}
