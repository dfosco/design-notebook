import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "../utils.js"

function Input({
  className,
  type,
  ...props
}) {
  return (
    <InputPrimitive
      type={type}
      data-hc-ui="" data-slot="input"
      className={cn(
        "ds-h-8 ds-w-full ds-min-w-0 ds-rounded-lg ds-border ds-border-input ds-bg-transparent ds-px-2.5 ds-py-1 ds-text-base ds-transition-colors ds-outline-none ds-file:inline-flex ds-file:h-6 ds-file:border-0 ds-file:bg-transparent ds-file:text-sm ds-file:font-medium ds-file:text-foreground ds-placeholder:text-muted-foreground ds-focus-visible:border-ring ds-focus-visible:ring-3 ds-focus-visible:ring-ring/50 ds-disabled:pointer-events-none ds-disabled:cursor-not-allowed ds-disabled:bg-input/50 ds-disabled:opacity-50 ds-aria-invalid:border-destructive ds-aria-invalid:ring-3 ds-aria-invalid:ring-destructive/20 ds-md:text-sm ds-dark:bg-input/30 ds-dark:disabled:bg-input/80 ds-dark:aria-invalid:border-destructive/50 ds-dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
