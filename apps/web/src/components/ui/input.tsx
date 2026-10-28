import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-full border-0 bg-surface px-4 py-1 text-[15px] text-ink transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-ink-muted hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:outline-2 aria-invalid:outline-danger",
        className
      )}
      {...props}
    />
  )
}

export { Input }
