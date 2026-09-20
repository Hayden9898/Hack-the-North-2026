import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './styles/app.css'
import App from './App.tsx'
import { LegacyRunsRedirect } from './components/LegacyRunsRedirect.tsx'
import { TooltipProvider } from './components/ui/tooltip.tsx'
import { ThemeProvider } from './lib/theme.tsx'
import { Landing } from './pages/Landing/index.tsx'
import { EventPage } from './pages/EventPage.tsx'
import { IncidentPage } from './pages/IncidentPage.tsx'
import { NotFound } from './pages/NotFound.tsx'
import { RouteError } from './pages/RouteError.tsx'
import { RunConsole } from './pages/RunConsole.tsx'
import { RunsPage } from './pages/RunsPage.tsx'
import { initObservability } from './observability.ts'

initObservability()

const router = createBrowserRouter([
  // The judge-facing landing page owns `/` and renders outside the console shell.
  { path: '/', element: <Landing /> },
  {
    path: '/app',
    element: <App />,
    errorElement: <RouteError shell />,
    children: [
      {
        // Pathless layout route: a page that throws during render is replaced by RouteError inside App's outlet,
        // keeping the topbar and health banners instead of the router's default error page.
        errorElement: <RouteError />,
        children: [
          { index: true, element: <RunsPage /> },
          { path: 'runs/:runId', element: <RunConsole /> },
          { path: 'runs/:runId/incidents/:incidentId', element: <IncidentPage /> },
          { path: 'runs/:runId/events/:seq', element: <EventPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
  // Pre-migration deep links.
  { path: '/runs/*', element: <LegacyRunsRedirect /> },
  { path: '*', element: <NotFound /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)
