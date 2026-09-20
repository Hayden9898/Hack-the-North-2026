import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Font-size steps from the `--text-*` block in styles/theme.css.
 *
 * tailwind-merge has to be told about these. Out of the box it only recognises t-shirt sizes
 * (text-sm, text-lg, …) as font sizes, so it classified `text-heading` as a *colour* and put it
 * in the same conflict group as `text-fg` — then kept whichever came last and silently dropped
 * the other. That produced unstyled headings in one direction and uncoloured text in the other;
 * Agent B hit it as a real contrast failure on their console (~2:1 text in light mode).
 *
 * Keep this list in sync with the `--text-*` tokens. A step that is missing here is a step that
 * silently fights the colour utilities.
 */
const FONT_SIZES = ['display', 'title', 'heading', 'body', 'caption', 'mono'] as const

/**
 * Colour tokens from the `--color-*` block, including the shadcn bridge names. These share the
 * `text-` prefix with the sizes above, which is the whole reason the two have to be declared
 * explicitly rather than inferred.
 */
const COLORS = [
  'bg',
  'fg',
  'fg-muted',
  'fg-subtle',
  'surface',
  'surface-raised',
  'border',
  'border-strong',
  'accent',
  'accent-fg',
  'accent-hover',
  'accent-soft',
  'accent-wash',
  'sunken',
  'chip',
  'grid',
  'axis',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-1-wash',
  'chart-2-wash',
  'chart-3-wash',
  'chart-4-wash',
  'chart-5-wash',
  'chart-6-wash',
  'normal-mark',
  'suspicious-mark',
  'high-risk-mark',
  'hover',
  'normal',
  'suspicious',
  'high-risk',
  'normal-wash',
  'suspicious-wash',
  'high-risk-wash',
  'pending',
  'late',
  'blocked',
  // shadcn bridge
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'destructive',
  'input',
  'ring',
] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
      'text-color': [{ text: [...COLORS] }],
    },
  },
})

/** Merge conditional class names, with later Tailwind utilities winning over earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
