import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { ThemeToggle } from './components/ThemeToggle'
import { Toast } from './components/ui/toast'
import {
  api,
  describeError,
  setOperatorToken,
  subscribeDbStatus,
  subscribeOperatorToken,
  type Health,
} from './api'
import { degradedModeLabel } from './format'
import { cn } from './lib/cn'
import { MonitoringCheck } from './MonitoringCheck'
import { useFetch, useInterval } from './useFetch'

/** Shared chip shell: the header status controls all read as one row of the same object. */
const CHIP = 'inline-flex items-center gap-2 rounded-md border px-2.5 py-1 font-mono text-caption uppercase transition-colors duration-150'

/**
 * The console shell.
 *
 * The chrome here is on the shared tokens (same masthead language as the landing page), while
 * the screens inside `<main className="page">` are still the hand-rolled console stylesheet in
 * src/index.css — whose palette is now aliased onto those same tokens, so the two halves match
 * and both follow the light/dark toggle.
 */
export default function App() {
  const health = useFetch<Health>(() => api.health(), [])
  const [dbDown, setDbDown] = useState(false)
  useEffect(() => subscribeDbStatus(setDbDown), [])
  useInterval(() => void health.reload(), 30_000)

  const healthErr = health.error ? describeError(health.error) : null
  const notReady = !!health.data && health.data.status !== 'ready'
  const showDbBanner = dbDown || healthErr?.status === 503 || (health.data ? !health.data.database.ok : false)

  return (
    <div className="app min-h-dvh bg-bg">
      <header className="sticky top-0 z-40 border-border border-b bg-bg/85 backdrop-blur-md">
        <div className="flex items-center gap-5 px-5 py-2.5 sm:px-8">
          <NavLink to="/app" className="group flex items-baseline gap-2.5 rounded-sm no-underline">
            <span aria-hidden className="h-4 w-0.5 shrink-0 self-center rounded-full bg-accent" />
            <span className="font-sans text-[1.25rem] text-fg leading-none tracking-tight">Log &amp; Order</span>
            <span className="hidden font-mono text-caption text-fg-subtle uppercase sm:inline">console</span>
          </NavLink>

          <nav className="flex items-center gap-1">
            <NavLink
              to="/app"
              end
              className={({ isActive }) =>
                cn(
                  'rounded-md px-2.5 py-1 font-mono text-caption uppercase no-underline transition-colors duration-150',
                  isActive ? 'bg-chip text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                )
              }
            >
              Runs
            </NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <MonitoringCheck />
            {health.data ? <OperatorToken required={health.data.auth?.operator_required ?? false} /> : null}
            <HealthChip health={health.data} error={health.error} loading={health.loading} onRetry={() => void health.reload()} />
            <ThemeToggle />
            <NavLink
              to="/"
              className="hidden items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-caption text-fg-muted uppercase no-underline transition-colors duration-150 hover:border-border-strong hover:text-fg sm:inline-flex"
            >
              <ArrowLeft className="size-3" /> Overview
            </NavLink>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-px">
        {showDbBanner ? (
          <Banner tone="danger" role="alert">
            <strong className="font-semibold">Database unavailable.</strong> The API returned 503 or reported the database as down. Nothing shown
            below is being refreshed; this console never fabricates a healthy feed.
            <BannerAction onClick={() => void health.reload()}>Re-check</BannerAction>
          </Banner>
        ) : null}

        {!showDbBanner && healthErr && healthErr.status !== 503 ? (
          <Banner tone="warn" role="alert">
            <strong className="font-semibold">Health check failed</strong> ({healthErr.status ?? 'no response'}: {healthErr.text}).
            <BannerAction onClick={() => void health.reload()}>Retry</BannerAction>
          </Banner>
        ) : null}

        {!showDbBanner && notReady && health.data ? (
          <Banner tone="danger" role="alert">
            <strong className="font-semibold">API not ready</strong> — status {health.data.status}
            {health.data.not_ready_reasons?.length ? ` (${health.data.not_ready_reasons.map((r) => r.replaceAll('_', ' ')).join(', ')})` : ''}.
            database ok: {String(health.data.database.ok)}; migrations ok: {String(health.data.migrations.ok)} (
            {health.data.migrations.current ?? '?'} / {health.data.migrations.head ?? '?'}); config ok: {String(health.data.config.ok)}.
          </Banner>
        ) : null}

        {health.data && health.data.degraded_modes.length > 0 ? (
          <Banner tone="pending" role="status">
            <span className="font-mono text-caption uppercase">Degraded modes declared by the API</span>
            <span className="flex flex-wrap gap-1.5">
              {health.data.degraded_modes.map((m) => (
                <span
                  key={m}
                  className="state-hatch rounded-sm border border-pending/45 px-1.5 py-0.5 font-mono text-[0.6875rem] text-pending uppercase"
                >
                  {degradedModeLabel(m)}
                </span>
              ))}
            </span>
          </Banner>
        ) : null}
      </div>

      <main className="page">
        <Outlet />
      </main>
      <Toast />
    </div>
  )
}

const BANNER_TONE = {
  danger: 'border-high-risk/30 bg-high-risk-wash text-fg',
  warn: 'border-suspicious/35 bg-suspicious-wash text-fg',
  pending: 'border-border bg-chip text-fg-muted',
} as const

function Banner({
  tone,
  role,
  children,
}: {
  tone: keyof typeof BANNER_TONE
  role: 'alert' | 'status'
  children: ReactNode
}) {
  return (
    <div role={role} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-2.5 text-body sm:px-8', BANNER_TONE[tone])}>
      {children}
    </div>
  )
}

function BannerAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2 py-1 font-mono text-caption text-fg uppercase transition-colors duration-150 hover:bg-hover"
    >
      <RefreshCw className="size-3" />
      {children}
    </button>
  )
}

