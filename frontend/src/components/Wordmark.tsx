import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'

/** The WatchTower logo (WatchTower.png at the repository root) on a white tile. */
export function TowerMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white', className)}>
      <img src="/watchtower-192.png" alt="" className="size-full object-contain" />
    </span>
  )
}

export function Wordmark({
  to = '/',
  className,
  size = 'md',
  tone = 'default',
}: {
  to?: string
  className?: string
  size?: 'md' | 'lg'
  tone?: 'default' | 'light'
}) {
  return (
    <Link
      to={to}
      className={cn('no-underline inline-flex items-center gap-2', tone === 'light' ? 'text-white' : 'text-fg', className)}
      aria-label="WatchTower home"
    >
      <TowerMark className={size === 'lg' ? 'size-8' : 'size-7'} />
      <span className={cn('font-semibold tracking-tight', size === 'lg' ? 'text-[1.25rem]' : 'text-[1.0625rem]')}>WatchTower</span>
    </Link>
  )
}
