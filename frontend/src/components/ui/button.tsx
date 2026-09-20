import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/cn"
import { Slot } from "radix-ui"

/**
 * Buttons on the warm-paper palette.
 *
 * Three jobs, three shapes:
 *   default  the seal — brand orange, used once or twice per screen so it stays loud
 *   soft     an accent-tinted secondary, for "also important" without a second seal
 *   outline  the workhorse — a white card-chip that lifts its border on hover
 *
 * Every filled/bordered variant presses down 1px on :active, so a click has a physical
 * answer. Focus keeps the global accent outline from styles/base.css and adds a soft ring
 * underneath it; neither is ever removed.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md",
    "font-sans text-sm font-medium tracking-[-0.006em] whitespace-nowrap",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out-quint",
    "focus-visible:ring-[3px] focus-visible:ring-accent/25",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default:
          "bg-accent text-accent-fg shadow-sm hover:bg-accent-hover hover:shadow-md active:translate-y-px active:shadow-sm",
        soft:
          "border border-accent/25 bg-accent-wash text-accent hover:border-accent/40 hover:bg-accent/15 active:translate-y-px",
        outline:
          "border border-border bg-surface text-fg shadow-sm hover:border-border-strong hover:bg-hover hover:shadow-md active:translate-y-px active:shadow-sm",
        secondary:
          "border border-border bg-chip text-fg hover:border-border-strong hover:bg-hover active:translate-y-px",
        destructive:
          "bg-high-risk text-accent-fg shadow-sm hover:bg-high-risk/90 focus-visible:ring-high-risk/25 active:translate-y-px active:shadow-sm",
        ghost:
          "text-fg-muted hover:bg-hover hover:text-fg active:translate-y-px",
        link: "text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-11 rounded-md px-6 text-[0.9375rem] has-[>svg]:px-5",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

/** Exported for the KokonutUI components that wrap Button (particle, liquid-glass). */
export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }

export { Button, buttonVariants }
