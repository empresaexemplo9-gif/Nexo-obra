import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-md border border-drap-300/70 bg-card px-3 py-2 text-base shadow-xs outline-none transition-[background-color,border-color,box-shadow] selection:bg-drap-accent selection:text-primary-foreground placeholder:text-muted-foreground hover:border-drap-500 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-drap-accent focus-visible:ring-[3px] focus-visible:ring-drap-accent/15",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
