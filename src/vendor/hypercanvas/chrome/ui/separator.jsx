import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import { cn } from "../utils.js"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}) {
  return (
    <SeparatorPrimitive
      data-hc-ui="" data-slot="separator"
      orientation={orientation}
      className={cn(
        "ds-shrink-0 ds-bg-border ds-data-horizontal:h-px ds-data-horizontal:w-full ds-data-vertical:w-px ds-data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
