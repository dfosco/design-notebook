import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { cn } from "../utils.js"

import { Button } from "./button.jsx"
import { XIcon } from "lucide-react"

function Sheet({
  ...props
}) {
  return <SheetPrimitive.Root data-hc-ui="" data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}) {
  return <SheetPrimitive.Trigger data-hc-ui="" data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}) {
  return <SheetPrimitive.Close data-hc-ui="" data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}) {
  return <SheetPrimitive.Portal data-hc-ui="" data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}) {
  return (
    <SheetPrimitive.Backdrop
      data-hc-ui="" data-slot="sheet-overlay"
      className={cn(
        "ds-fixed ds-inset-0 ds-z-[10000] ds-bg-black/10 ds-transition-opacity ds-duration-150 ds-data-ending-style:opacity-0 ds-data-starting-style:opacity-0 ds-supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-hc-ui="" data-slot="sheet-content"
        data-side={side}
        className={cn(
          "ds-fixed ds-z-[10001] ds-flex ds-flex-col ds-gap-4 ds-bg-popover ds-bg-clip-padding ds-text-sm ds-text-popover-foreground ds-shadow-lg ds-transition ds-duration-200 ds-ease-in-out ds-data-ending-style:opacity-0 ds-data-starting-style:opacity-0 ds-data-[side=bottom]:inset-x-0 ds-data-[side=bottom]:bottom-0 ds-data-[side=bottom]:h-auto ds-data-[side=bottom]:border-t ds-data-[side=bottom]:data-ending-style:translate-y-[2.5rem] ds-data-[side=bottom]:data-starting-style:translate-y-[2.5rem] ds-data-[side=left]:inset-y-0 ds-data-[side=left]:left-0 ds-data-[side=left]:h-full ds-data-[side=left]:w-3/4 ds-data-[side=left]:border-r ds-data-[side=left]:data-ending-style:translate-x-[-2.5rem] ds-data-[side=left]:data-starting-style:translate-x-[-2.5rem] ds-data-[side=right]:inset-y-0 ds-data-[side=right]:right-0 ds-data-[side=right]:h-full ds-data-[side=right]:w-3/4 ds-data-[side=right]:border-l ds-data-[side=right]:data-ending-style:translate-x-[2.5rem] ds-data-[side=right]:data-starting-style:translate-x-[2.5rem] ds-data-[side=top]:inset-x-0 ds-data-[side=top]:top-0 ds-data-[side=top]:h-auto ds-data-[side=top]:border-b ds-data-[side=top]:data-ending-style:translate-y-[-2.5rem] ds-data-[side=top]:data-starting-style:translate-y-[-2.5rem] ds-data-[side=left]:sm:max-w-sm ds-data-[side=right]:sm:max-w-sm",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-hc-ui="" data-slot="sheet-close"
            render={
              <Button
                variant="ghost"
                className="ds-absolute ds-top-3 ds-right-3"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="ds-sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({
  className,
  ...props
}) {
  return (
    <div
      data-hc-ui="" data-slot="sheet-header"
      className={cn("ds-flex ds-flex-col ds-gap-0.5 ds-p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({
  className,
  ...props
}) {
  return (
    <div
      data-hc-ui="" data-slot="sheet-footer"
      className={cn("ds-mt-auto ds-flex ds-flex-col ds-gap-2 ds-p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}) {
  return (
    <SheetPrimitive.Title
      data-hc-ui="" data-slot="sheet-title"
      className={cn(
        "ds-text-base ds-font-medium ds-text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}) {
  return (
    <SheetPrimitive.Description
      data-hc-ui="" data-slot="sheet-description"
      className={cn("ds-text-sm ds-text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
