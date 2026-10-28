import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// PIVOT: every control is a pill (radius-pill). One `default` (lime) button per screen.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border-0 text-[14px] font-medium whitespace-nowrap transition-colors duration-150 ease-out outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text disabled:pointer-events-none disabled:opacity-40 aria-invalid:outline-2 aria-invalid:outline-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-surface text-ink-secondary hover:bg-surface-raised hover:text-ink aria-expanded:bg-surface-raised aria-expanded:text-ink",
        outline: "bg-surface text-ink-secondary hover:bg-surface-raised hover:text-ink aria-expanded:bg-surface-raised aria-expanded:text-ink",
        ghost: "bg-transparent text-ink-secondary hover:bg-surface hover:text-ink aria-expanded:bg-surface aria-expanded:text-ink",
        destructive: "bg-surface text-danger hover:bg-surface-raised",
        link: "text-accent-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 gap-1.5 px-4",
        xs: "h-6 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-5",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
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

export { Button, buttonVariants }
