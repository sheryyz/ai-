import { useEffect, useState } from 'react'

interface Health {
  ok: boolean
  protocolVersion: number
  ai: { configured: boolean; model: string; provider: string }
}

type HealthState = { status: 'loading' } | { status: 'ok'; data: Health } | { status: 'error' }

function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ status: 'loading' })
  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/health', { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => setState({ status: 'ok', data }))
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setState({ status: 'error' })
      })
    return () => ctrl.abort()
  }, [])
  return state
}

function StatusPill({ health }: { health: HealthState }) {
  const base = 'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium tabular-nums'
  if (health.status === 'loading') {
    return <span className={`${base} border-border text-muted`}>正在连接服务…</span>
  }
  if (health.status === 'error') {
    return (
      <span className={`${base} border-danger/40 text-danger`}>
        <span className="size-1.5 rounded-full bg-danger" />
        服务未启动 · 请运行 npm run dev
      </span>
    )
  }
  const { ai } = health.data
  return ai.configured ? (
    <span className={`${base} border-morph/40 bg-morph-soft text-morph`}>
      <span className="size-1.5 animate-pulse rounded-full bg-morph" />
      AI 实时 · {ai.model}
    </span>
  ) : (
    <span className={`${base} border-border text-muted`}>
      <span className="size-1.5 rounded-full bg-muted" />
      离线模式 · 未配置模型
    </span>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-morph" />
      <path
        d="M8 22V10l8 7 8-7v12"
        fill="none"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const PIPELINE = ['理解意图', '规划能力', '生成提案', '六层校验', '变更预览', '人工批准']

export function App() {
  const health = useHealth()
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[15px] font-semibold tracking-tight">MorphOS</span>
          </div>
          <StatusPill health={health} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-24 pb-16 sm:px-6">
        <p className="font-mono text-xs tracking-wider text-morph uppercase">Intent → Verified Evolution</p>
        <h1 className="mt-4 max-w-3xl text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
          用一句话生成应用，
          <br />
          再用一句话让它<span className="text-morph">持续进化</span>。
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted">
          每一次变更都经过六层校验、以差异形式呈现，并在你批准后生效。界面可以回到任何历史版本，业务数据永远不会丢失。
        </p>

        <ol className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {PIPELINE.map((step, i) => (
            <li key={step} className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
              <span className="font-mono text-[11px] text-muted tabular-nums">
                {String(i + 1).padStart(2, '0')}
              </span>
              <p className="mt-1 text-sm font-medium">{step}</p>
            </li>
          ))}
        </ol>

        <p className="mt-10 text-xs text-muted">
          阶段 0 · 工程骨架。应用中心、AI Studio 与运行界面将在后续阶段实现。
        </p>
      </main>
    </div>
  )
}
