/*
 * Motion tokens (design contract §5). Both agents import from here — never hand-write a
 * duration or easing curve in a component.
 *
 * Budget: nothing over 300ms except `slow`, which is reserved for full-surface transitions
 * (sheets, route changes). Everything is eased; linear is a bug.
 *
 * The CSS mirrors of `out` / `inOut` live in src/styles/theme.css as --ease-out-quint and
 * --ease-in-out-quint. Keep the two in sync.
 */
import { type Transition, useReducedMotion } from 'motion/react'

export const DUR = { instant: 0.1, fast: 0.18, base: 0.26, slow: 0.42 } as const

export const EASE = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
  spring: { type: 'spring', stiffness: 400, damping: 34 },
} as const

/** Re-exported so components never import motion/react directly just for this. */
export { useReducedMotion }

/**
 * Standard entrance: a short rise + fade. Returns a no-op variant pair when the user has
 * asked for reduced motion, so callers get accessibility for free instead of opting in.
 */
export function useRise(distance = 8) {
  const reduced = useReducedMotion()
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: distance },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduced ? DUR.instant : DUR.base, ease: EASE.out } satisfies Transition,
  }
}

/** Transition for layout/shared-element changes — explains where a thing moved to. */
export function useLayoutTransition(): Transition {
  const reduced = useReducedMotion()
  return reduced ? { duration: DUR.instant } : { duration: DUR.base, ease: EASE.out }
}

/** Stagger helper for lists. Caps total stagger so long lists never feel slow. */
export function stagger(count: number, per = 0.03) {
  return Math.min(per, 0.24 / Math.max(count, 1))
}
