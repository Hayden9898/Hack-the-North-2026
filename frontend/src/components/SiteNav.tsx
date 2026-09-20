import { Link, NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/cn'

const LINK = 'no-underline rounded-md px-3 py-1.5 text-[0.9375rem] transition-colors duration-150 hover:text-white hover:no-underline'

/**
 * The one navigation bar. Rendered by the landing page and by the console shell so the two
 * read as the same site: Home, the two landing sections, the console, and one button.
 */
export function SiteNav() {
  const { pathname } = useLocation()
  const onLanding = pathname === '/'
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#0a0a0a]/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[72rem] items-center gap-1 px-4 sm:px-6">
        <NavLink to="/" end className={({ isActive }) => cn(LINK, isActive ? 'text-white' : 'text-white/60')}>
          Home
        </NavLink>
        <a href={onLanding ? '#features' : '/#features'} className={cn(LINK, 'text-white/60')}>
          Features
        </a>
        <a href={onLanding ? '#how' : '/#how'} className={cn(LINK, 'text-white/60')}>
          How it works
        </a>
        <NavLink to="/app" className={({ isActive }) => cn(LINK, isActive ? 'text-white' : 'text-white/60')}>
          Console
        </NavLink>
        <Link
          to="/app"
          className="no-underline ml-auto rounded-full bg-white px-4 py-1.5 text-[0.875rem] font-medium text-black hover:bg-white/90 hover:no-underline"
        >
          Open console
        </Link>
      </div>
    </header>
  )
}