/**
 * Shared deployments require an operator bearer token for mutations (creating runs, replay control, feedback,
 * aggregate refresh). Reads are open. The token stays in this tab and is sent only as an Authorization header.
 */
function OperatorToken({ required }: { required: boolean }) {
  const [present, setPresent] = useState(false)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  useEffect(() => subscribeOperatorToken(setPresent), [])

  function save(e: FormEvent) {
    e.preventDefault()
    setOperatorToken(value)
    setValue('')
    setOpen(false)
  }

  if (!open) {
    // Absent-but-required is a real problem (mutations will 401); absent-and-optional is just information,
    // so it stays neutral rather than borrowing a verdict colour.
    const tone = present
      ? 'border-normal/30 bg-normal-wash text-normal'
      : required
        ? 'border-high-risk/35 bg-high-risk-wash text-high-risk'
        : 'border-border bg-chip text-fg-subtle'
    return (
      <button
        type="button"
        className={cn(CHIP, tone, 'hidden md:inline-flex')}
        onClick={() => setOpen(true)}
        title={
          present
            ? 'Operator token set for this tab; click to replace or clear it'
            : required
              ? 'Mutations need an operator token on this deployment'
              : 'This deployment accepts local mutations without a token; set one if the API rejects them'
        }
      >
        <Dot className={present ? 'bg-normal-mark' : required ? 'bg-high-risk-mark' : 'bg-pending'} />
        operator {present ? 'authenticated' : required ? 'token required' : 'no token'}
      </button>
    )
  }

  return (
    <form onSubmit={save} className="flex items-center gap-1.5">
      <input
        type="password"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="APP_AUTH_SECRET"
        aria-label="operator token"
        autoComplete="off"
        spellCheck={false}
        className="w-44 rounded-md border border-border bg-surface px-2 py-1 font-mono text-caption text-fg placeholder:text-fg-subtle"
      />
      <TokenButton type="submit" emphasis>
        Use
      </TokenButton>
      {present ? (
        <TokenButton
          onClick={() => {
            setOperatorToken('')
            setValue('')
            setOpen(false)
          }}
        >
          Clear
        </TokenButton>
      ) : null}
      <TokenButton onClick={() => setOpen(false)}>Cancel</TokenButton>
    </form>
  )
}

function TokenButton({
  children,
  emphasis,
  onClick,
  type = 'button',
}: {
  children: ReactNode
  emphasis?: boolean
  onClick?: () => void
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-1 font-mono text-caption uppercase transition-colors duration-150',
        emphasis
          ? 'border-accent bg-accent text-accent-fg hover:opacity-90'
          : 'border-border bg-surface text-fg-muted hover:bg-hover hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Live API state. The dot is the fastest read on the page, so it carries the status and the
 * words only qualify it — and it stops pulsing under reduced motion.
 */
function HealthChip({ health, error, loading, onRetry }: { health: Health | null; error: unknown; loading: boolean; onRetry: () => void }) {
  if (loading && !health) {
    return (
      <span className={cn(CHIP, 'border-border bg-chip text-fg-subtle')}>
        <Dot className="bg-pending" /> checking…
      </span>
    )
  }
  if (error && !health) {
    const e = describeError(error)
    return (
      <button type="button" onClick={onRetry} title={e.text} className={cn(CHIP, 'border-high-risk/35 bg-high-risk-wash text-high-risk')}>
        <Dot className="bg-high-risk-mark" /> {e.status === 503 ? 'db unavailable' : `error ${e.status ?? ''}`}
      </button>
    )
  }
  if (!health) return null

  const ok = health.status === 'ready'
  return (
    <span
      className={cn(CHIP, ok ? 'border-normal/30 bg-normal-wash text-normal' : 'border-suspicious/35 bg-suspicious-wash text-suspicious')}
      title={`db: ${health.database.detail ?? '—'}; models: ${health.models.artifacts.join(', ') || 'none'}`}
    >
      <Dot className={ok ? 'bg-normal-mark' : 'bg-suspicious-mark'} />
      API {ok ? 'ready' : health.status}
      {health.models.active ? (
        <span className="text-fg-subtle">· model {health.models.active}</span>
      ) : (
        <span className="text-fg-subtle">· rules only</span>
      )}
    </span>
  )
}

function Dot({ className }: { className?: string }) {
  return (
    <span className="relative flex size-2">
      <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden', className)} />
      <span className={cn('relative inline-flex size-2 rounded-full', className)} />
    </span>
  )
}
