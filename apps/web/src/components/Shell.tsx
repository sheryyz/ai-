import { Monitor, Moon, Smartphone, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router'
import { ApiError } from '../lib/api'
import { useApps, useHealth } from '../lib/queries'
import { Button } from './ui/button'

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-morph" />
      <path
        d="M8 22V10l8 7 8-7v12"
        fill="none"
        className="stroke-on-morph"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Live vs offline is always visible (requirements §9.3: never pass recordings off as live AI). */
export function StatusPill() {
  const health = useHealth()
  const base = 'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium tabular-nums'
  if (health.isPending) return <span className={`${base} border-border text-muted`}>正在连接服务…</span>
  if (health.isError) {
    return (
      <span className={`${base} border-danger/40 text-danger`} role="alert">
        <span className="size-1.5 rounded-full bg-danger" />
        服务未启动 · 请运行 npm run dev
      </span>
    )
  }
  const { ai } = health.data
  return ai.configured ? (
    <span className={`${base} border-morph/40 bg-morph-soft text-morph`} title={`模型服务：${ai.provider}`}>
      <span className="size-1.5 animate-[breathe_1.6s_ease-in-out_infinite] rounded-full bg-morph" />
      AI 实时 · {ai.model}
    </span>
  ) : (
    <span
      className={`${base} border-border text-muted`}
      title="未配置 LLM_API_KEY：已有应用全部可用，AI 生成只能回放演示样例"
    >
      <span className="size-1.5 rounded-full bg-muted" />
      离线模式 · 未配置模型
    </span>
  )
}

type Theme = 'system' | 'light' | 'dark'
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_LABEL: Record<Theme, string> = { system: '跟随系统', light: '亮色', dark: '暗色' }

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('morphos.theme')
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('morphos.theme', theme)
    } catch {
      /* private mode: theme just won't persist */
    }
  }, [theme])
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(NEXT[theme])}
      aria-label={`主题：${THEME_LABEL[theme]}，点击切换`}
      title={`主题：${THEME_LABEL[theme]}`}
    >
      <Icon className="size-4" />
    </Button>
  )
}

/** ADR-0008: the admin API answers only this machine. Another device gets a plain explanation, not broken pages. */
function RemoteNotice() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <Smartphone className="mb-4 size-8 text-muted" />
      <h1 className="text-lg font-semibold">这是组织者的管理端</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        管理端只能在运行 MorphOS
        的那台电脑上使用。如果你是来报名、签到或借用的，请打开组织者发给你的页面链接或扫描二维码。
      </p>
    </main>
  )
}

export function Shell() {
  const apps = useApps()
  const remote = apps.error instanceof ApiError && apps.error.code === 'ADMIN_LOCAL_ONLY'
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-[var(--radius-control)] focus-visible:outline-2 focus-visible:outline-morph"
          >
            <Logo />
            <span className="text-[15px] font-semibold tracking-tight">MorphOS</span>
          </Link>
          <div className="flex items-center gap-2">
            {remote ? null : <StatusPill />}
            <ThemeToggle />
          </div>
        </div>
      </header>
      {remote ? <RemoteNotice /> : <Outlet />}
    </div>
  )
}
