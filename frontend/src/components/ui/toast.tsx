/**
 * Toast — contract name from design §5. Backed by sonner.
 *
 *   import { Toast, toast } from '@/components/ui/toast'
 *   toast.success('Feedback recorded')
 *
 * Mount <Toast /> once in the app shell (already done in App.tsx).
 */
export { Toaster as Toast } from './sonner'
export { toast } from 'sonner'
