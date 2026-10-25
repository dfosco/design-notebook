import { cn } from "../utils.js"

function Skeleton({
  className,
  ...props
}) {
  return (
    <div
      data-hc-ui="" data-slot="skeleton"
      className={cn("ds-animate-pulse ds-rounded-md ds-bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
