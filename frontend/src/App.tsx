import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { SiteNav } from './components/SiteNav'
import { Toast } from './components/ui/toast'
import {
  api,
  describeError,
  setOperatorToken,
  subscribeDbStatus,
  subscribeOperatorToken,
  type Health,
} from './api'
import { cn } from './lib/cn'
import { MonitoringCheck } from './MonitoringCheck'
import { useFetch, useInterval } from './useFetch'

/**
 * The console shell.
 *
 * One bar: the wordmark, the one place to go, and — on the right — a single status control
 * that opens everything operational (API health, operator token, Sentry diagnostic). The old
 * bar showed all of that permanently and read as a cockpit; the status is still one glance
 * away, the controls are one click away.
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
      <SiteNav />

      <div className="flex flex-col">
        {showDbBanner ? (
          <Banner tone="danger" role="alert">
            <strong>Database unavailable.</strong> The API returned 503 or reported the database as down. Nothing below is
            being refreshed; WatchTower never fabricates a healthy feed.
            <BannerAction onClick={() => void health.reload()}>Check again</BannerAction>
          </Banner>
        ) : null}

        {!showDbBanner && healthErr && healthErr.status !== 503 ? (
          <Banner tone="warn" role="alert">
            <strong>Health check failed</strong> ({healthErr.status ?? 'no response'}: {healthErr.text}).
            <BannerAction onClick={() => void health.reload()}>Retry</BannerAction>
          </Banner>
        ) : null}

        {!showDbBanner && notReady && health.data ? (
          <Banner tone="danger" role="alert">
            <strong>API not ready</strong> — status {health.data.status}
            {health.data.not_ready_reasons?.length ? ` (${health.data.not_ready_reasons.map((r) => r.replaceAll('_', ' ')).join(', ')})` : ''}.
            Database ok: {String(health.data.database.ok)}; migrations ok: {String(health.data.migrations.ok)} (
            {health.data.migrations.current ?? '?'} / {health.data.migrations.head ?? '?'}); config ok: {String(health.data.config.ok)}.
          </Banner>
        ) : null}
      </div>

      <main>
        <Outlet />
      </main>
      <footer className="mt-16 border-t border-border">
        <div className="mx-auto flex w-full max-w-[84rem] items-center justify-between gap-4 px-4 py-5 text-caption text-fg-subtle sm:px-6 lg:px-8">
          <span>WatchTower</span>
          <SystemMenu health={health.data} error={health.error} loading={health.loading} onRetry={() => void health.reload()} />
        </div>
      </footer>
      <Toast />
    </div>
  )
}

const BANNER_TONE = {
  danger: 'border-high-risk/30 bg-high-risk-wash text-fg',
  warn: 'border-suspicious/35 bg-suspicious-wash text-fg',
  pending: 'border-border bg-chip text-fg-muted',
} as const

function Banner({ tone, role, children }: { tone: keyof typeof BANNER_TONE; role: 'alert' | 'status'; children: ReactNode }) {
  return (
    <div role={role} className={cn('border-b', BANNER_TONE[tone])}>
      <div className="mx-auto flex w-full max-w-[84rem] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-body sm:px-6 lg:px-8">
        {children}
      </div>
    </div>
  )
}

function BannerAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 py-1 text-caption text-fg transition-colors duration-150 hover:bg-hover"
    >
      <RefreshCw className="size-3" />
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ system menu */

/**
 * Live API state plus every operator control, behind one button.
 *
 * The dot is the fastest read on the page. Green means the API is ready; amber means it
 * answered but is not ready; red means it did not answer or the database is down.
 */
