import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { MotionConfig, motion } from 'motion/react'
import {
  Activity,
  ArrowUpRight,
  Box,
  ChevronRight,
  CircleHelp,
  Database,
  LayoutDashboard,
  ListFilter,
  Menu,
  Network,
  PanelLeftClose,
  Search,
  Settings2,
  ShieldCheck,
  Workflow,
} from 'lucide-react'
import { api, describeError, subscribeDbStatus } from './api'
import { useFetch, useInterval } from './useFetch'
import { WorkspaceContext } from './workspace'
import { CommandMenu } from './components/CommandMenu'
import { Overlay } from './components/Overlay'

const groups = [
  {
    label: 'WORKSPACE',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/sources', label: 'Log sources', icon: Database },
      { to: '/runs', label: 'Executions', icon: Workflow },
    ],
  },
  {
    label: 'INVESTIGATE',
    items: [
      { to: '/events', label: 'Event explorer', icon: ListFilter },
      { to: '/findings', label: 'Findings', icon: ShieldCheck },
      { to: '/incidents', label: 'Incidents', icon: Box },
      { to: '/analytics', label: 'Analytics', icon: Activity },
    ],
  },
  {
    label: 'CONFIGURE',
    items: [
      { to: '/detection', label: 'Detection', icon: Network },
      { to: '/integrations', label: 'Integrations', icon: Box },
    ],
  },
]

