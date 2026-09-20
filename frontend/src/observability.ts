/** Browser telemetry is deliberately less detailed than application evidence. */
import * as Sentry from '@sentry/react'
import type { ErrorEvent as SentryErrorEvent, TransactionEvent } from '@sentry/core'

function routeTemplate(name: unknown): string {
  const value = String(name ?? '')
  // The console lives under /app; `/` is the public landing page. Legacy /runs/* paths still
  // reach the app via LegacyRunsRedirect, so both prefixes normalise to the same template.
  if (value === '/' || value === '/app' || value === '/app/runs') return value
  const path = value.replace(/^\/app(?=\/|$)/, '') || '/'
  if (/^\/runs\/[^/?#]+$/.test(path)) return '/app/runs/{run_id}'
  if (/^\/runs\/[^/?#]+\/incidents\/[^/?#]+$/.test(path)) return '/app/runs/{run_id}/incidents/{incident_id}'
  if (/^\/runs\/[^/?#]+\/events\/[^/?#]+$/.test(path)) return '/app/runs/{run_id}/events/{seq}'
  return 'application'
}

function safeEvent(event: SentryErrorEvent): SentryErrorEvent {
  const diagnostic = event.tags?.check === 'observability_check'
  const exception = event.exception?.values?.map((value) => ({
    type: value.type ?? 'Error',
    value: 'Exception details withheld by privacy policy',
    stacktrace: value.stacktrace
      ? {
          frames: value.stacktrace.frames?.map((frame) => ({
            filename: frame.filename?.split('/').pop() ?? 'unknown',
            function: frame.function,
            lineno: frame.lineno,
            colno: frame.colno,
            in_app: frame.in_app,
          })),
        }
      : undefined,
  }))
  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    environment: event.environment,
    release: event.release,
    level: event.level,
    transaction: routeTemplate(event.transaction),
    exception: exception ? { values: exception } : undefined,
    message: diagnostic ? 'logorder.observability_check' : 'Application diagnostic',
    tags: diagnostic ? { check: 'observability_check' } : undefined,
  }
}

function safeTransaction(event: TransactionEvent): TransactionEvent {
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    start_timestamp: event.start_timestamp,
    type: event.type,
    platform: event.platform,
    environment: event.environment,
    release: event.release,
    transaction: routeTemplate(event.transaction),
    transaction_info: { source: 'custom' },
  }
}

export function initObservability(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'development',
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    sendDefaultPii: false,
    integrations: [Sentry.browserTracingIntegration()],
    tracePropagationTargets: [/^\/?api\/v1\//],
    beforeSend: safeEvent,
    beforeSendTransaction: safeTransaction,
  })
}

/** An explicit synthetic browser event for the operator's Sentry acceptance check. */
export function sendObservabilityDiagnostic(): string | undefined {
  if (!Sentry.getClient()) return undefined
  return Sentry.captureMessage('logorder.observability_check', {
    level: 'info',
    tags: { check: 'observability_check' },
  })
}
