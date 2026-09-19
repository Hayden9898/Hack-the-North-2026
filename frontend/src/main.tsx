import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { EventPage } from './pages/EventPage.tsx'
import { IncidentPage } from './pages/IncidentPage.tsx'
import { NotFound } from './pages/NotFound.tsx'
import { RunConsole } from './pages/RunConsole.tsx'
import { RunsPage } from './pages/RunsPage.tsx'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <RunsPage /> },
      { path: 'runs/:runId', element: <RunConsole /> },
      { path: 'runs/:runId/incidents/:incidentId', element: <IncidentPage /> },
      { path: 'runs/:runId/events/:seq', element: <EventPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