export default function App() {
  const health = useFetch(() => api.health(), [])
  const runs = useFetch(() => api.listRuns(), [])
  const sources = useFetch(() => api.listDatasets(), [])
  const [dbDown, setDbDown] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()
  useEffect(() => subscribeDbStatus(setDbDown), [])
  useInterval(() => {
    if (!document.hidden) {
      void health.reload()
      void runs.reload()
      void sources.reload()
    }
  }, 15_000)
  useEffect(() => {
    document.getElementById('main-content')?.scrollTo(0, 0)
  }, [location.pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen((value) => !value)
      }
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const failure = health.error ? describeError(health.error) : null
  const offline = dbDown || !!failure || (!!health.data && health.data.status !== 'ready')
  const runId =
    location.pathname.match(/^\/runs\/([^/]+)/)?.[1] || new URLSearchParams(location.search).get('run')
  const activePath = location.pathname.match(/^\/runs\/[^/]+\/incidents\//)
    ? '/incidents'
    : location.pathname.match(/^\/runs\/[^/]+\/events\//)
      ? '/events'
      : location.pathname
  const activeLabel =
    groups
      .flatMap((g) => g.items)
      .find((item) => item.to === activePath || (item.to !== '/' && activePath.startsWith(item.to)))?.label ||
    (location.pathname === '/settings' ? 'System status' : 'Resource detail')
  useEffect(() => {
    document.title = `${activeLabel} · Log & Order`
  }, [activeLabel])

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.18 }}>
      <WorkspaceContext.Provider value={{ health, runs, sources }}>
        <div className="app">
          <a className="skip-link" href="#main-content">
            Skip to content
          </a>
          <header className="topbar">
            <button
              className="icon-btn mobile-menu"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(!navOpen)}
            >
              <Menu size={19} />
            </button>
            <Link to="/" className="brand">
              <span className="brand-symbol">
                <span />
                <span />
                <span />
              </span>
              log<span className="brand-amp">&</span>order<span className="brand-console">CONSOLE</span>
            </Link>
            <button
              className="global-search"
              aria-label="Search resources and commands"
              onClick={() => setCommandOpen(true)}
            >
              <Search size={16} />
              <span>Search resources and commands…</span>
              <kbd>⌘ K</kbd>
            </button>
            <div className="topbar-right">
              <Link to="/settings" className={`system-chip ${offline ? 'system-offline' : ''}`}>
                <span className="dot" />
                {health.loading ? 'Connecting' : offline ? 'Connection issue' : 'API connected'}
              </Link>
              <button
                className="icon-btn"
                aria-label="Help and keyboard shortcuts"
                onClick={() => setHelpOpen(true)}
              >
                <CircleHelp size={18} />
              </button>
              <span className="avatar" title="Operator console">
                OP
              </span>
            </div>
          </header>
          {navOpen && (
            <button
              className="nav-backdrop"
              aria-label="Close navigation"
              onClick={() => setNavOpen(false)}
            />
          )}
          <aside className={`sidebar ${navOpen ? 'sidebar-open' : ''}`}>
            <div className="workspace-label">
              <span className="workspace-icon">
                <ShieldCheck size={18} />
              </span>
              <div>
                <strong>Security workspace</strong>
                <span>Behavioral detection</span>
              </div>
              <button
                className="icon-btn mobile-menu"
                aria-label="Close navigation"
                onClick={() => setNavOpen(false)}
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
            <nav aria-label="Main navigation" onClick={() => setNavOpen(false)}>
              {groups.map((group) => (
                <div className="nav-group" key={group.label}>
                  <div className="nav-label">{group.label}</div>
                  {group.items.map(({ to, label, icon: Icon }) => {
                    const isActive = activePath === to || (to !== '/' && activePath.startsWith(`${to}/`))
                    return (
                      <Link
                        to={`${to}${runId && ['/events', '/findings', '/incidents', '/analytics'].includes(to) ? `?run=${encodeURIComponent(runId)}` : ''}`}
                        key={to}
                        className={`nav-item ${isActive ? 'active' : ''}`}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        {isActive && (
                          <motion.span layoutId="active-navigation" className="nav-active-background" />
                        )}
                        <Icon size={17} />
                        <span>{label}</span>
                        {to === '/sources' && sources.data && <small>{sources.data.length}</small>}
                      </Link>
                    )
                  })}
                </div>
              ))}
            </nav>
            <div className="sidebar-footer">
              <NavLink to="/settings" className="nav-item">
                <Settings2 size={17} />
                System status
              </NavLink>
              <div className="sidebar-note">
                <span className="dot" /> Evidence-backed decisions
              </div>
            </div>
          </aside>
          <div className="main-shell">
            <div className="context-bar">
              <span>Workspace</span>
              <ChevronRight size={13} />
              <strong>{activeLabel}</strong>
              <span className="context-caption">Log &amp; Order</span>
            </div>
            {offline && (
              <div className="connection-banner" role="alert">
                <div>
                  <strong>
                    {dbDown || failure?.status === 503
                      ? 'Database unavailable'
                      : 'Connection needs attention'}
                  </strong>
                  <span>
                    {' '}
                    Data may be out of date.{' '}
                    {failure?.status === 401 || failure?.status === 403
                      ? 'Operator authentication is required at the API gateway.'
                      : 'Check the API connection and try again.'}
                  </span>
                </div>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    void health.reload()
                    void runs.reload()
                    void sources.reload()
                  }}
                >
                  Retry connection
                </button>
              </div>
            )}
            <main id="main-content" className="page" tabIndex={-1}>
              <Outlet />
            </main>
            <footer className="page-footer">
              <span>
                Log &amp; Order <span className="footer-divider">/</span> Investigation console
              </span>
              <span>
                All timestamps in UTC <span className="footer-divider">·</span>{' '}
                <Link to="/settings">
                  System status <ArrowUpRight size={11} />
                </Link>
              </span>
            </footer>
          </div>
          <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} />
          <Overlay
            open={helpOpen}
            onClose={() => setHelpOpen(false)}
            title="Working with Log & Order"
            description="From log source to verifiable evidence."
          >
            <div className="stack">
              <Link to="/welcome" className="link" onClick={() => setHelpOpen(false)}>
                Product introduction <ArrowUpRight size={14} />
              </Link>
              <div className="help-step">
                <span>01</span>
                <div>
                  <h3>Connect your data</h3>
                  <p>
                    Upload HTTP access logs in Log sources, then create an execution to process the dataset.
                  </p>
                </div>
              </div>
              <div className="help-step">
                <span>02</span>
                <div>
                  <h3>Investigate a finding</h3>
                  <p>
                    Filter events by account or classification. Open a row to inspect its context, detector
                    outcome, and raw evidence.
                  </p>
                </div>
              </div>
              <div className="help-step">
                <span>03</span>
                <div>
                  <h3>Review the evidence</h3>
                  <p>
                    Incidents group related events. Review versioned facts, qualified hypotheses, and missing
                    evidence before recording a disposition.
                  </p>
                </div>
              </div>
              <div className="shortcut-list">
                <span>Search resources and commands</span>
                <kbd>⌘ / Ctrl K</kbd>
                <span>Close a panel or dialog</span>
                <kbd>Esc</kbd>
                <span>Navigate search results</span>
                <kbd>↑ ↓ Enter</kbd>
              </div>
            </div>
          </Overlay>
        </div>
      </WorkspaceContext.Provider>
    </MotionConfig>
  )
}
