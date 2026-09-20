import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/cn"
import { Slot } from "radix-ui"

/**
 * A small mono tag. Badges label things — a rule name, a dataset, a section — so they are
 * set in uppercase mono, the same voice as every other caption on the page.
 *
 * The `chart-1` … `chart-6` variants exist so an ENTITY can carry one identity colour
 * everywhere it appears: the same rule is chart-3 in the docket, in the legend and on the
 * chart. Assign by entity, never by rank, and never cycle past six.
 *
 * Verdicts and processing states do NOT belong here — use <StatusChip>, which owns those
 * semantics (and the hatch that keeps processing states from reading as verdicts).
 */
const badgeVariants = cva(
  [
    "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden",
    "rounded-sm border px-1.5 py-0.5",
    "font-mono text-[0.6875rem] font-medium uppercase tracking-wide whitespace-nowrap",
    "transition-colors duration-150 ease-out-quint",
    "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
    "[&>svg]:pointer-events-none [&>svg]:size-3",
  ],
  {
    variants: {
      variant: {
        default: "border-border bg-chip text-fg-muted [a&]:hover:bg-hover [a&]:hover:text-fg",
        outline: "border-border-strong bg-transparent text-fg-muted [a&]:hover:bg-hover [a&]:hover:text-fg",
        accent: "border-accent/25 bg-accent-wash text-accent [a&]:hover:bg-accent/15",
        secondary: "border-border bg-sunken text-fg-muted [a&]:hover:bg-hover [a&]:hover:text-fg",
        destructive: "border-high-risk/30 bg-high-risk-wash text-high-risk",
        ghost: "border-transparent text-fg-subtle [a&]:hover:bg-hover [a&]:hover:text-fg",
        link: "border-transparent text-accent underline-offset-4 [a&]:hover:underline",
        // Categorical index — fixed order, assigned per entity.
        "chart-1": "border-chart-1/25 bg-chart-1-wash text-chart-1",
        "chart-2": "border-chart-2/25 bg-chart-2-wash text-chart-2",
        "chart-3": "border-chart-3/25 bg-chart-3-wash text-chart-3",
        "chart-4": "border-chart-4/25 bg-chart-4-wash text-chart-4",
        "chart-5": "border-chart-5/25 bg-chart-5-wash text-chart-5",
        "chart-6": "border-chart-6/25 bg-chart-6-wash text-chart-6",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
