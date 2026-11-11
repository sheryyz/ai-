import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, errorMessage } from '../lib/api'
import { type PlanRequest, streamPlan } from '../lib/plan-stream'
import { newTurn, reduceTurn, type Turn } from './turn'

/** Runs one planning request and folds its event stream into a Turn. */
export function usePlanRunner(onFinished: (turn: Turn) => void) {
  const [turn, setTurn] = useState<Turn | null>(null)
  const ctrl = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const finished = useRef(onFinished)
  finished.current = onFinished

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // Deferred so React StrictMode's simulated unmount/remount does not cancel an in-flight plan.
      const c = ctrl.current
      setTimeout(() => {
        if (!mounted.current) c?.abort()
      }, 0)
    }
  }, [])

  const start = useCallback(async (req: PlanRequest, intent: string) => {
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    let t = newTurn(intent)
    setTurn(t)
    try {
      await streamPlan(
        req,
        (ev) => {
          t = reduceTurn(t, ev)
          setTurn(t)
        },
        c.signal,
      )
    } catch (e) {
      t = { ...t, error: { code: e instanceof ApiError ? e.code : 'ERROR', message: errorMessage(e) } }
    }
    if (c.signal.aborted) return
    t = { ...t, done: true, totalMs: t.totalMs ?? Date.now() - t.startedAt }
    setTurn(t)
    finished.current(t)
  }, [])

  return { turn, start, running: turn !== null && !turn.done, clear: () => setTurn(null) }
}
