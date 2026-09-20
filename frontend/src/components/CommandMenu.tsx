// Search-result presentation follows Kokonut UI's action-search-bar (MIT).
// cmdk and Radix supply selection semantics, keyboard handling and focus management.
import { useState } from 'react'
import { Command } from 'cmdk'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowUpRight,
  Database,
  LayoutDashboard,
  ListFilter,
  Pause,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Workflow,
} from 'lucide-react'
import { api } from '../api'
import { useWorkspace } from '../workspace'
import { useFetch } from '../useFetch'
import { ErrorState } from '../ui'
import { Overlay } from './Overlay'

export function CommandMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { runs, sources } = useWorkspace()
  const navigate = useNavigate()
  const location = useLocation()
  const id =
    location.pathname.match(/^\/runs\/([^/]+)/)?.[1] ||
    new URLSearchParams(location.search).get('run') ||
    runs.data?.[0]?.run_id ||
    ''
  const current = runs.data?.find((r) => r.run_id === id)
  const incidents = useFetch(() => api.listIncidents(id, { limit: 50 }), [id, open], open && !!id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  function go(to: string) {
    onClose()
    navigate(to)
  }
  async function control() {
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      await api.replay(id, {
        action: current.state === 'created' ? 'start' : current.state === 'paused' ? 'resume' : 'pause',
      })
      await runs.reload()
      go(`/runs/${encodeURIComponent(id)}`)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  const pages = [
    { label: 'Overview', url: '/', icon: LayoutDashboard },
    { label: 'Log sources', url: '/sources', icon: Database },
    { label: 'Executions', url: '/runs', icon: Workflow },
    { label: 'Event explorer', url: '/events', icon: ListFilter },
    { label: 'Findings', url: '/findings', icon: ShieldCheck },
    { label: 'Incidents', url: '/incidents', icon: ShieldCheck },
    { label: 'Analytics', url: '/analytics', icon: Activity },
    { label: 'Detection', url: '/detection', icon: ShieldCheck },
    { label: 'Integrations', url: '/integrations', icon: Database },
    { label: 'System status', url: '/settings', icon: Activity },
  ]
  return (
    <Overlay
      open={open}
      onClose={onClose}
      title="Search and commands"
      description="Navigate resources or act on your current execution."
    >
      <Command label="Search resources" loop>
        <div className="command-input">
          <Search size={19} />
          <Command.Input autoFocus placeholder="Search a source, execution, incident, or action…" />
        </div>
        <Command.List>
          <Command.Empty>No results. Try a resource name or “new execution”.</Command.Empty>
          <Command.Group heading="Actions">
            <Command.Item onSelect={() => go('/runs?create=1')}>
              <Plus size={17} />
              <span>Create execution</span>
              <kbd>↵</kbd>
            </Command.Item>
            <Command.Item onSelect={() => go('/sources?upload=1')}>
              <Database size={17} />
              <span>Upload log source</span>
            </Command.Item>
            {current?.mode === 'replay' && !['completed', 'blocked'].includes(current.state) && (
              <Command.Item disabled={busy} onSelect={() => void control()}>
                {current.state === 'running' || current.state === 'warming' ? (
                  <Pause size={17} />
                ) : (
                  <Play size={17} />
                )}
                <span>
                  {current.state === 'created' ? 'Start' : current.state === 'paused' ? 'Resume' : 'Pause'}{' '}
                  execution
                </span>
                <small>{current.name}</small>
              </Command.Item>
            )}
          </Command.Group>
          <Command.Group heading="Navigate">
            {pages.map(({ label, url, icon: Icon }) => (
              <Command.Item key={url} onSelect={() => go(url)}>
                <Icon size={17} />
                <span>{label}</span>
                <ArrowUpRight size={14} />
              </Command.Item>
            ))}
          </Command.Group>
          {!!sources.data?.length && (
            <Command.Group heading="Log sources">
              {sources.data.map((s) => (
                <Command.Item
                  key={s.dataset_id}
                  value={`source ${s.original_name} ${s.dataset_id}`}
                  onSelect={() => go(`/sources/${encodeURIComponent(s.dataset_id)}`)}
                >
                  <Database size={17} />
                  <span>{s.original_name}</span>
                  <small>{s.import_state}</small>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {!!runs.data?.length && (
            <Command.Group heading="Executions">
              {runs.data.map((r) => (
                <Command.Item
                  key={r.run_id}
                  value={`execution ${r.name} ${r.run_id}`}
                  onSelect={() => go(`/runs/${encodeURIComponent(r.run_id)}`)}
                >
                  <Workflow size={17} />
                  <span>{r.name || r.run_id}</span>
                  <small>{r.state}</small>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {!!incidents.data?.items.length && (
            <Command.Group heading="Incidents in current execution">
              {incidents.data.items.map((i) => (
                <Command.Item
                  key={i.incident_id}
                  value={`incident ${i.summary.headline} ${i.account} ${i.incident_id}`}
                  onSelect={() =>
                    go(`/runs/${encodeURIComponent(id)}/incidents/${encodeURIComponent(i.incident_id)}`)
                  }
                >
                  <ShieldCheck size={17} />
                  <span>{i.summary.headline}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
        <div className="command-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </Command>
      {!!error && <ErrorState error={error} what="execution action" />}
    </Overlay>
  )
}
