import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { NotFound } from './pages/NotFound.tsx'
import { RouteError } from './pages/RouteError'
import { captureFrontendError, initializeMonitoring } from './monitoring'

const startup = (
  <main className="state state-empty" role="status" aria-label="Loading workspace">
    Loading workspace…
  </main>
)

async function boot() {
  const createRouter = await initializeMonitoring(createBrowserRouter)
  const router = createRouter([
    {
      path: '/welcome',
      hydrateFallbackElement: startup,
      lazy: async () => ({ Component: (await import('./pages/WelcomePage')).WelcomePage }),
      errorElement: <RouteError />,
    },
    {
      path: '/',
      hydrateFallbackElement: startup,
      element: <App />,
      errorElement: <RouteError />,
      children: [
        {
          index: true,
          lazy: async () => ({ Component: (await import('./pages/OverviewPage')).OverviewPage }),
        },
        {
          path: 'sources',
          lazy: async () => ({ Component: (await import('./pages/SourcesPage')).SourcesPage }),
        },
        {
          path: 'sources/:sourceId',
          lazy: async () => ({ Component: (await import('./pages/SourcesPage')).SourceDetail }),
        },
        { path: 'runs', lazy: async () => ({ Component: (await import('./pages/RunsPage')).RunsPage }) },
        {
          path: 'events',
          lazy: async () => ({ Component: (await import('./pages/ExplorerPage')).ExplorerPage }),
        },
        {
          path: 'findings',
          lazy: async () => {
            const { ExplorerPage } = await import('./pages/ExplorerPage')
            return { Component: () => <ExplorerPage findings /> }
          },
        },
        {
          path: 'incidents',
          lazy: async () => ({ Component: (await import('./pages/IncidentsPage')).IncidentsPage }),
        },
        {
          path: 'analytics',
          lazy: async () => {
            const { OverviewPage } = await import('./pages/OverviewPage')
            return { Component: () => <OverviewPage analytics /> }
          },
        },
        {
          path: 'detection',
          lazy: async () => ({ Component: (await import('./pages/SystemPages')).DetectionPage }),
        },
        {
          path: 'integrations',
          lazy: async () => ({ Component: (await import('./pages/SystemPages')).IntegrationsPage }),
        },
        {
          path: 'settings',
          lazy: async () => ({ Component: (await import('./pages/SystemPages')).SystemPage }),
        },
        {
          path: 'runs/:runId',
          lazy: async () => ({ Component: (await import('./pages/RunConsole')).RunConsole }),
        },
        {
          path: 'runs/:runId/incidents/:incidentId',
          lazy: async () => ({ Component: (await import('./pages/IncidentPage')).IncidentPage }),
        },
        {
          path: 'runs/:runId/events/:seq',
          lazy: async () => ({ Component: (await import('./pages/EventPage')).EventPage }),
        },
        { path: '*', element: <NotFound /> },
      ],
    },
  ])

  createRoot(document.getElementById('root')!, {
    onUncaughtError: captureFrontendError,
    onCaughtError: captureFrontendError,
    onRecoverableError: captureFrontendError,
  }).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}
void boot()
