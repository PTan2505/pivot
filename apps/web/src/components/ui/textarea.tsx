import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-[14px] border-0 bg-surface px-4 py-3 text-[15px] leading-relaxed text-ink transition-colors outline-none placeholder:text-ink-muted hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:outline-2 aria-invalid:outline-danger",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
