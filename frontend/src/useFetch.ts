import { useCallback, useEffect, useRef, useState } from 'react'

export interface FetchState<T> {
  data: T | null
  error: unknown | null
  loading: boolean
  /** true while a background refresh is in flight and data is already present */
  refreshing: boolean
  reload: () => Promise<void>
  /** Replace the cached data without a network call */
  set: (updater: (prev: T | null) => T | null) => void
}

/**
 * Small data hook: explicit loading / error / data. `key` changes trigger a reload with the loading flag;
 * `reload()` refreshes in the background and keeps showing stale data until the response arrives.
 */
export function useFetch<T>(fn: () => Promise<T>, key: unknown[], enabled = true): FetchState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [refreshing, setRefreshing] = useState(false)
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })
  const gen = useRef(0)

  const run = useCallback(async (background: boolean) => {
    const my = ++gen.current
    if (background) setRefreshing(true)
    else setLoading(true)
    try {
      const d = await fnRef.current()
      if (my !== gen.current) return
      setData(d)
      setError(null)
    } catch (e) {
      if (my !== gen.current) return
      setError(e)
    } finally {
      if (my === gen.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    void run(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...key])

  const reload = useCallback(() => run(true), [run])
  const set = useCallback((updater: (prev: T | null) => T | null) => setData((p) => updater(p)), [])
  return { data, error, loading, refreshing, reload, set }
}

/** Coalesce many calls into at most one every `ms`, always running the trailing call. */
export function useThrottledCallback(fn: () => void, ms: number): () => void {
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })
  const last = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return useCallback(() => {
    const now = Date.now()
    const elapsed = now - last.current
    if (elapsed >= ms && !timer.current) {
      last.current = now
      fnRef.current()
      return
    }
    if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null
        last.current = Date.now()
        fnRef.current()
      }, Math.max(0, ms - elapsed))
    }
  }, [ms])
}

export function useInterval(fn: () => void, ms: number | null) {
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })
  useEffect(() => {
    if (ms === null) return
    const id = setInterval(() => fnRef.current(), ms)
    return () => clearInterval(id)
  }, [ms])
}
