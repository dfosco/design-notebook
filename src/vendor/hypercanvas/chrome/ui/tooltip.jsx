"use client"

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn } from "../utils.js"

function TooltipProvider({
  delay = 0,
  ...props
}) {
  return (
    <TooltipPrimitive.Provider
      data-hc-ui="" data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}) {
  return <TooltipPrimitive.Root data-hc-ui="" data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}) {
  return <TooltipPrimitive.Trigger data-hc-ui="" data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="ds-isolate ds-z-50"
      >
        <TooltipPrimitive.Popup
          data-hc-ui="" data-slot="tooltip-content"
          className={cn(
            "ds-z-50 ds-inline-flex ds-w-fit ds-max-w-xs ds-origin-(--transform-origin) ds-items-center ds-gap-1.5 ds-rounded-md ds-bg-foreground ds-px-3 ds-py-1.5 ds-text-xs ds-text-background ds-has-data-[slot=kbd]:pr-1.5 ds-data-[side=bottom]:slide-in-from-top-2 ds-data-[side=inline-end]:slide-in-from-left-2 ds-data-[side=inline-start]:slide-in-from-right-2 ds-data-[side=left]:slide-in-from-right-2 ds-data-[side=right]:slide-in-from-left-2 ds-data-[side=top]:slide-in-from-bottom-2 ds-**:data-[slot=kbd]:relative ds-**:data-[slot=kbd]:isolate ds-**:data-[slot=kbd]:z-50 ds-**:data-[slot=kbd]:rounded-sm ds-data-[state=delayed-open]:animate-in ds-data-[state=delayed-open]:fade-in-0 ds-data-[state=delayed-open]:zoom-in-95 ds-data-open:animate-in ds-data-open:fade-in-0 ds-data-open:zoom-in-95 ds-data-closed:animate-out ds-data-closed:fade-out-0 ds-data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="ds-z-50 ds-size-2.5 ds-translate-y-[calc(-50%-2px)] ds-rotate-45 ds-rounded-[2px] ds-bg-foreground ds-fill-foreground ds-data-[side=bottom]:top-1 ds-data-[side=inline-end]:top-1/2! ds-data-[side=inline-end]:-left-1 ds-data-[side=inline-end]:-translate-y-1/2 ds-data-[side=inline-start]:top-1/2! ds-data-[side=inline-start]:-right-1 ds-data-[side=inline-start]:-translate-y-1/2 ds-data-[side=left]:top-1/2! ds-data-[side=left]:-right-1 ds-data-[side=left]:-translate-y-1/2 ds-data-[side=right]:top-1/2! ds-data-[side=right]:-left-1 ds-data-[side=right]:-translate-y-1/2 ds-data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
