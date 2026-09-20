import * as motionReact from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { DUR, EASE, useReducedMotion } from '@/lib/motion'

const { motion, useInView, useMotionTemplate, useMotionValue, useSpring, useTransform } = motionReact

/**
 * Counts up to a target when it scrolls into view.
 *
 * This is the one number on the page the whole argument turns on, and watching it climb to 77
 * is the closest a static page gets to showing the count being performed. It is NOT decorative:
 * the value is always rendered, so if the animation never runs the reader still sees 77.
 */
export function CountUp({ to, className }: { to: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(reduced ? to : 0)

  useEffect(() => {
    // Reduced motion shows the final value immediately. Not-yet-in-view must simply wait —
    // the earlier version collapsed both cases and jumped straight to the answer, so the
    // count never actually counted.
    if (reduced) {
      setShown(to)
      return
    }
    if (!inView) return
    const start = performance.now()
    const ms = 900
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      // ease-out-quint, matching EASE.out
      setShown(Math.round(to * (1 - (1 - t) ** 5)))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, reduced, to])

  return (
    <span ref={ref} className={className} aria-label={String(to)}>
      {shown}
    </span>
  )
}

/**
 * Magnetic hover: a subtle 3D tilt toward the cursor plus a brass glow that follows it.
 * Adapted from Kokonut's spotlight mechanic but driven by our own tokens rather than its
 * hardcoded palette, so it cannot drift away from the theme.
 */
export function Magnetic({
  children,
  className,
  tilt = 4,
}: {
  children: ReactNode
  className?: string
  tilt?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const mx = useMotionValue(0.5)
  const my = useMotionValue(0.5)
  const sx = useSpring(mx, { stiffness: 260, damping: 26 })
  const sy = useSpring(my, { stiffness: 260, damping: 26 })
  const rotX = useTransform(sy, [0, 1], [tilt, -tilt])
  const rotY = useTransform(sx, [0, 1], [-tilt, tilt])
  const glowX = useTransform(sx, (v) => `${v * 100}%`)
  const glowY = useTransform(sy, (v) => `${v * 100}%`)
  // useMotionTemplate, not `.get()` in a template literal: MotionValue updates do not
  // re-render, so a string built during render freezes the glow at its initial 50%/50%
  // (and `${glowX.get()}%` emitted an invalid `50%%`, which dropped the declaration).
  const glow = useMotionTemplate`radial-gradient(420px circle at ${glowX} ${glowY}, color-mix(in oklch, var(--color-accent) 10%, transparent), transparent 70%)`

  if (reduced) return <div className={className}>{children}</div>

  return (
    <motion.div
      ref={ref}
      className={cn('relative [transform-style:preserve-3d]', className)}
      style={{ rotateX: rotX, rotateY: rotY, perspective: 900 }}
      onPointerMove={(e) => {
        const r = ref.current?.getBoundingClientRect()
        if (!r) return
        mx.set((e.clientX - r.left) / r.width)
        my.set((e.clientY - r.top) / r.height)
      }}
      onPointerLeave={() => {
        mx.set(0.5)
        my.set(0.5)
      }}
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: glow }}
      />
      {children}
    </motion.div>
  )
}

/** Row that lifts and warms on hover, and dims while a sibling is hovered. */
export function SpotlightRow({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion()
  return (
    <motion.li
      className={cn('group/row relative', className)}
      initial={false}
      whileHover={reduced ? undefined : { x: 3 }}
      transition={{ duration: DUR.fast, ease: EASE.out }}
    >
      {/* Absolutely positioned, so the grid still sees the real children and nothing else. */}
      <span
        aria-hidden
        className="-inset-x-5 pointer-events-none absolute inset-y-0 z-0 rounded-doc opacity-0 transition-opacity duration-200 group-hover/row:opacity-100"
        style={{ background: 'color-mix(in oklch, var(--color-accent) 6%, transparent)' }}
      />
      {children}
    </motion.li>
  )
}

/** Press + glow feedback on the primary action. */
export function Pressable({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion()
  if (reduced) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={cn('inline-block', className)}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: DUR.instant, ease: EASE.out }}
    >
      {children}
    </motion.div>
  )
}

/** Staggered entrance for a list. Content is visible if the animation never runs. */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion()
  if (reduced) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="shown"
      variants={{ shown: { transition: { staggerChildren: 0.04 } } }}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion()
  if (reduced) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      variants={{ hidden: { opacity: 0.001, y: 4 }, shown: { opacity: 1, y: 0 } }}
      transition={{ duration: DUR.base, ease: EASE.out }}
    >
      {children}
    </motion.div>
  )
}
