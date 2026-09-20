import { Check, Copy } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * Mono, escaped, copyable evidence text.
 *
 * SECURITY: log-derived text is untrusted and this dataset really does contain script-like
 * values (e.g. `script=success`). Everything here goes through React's text interpolation,
 * which escapes it. Never add dangerouslySetInnerHTML to this file, and never add syntax
 * highlighting that works by injecting HTML. Acceptance test S01 covers this.
 */
export function CodeBlock({
  code,
  label,
  lineNumbers = false,
  startLine = 1,
  maxHeight,
  className,
  copyable = true,
  wrap = true,
}: {
  code: string
  /** Short caption, e.g. "raw log line 168338". */
  label?: ReactNode
  lineNumbers?: boolean
  startLine?: number
  /** CSS length. Scrolls beyond this. */
  maxHeight?: string
  className?: string
  copyable?: boolean
  /**
   * Wrap long lines instead of scrolling them. On by default: evidence the reader has to
   * scroll sideways to finish reading is evidence they will not check, and an unconstrained
   * <pre> widens its grid track, which broke the mobile layout.
   */
  wrap?: boolean
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  const onCopy = useCallback(() => {
    void navigator.clipboard?.writeText(code).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }, [code])

  const lines = code.split('\n')

  return (
    <figure
      data-slot="code-block"
      className={cn('group/code relative w-full min-w-0 overflow-hidden rounded-lg border border-border bg-surface', className)}
    >
      {label ? (
        <figcaption className="flex items-center justify-between gap-2 border-b border-border bg-surface-raised px-3 py-1.5 text-caption text-fg-muted uppercase">
          {label}
        </figcaption>
      ) : null}

      {copyable ? (
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? 'Copied' : 'Copy to clipboard'}
          className={cn(
            'absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-md border border-border',
            'bg-surface-raised px-2 py-1 text-caption text-fg-muted',
            'opacity-0 transition-opacity duration-150 group-hover/code:opacity-100 focus-visible:opacity-100',
            label && 'top-9',
          )}
        >
          {copied ? <Check className="size-3 text-normal" /> : <Copy className="size-3" />}
          {copied ? 'copied' : 'copy'}
        </button>
      ) : null}

      <pre
        className={cn(
          'px-3 py-2.5 font-mono text-mono text-fg',
          wrap ? 'whitespace-pre-wrap break-all' : 'overflow-x-auto',
          maxHeight && 'overflow-y-auto',
        )}
        style={maxHeight ? { maxHeight } : undefined}
        tabIndex={0}
      >
        <code>
          {lineNumbers
            ? lines.map((line, i) => (
                // Log lines are positional; index is the only stable identity they have.
                // eslint-disable-next-line react/no-array-index-key
                <span key={i} className="grid grid-cols-[3.5ch_1fr] gap-3">
                  <span className="select-none text-right text-fg-subtle tabular-nums">{startLine + i}</span>
                  <span className="break-all whitespace-pre-wrap">{line}</span>
                </span>
              ))
            : code}
        </code>
      </pre>
    </figure>
  )
}

/** Inline mono for a single ID, hash or short evidence fragment. */
export function CodeInline({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code
      className={cn(
        'rounded-sm border border-border bg-surface px-1 py-0.5 font-mono text-[0.8125em] break-all text-fg',
        className,
      )}
    >
      {children}
    </code>
  )
}
