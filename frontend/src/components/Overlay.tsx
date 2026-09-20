import { useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'

export function Overlay({
  open,
  onClose,
  title,
  description,
  children,
  drawer = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  drawer?: boolean
}) {
  const [width, setWidth] = useState(620)
  const previousFocus = useRef<HTMLElement | null>(null)
  function resize(next: number) {
    setWidth(Math.max(360, Math.min(window.innerWidth - 24, 960, next)))
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="overlay-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              onOpenAutoFocus={() => {
                previousFocus.current = document.activeElement as HTMLElement
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                previousFocus.current?.focus()
              }}
            >
              <motion.section
                className={drawer ? 'detail-drawer' : 'modal'}
                style={drawer ? { width } : undefined}
                initial={drawer ? { x: 32, opacity: 0 } : { y: 8, opacity: 0, scale: 0.99 }}
                animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                exit={drawer ? { x: 32, opacity: 0 } : { y: 8, opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {drawer && (
                  <motion.div
                    className="drawer-resize"
                    role="separator"
                    aria-label="Resize detail panel"
                    aria-orientation="vertical"
                    aria-valuenow={width}
                    aria-valuemin={360}
                    aria-valuemax={960}
                    tabIndex={0}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0}
                    dragMomentum={false}
                    onDrag={(_, info) =>
                      setWidth((w) => Math.max(360, Math.min(window.innerWidth - 24, 960, w - info.delta.x)))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault()
                        resize(width + (e.key === 'ArrowLeft' ? 32 : -32))
                      }
                    }}
                  />
                )}
                <header className="overlay-head">
                  <div>
                    <Dialog.Title>{title}</Dialog.Title>
                    <Dialog.Description className={description ? 'muted small' : 'sr-only'}>
                      {description ?? `${title} details`}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button className="icon-btn" aria-label="Close dialog">
                      <X size={18} />
                    </button>
                  </Dialog.Close>
                </header>
                <div className="overlay-body">{children}</div>
              </motion.section>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