function SystemMenu({ health, error, loading, onRetry }: { health: Health | null; error: unknown; loading: boolean; onRetry: () => void }) {
  const e = error && !health ? describeError(error) : null
  const ready = health?.status === 'ready'
  const tone: 'ok' | 'warn' | 'bad' | 'wait' = e ? 'bad' : health ? (ready ? 'ok' : 'warn') : loading ? 'wait' : 'bad'
  const label = e ? (e.status === 503 ? 'Database down' : 'API unreachable') : health ? (ready ? 'API ready' : `API ${health.status.replaceAll('_', ' ')}`) : 'Checking'

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-caption font-medium text-fg-muted transition-colors duration-150 hover:border-border-strong hover:text-fg"
          aria-label={`${label}. Open system menu`}
        >
          <Dot tone={tone} />
          <span className="hidden sm:inline">{label}</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          side="top"
          sideOffset={8}
          className="z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface-raised p-4 text-fg shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <section className="space-y-2">
            <h2 className="flex items-center gap-2 text-heading">
              <Activity className="size-4 text-fg-muted" aria-hidden />
              System
            </h2>
            {health ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-caption">
                <Row k="API" v={ready ? 'ready' : health.status.replaceAll('_', ' ')} tone={ready ? 'ok' : 'warn'} />
                <Row k="Database" v={health.database.ok ? 'ok' : (health.database.detail ?? 'down')} tone={health.database.ok ? 'ok' : 'bad'} />
                <Row
                  k="Migrations"
                  v={health.migrations.ok ? (health.migrations.current ?? 'current') : `${health.migrations.current ?? '?'} of ${health.migrations.head ?? '?'}`}
                  tone={health.migrations.ok ? 'ok' : 'warn'}
                />
                <Row k="Model" v={health.models.active ?? 'none, rules only'} tone={health.models.active ? 'ok' : 'warn'} />
              </dl>
            ) : e ? (
              <p className="text-caption text-high-risk">
                {e.status === 503 ? 'Database unavailable.' : `Health check failed (${e.status ?? 'no response'}).`} {e.text}
              </p>
            ) : (
              <p className="text-caption text-fg-muted">Checking the API…</p>
            )}
            <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 text-caption text-fg-muted hover:text-fg">
              <RefreshCw className="size-3" aria-hidden /> Check again
            </button>
          </section>

          <div className="my-4 h-px bg-border" />

          <OperatorToken required={health?.auth?.operator_required ?? false} />

          <div className="my-4 h-px bg-border" />

          <MonitoringCheck />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

function Row({ k, v, tone }: { k: string; v: string; tone: 'ok' | 'warn' | 'bad' }) {
  return (
    <>
      <dt className="text-fg-muted">{k}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 truncate text-fg">
        <Dot tone={tone} still />
        <span className="truncate font-mono">{v}</span>
      </dd>
    </>
  )
}

const DOT = {
  ok: 'bg-normal-mark',
  warn: 'bg-suspicious-mark',
  bad: 'bg-high-risk-mark',
  wait: 'bg-pending',
} as const

function Dot({ tone, still = false }: { tone: keyof typeof DOT; still?: boolean }) {
  return (
    <span className="relative flex size-2 shrink-0">
      {!still && tone !== 'ok' ? (
        <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden', DOT[tone])} />
      ) : null}
      <span className={cn('relative inline-flex size-2 rounded-full', DOT[tone])} />
    </span>
  )
}

/* ------------------------------------------------------------------ operator token */

/**
 * Shared deployments require an operator bearer token for mutations (creating runs, replay
 * control, feedback, aggregate refresh). Reads are open. The token stays in this tab and is
 * sent only as an Authorization header.
 */
function OperatorToken({ required }: { required: boolean }) {
  const [present, setPresent] = useState(false)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  useEffect(() => subscribeOperatorToken(setPresent), [])

  function save(e: FormEvent) {
    e.preventDefault()
    setOperatorToken(value)
    setValue('')
    setEditing(false)
  }

  const status = present ? 'Token set for this tab.' : required ? 'This deployment needs a token for any change.' : 'No token. Local deployments accept changes without one.'

  return (
    <section className="space-y-2">
      <h3 className="text-body font-medium text-fg">Operator token</h3>
      <p className={cn('flex items-center gap-2 text-caption', present ? 'text-fg-muted' : required ? 'text-high-risk' : 'text-fg-muted')}>
        <Dot tone={present ? 'ok' : required ? 'bad' : 'wait'} still />
        {status}
      </p>
      {editing ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-1.5">
          <input
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="APP_AUTH_SECRET"
            aria-label="Operator token"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-mono text-fg placeholder:text-fg-subtle"
          />
          <SmallButton type="submit" emphasis>
            Use
          </SmallButton>
          <SmallButton onClick={() => setEditing(false)}>Cancel</SmallButton>
        </form>
      ) : (
        <div className="flex gap-1.5">
          <SmallButton onClick={() => setEditing(true)}>{present ? 'Replace token' : 'Set token'}</SmallButton>
          {present ? (
            <SmallButton
              onClick={() => {
                setOperatorToken('')
                setValue('')
              }}
            >
              Clear
            </SmallButton>
          ) : null}
        </div>
      )}
    </section>
  )
}

function SmallButton({
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
        'rounded-md border px-2.5 py-1 text-caption font-medium transition-colors duration-150',
        emphasis
          ? 'border-accent bg-accent text-accent-fg hover:bg-accent-hover'
          : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}
