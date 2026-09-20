import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useWorkspace } from '../workspace'

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function SearchField({
  value,
  onChange,
  placeholder = 'Search…',
  label = 'Search',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
}) {
  return (
    <div className="search-field">
      <Search size={15} aria-hidden="true" />
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function ExecutionScope({ id, onChange }: { id: string; onChange: (id: string) => void }) {
  const { runs } = useWorkspace()
  return (
    <div className="execution-scope">
      <label htmlFor="execution-scope">Execution</label>
      <select id="execution-scope" value={id} onChange={(e) => onChange(e.target.value)}>
        {!runs.data?.length && (
          <option value="">{runs.loading ? 'Loading executions…' : 'No executions available'}</option>
        )}
        {runs.data?.map((run) => (
          <option key={run.run_id} value={run.run_id}>
            {run.name || run.run_id}
          </option>
        ))}
      </select>
      {id && (
        <Link to={`/runs/${encodeURIComponent(id)}`} className="icon-btn" aria-label="Open execution">
          <ArrowUpRight size={16} />
        </Link>
      )}
    </div>
  )
}

export function Pagination({
  page,
  total,
  size,
  onChange,
}: {
  page: number
  total: number
  size: number
  onChange: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / size))
  return (
    <div className="pagination">
      <span>
        {total === 0 ? '0 results' : `${page * size + 1}–${Math.min((page + 1) * size, total)} of ${total}`}
      </span>
      <div className="row">
        <button
          className="icon-btn"
          aria-label="Previous page"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          Page {page + 1} of {pages}
        </span>
        <button
          className="icon-btn"
          aria-label="Next page"
          disabled={page + 1 >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

export function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: string
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={tone ? `text-${tone}` : undefined}>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  )
}
