/** Application telemetry only. No session replay, DOM breadcrumbs, evidence or request bodies. */
import { useEffect } from 'react'
import { createRoutesFromChildren, matchRoutes, useLocation, useNavigationType } from 'react-router-dom'
import type { createBrowserRouter } from 'react-router-dom'
import type { Event } from '@sentry/react'
type SpanJSON = NonNullable<Event['spans']>[number]

let sdk: typeof import('@sentry/react') | undefined
let state: 'disabled' | 'active' | 'failed' = 'disabled'
const captured = new WeakSet<object>()
const routeNames = new Set([
  '/',
  '/welcome',
  '/sources',
  '/sources/:sourceId',
  '/runs',
  '/runs/:runId',
  '/runs/:runId/incidents/:incidentId',
  '/runs/:runId/events/:seq',
  '/events',
  '/findings',
  '/incidents',
  '/analytics',
  '/detection',
  '/integrations',
  '/settings',
])

function safeSpan(span: SpanJSON): SpanJSON {
  return {
    trace_id: span.trace_id,
    span_id: span.span_id,
    parent_span_id: span.parent_span_id,
    start_timestamp: span.start_timestamp,
    timestamp: span.timestamp,
    op: span.op,
    status: span.status,
    description: span.op || 'application',
    data:
      typeof span.data?.['http.response.status_code'] === 'number'
        ? { 'http.response.status_code': span.data['http.response.status_code'] }
        : {},
  }
}

export function scrubEvent<T extends Event>(event: T): T {
  const trace = event.contexts?.trace
  const clean: Event = {
    event_id: event.event_id,
    timestamp: event.timestamp,
    start_timestamp: event.start_timestamp,
    type: event.type,
    level: event.level,
    platform: event.platform,
    release: event.release,
    environment: event.environment,
    sdk: event.sdk,
    transaction: event.transaction
      ? routeNames.has(event.transaction)
        ? event.transaction
        : 'console.navigation'
      : undefined,
    contexts: trace
      ? {
          trace: {
            trace_id: trace.trace_id,
            span_id: trace.span_id,
            parent_span_id: trace.parent_span_id,
            op: trace.op,
            status: trace.status,
          },
        }
      : undefined,
    tags: { surface: 'console', ...(event.tags?.diagnostic === true ? { diagnostic: true } : {}) },
    message: event.message ? 'Log & Order application diagnostic' : undefined,
    exception: event.exception
      ? {
          values: event.exception.values?.map((exception) => ({
            type: exception.type,
            value: 'Exception details withheld by privacy policy',
            stacktrace: {
              frames: exception.stacktrace?.frames?.map((frame) => ({
                // Only built asset locations, never arbitrary external paths or query strings.
                filename: frame.filename?.match(/\/assets\/[\w.-]+\.js/)?.[0] || 'application',
                function: frame.function,
                lineno: frame.lineno,
                colno: frame.colno,
                in_app: frame.in_app,
              })),
            },
          })),
        }
      : undefined,
    spans: event.spans?.map(safeSpan),
  }
  return clean as T
}

export async function initializeMonitoring(
  factory: typeof createBrowserRouter,
): Promise<typeof createBrowserRouter> {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return factory
  try {
    sdk = await import('@sentry/react')
    const sample = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0.1')
    sdk.init({
      dsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
      tracesSampleRate: Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.1,
      sendDefaultPii: false,
      sendClientReports: false,
      tracePropagationTargets: [/^\/(api\/v1\/|health\/)/],
      integrations: (defaults) => [
        ...defaults.filter((integration) =>
          ['GlobalHandlers', 'BrowserApiErrors', 'Dedupe', 'InboundFilters'].includes(integration.name),
        ),
        sdk!.reactRouterBrowserTracingIntegration({
          useEffect,
          useLocation,
          useNavigationType,
          createRoutesFromChildren,
          matchRoutes,
          enableInp: true,
        }),
      ],
      beforeSend: scrubEvent,
      beforeSendTransaction: scrubEvent,
      beforeSendSpan: safeSpan,
      enableLogs: true,
      beforeSendLog: (log) =>
        log.message === 'observability_check'
          ? { ...log, attributes: { surface: 'console', event: 'observability_check' } }
          : null,
    })
    state = 'active'
    return sdk.wrapCreateBrowserRouter(factory) as typeof createBrowserRouter
  } catch {
    state = 'failed'
    return factory
  }
}

export function monitoringState() {
  return state
}

export function captureFrontendError(error: unknown) {
  if (!sdk || state !== 'active') return
  if (error && typeof error === 'object') {
    if (captured.has(error)) return
    captured.add(error)
  }
  sdk.captureException(error)
}

export async function checkFrontendMonitoring() {
  if (!sdk || state !== 'active') return null
  sdk.logger.info('observability_check', { surface: 'console' })
  const eventId = sdk.captureMessage('Log & Order application diagnostic', {
    level: 'info',
    tags: { diagnostic: true },
  })
  await sdk.flush(2000)
  return eventId
}
