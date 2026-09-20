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
  wrap = 'mobile',
  emphasize,
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
   * 'mobile' (default) keeps the line intact on one row at >=640px and wraps it below that.
   *
   * The wrap breaks at spaces via overflow-wrap, NOT break-all, so tokens stay whole — the
   * longest token here (the 42-char path) still fits a 390px column. Horizontal scrolling
   * alone was wrong on a phone: the line clipped mid-character at the border, so the status
   * code and byte count — the entire argument — were unreachable unless you guessed the box
   * scrolled.
   */
  wrap?: 'never' | 'mobile' | 'always'
  /**
   * Substrings to mark inside the code. Matching is literal and the output still goes through
   * React's text escaping — this exists so evidence can point at the decisive token without
   * anyone reaching for dangerouslySetInnerHTML.
   */
  emphasize?: string[]
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
      className={cn('group/code relative w-full min-w-0 overflow-hidden rounded-doc border border-border bg-surface', className)}
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
          'px-3 py-2.5 font-mono text-[0.75rem] text-fg sm:text-mono',
          wrap === 'always' && 'whitespace-pre-wrap [overflow-wrap:break-word]',
          wrap === 'never' && 'overflow-x-auto whitespace-pre',
          wrap === 'mobile' &&
            'whitespace-pre-wrap [overflow-wrap:break-word] sm:overflow-x-auto sm:whitespace-pre',
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
            : marked(code, emphasize)}
        </code>
      </pre>
    </figure>
  )
}

/**
 * Splits text on the given substrings and wraps the matches in <mark>. Returns plain strings
 * and elements — never HTML — so untrusted log text stays escaped by React.
 */
function marked(code: string, emphasize?: string[]) {
  if (!emphasize || emphasize.length === 0) return code
  const pattern = emphasize.filter(Boolean).sort((a, b) => b.length - a.length)
  if (pattern.length === 0) return code

  const out: ReactNode[] = []
  let rest = code
  let key = 0
  while (rest.length > 0) {
    let at = -1
    let hit = ''
    for (const p of pattern) {
      const i = rest.indexOf(p)
      if (i !== -1 && (at === -1 || i < at)) {
        at = i
        hit = p
      }
    }
    if (at === -1) {
      out.push(rest)
      break
    }
    if (at > 0) out.push(rest.slice(0, at))
    out.push(
      <mark key={key++} className="rounded-[2px] bg-accent/20 px-0.5 text-fg">
        {hit}
      </mark>,
    )
    rest = rest.slice(at + hit.length)
  }
  return out
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
