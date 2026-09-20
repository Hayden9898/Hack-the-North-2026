import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export interface VirtualWindow {
  /** index of the first row to render */
  start: number
  /** index just past the last row to render */
  end: number
  /** spacer height above the rendered rows */
  padTop: number
  /** spacer height below the rendered rows */
  padBottom: number
}

/**
 * Fixed-height row virtualisation.
 *
 * The feed is bounded to a rolling window of rows, but even that should not become that many
 * DOM nodes — and the same table is the one a judge scrolls during a live replay, so it has to
 * stay smooth while rows stream in. No dependency: fixed-height rows make the arithmetic
 * trivial, and a virtualisation library would have cost a `package.json` line for it.
 */
export function useVirtualRows(
  count: number,
  rowHeight: number,
  overscan = 8,
): { ref: (el: HTMLElement | null) => void; window: VirtualWindow; onScroll: () => void } {
  const elRef = useRef<HTMLElement | null>(null)
  const [range, setRange] = useState({ scrollTop: 0, viewport: 0 })

  const measure = useCallback(() => {
    const el = elRef.current
    if (!el) return
    setRange((prev) =>
      prev.scrollTop === el.scrollTop && prev.viewport === el.clientHeight
        ? prev
        : { scrollTop: el.scrollTop, viewport: el.clientHeight },
    )
  }, [])

  const ref = useCallback(
    (el: HTMLElement | null) => {
      elRef.current = el
      if (el) measure()
    },
    [measure],
  )

  // Viewport height is unknown until layout; measure once mounted and on resize.
  useLayoutEffect(() => {
    measure()
    const el = elRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  const viewport = range.viewport || 420
  const first = Math.max(0, Math.floor(range.scrollTop / rowHeight) - overscan)
  const visible = Math.ceil(viewport / rowHeight) + overscan * 2
  const start = Math.min(first, Math.max(0, count - 1))
  const end = Math.min(count, start + visible)

  return {
    ref,
    onScroll: measure,
    window: {
      start,
      end,
      padTop: start * rowHeight,
      padBottom: Math.max(0, (count - end) * rowHeight),
    },
  }
}
