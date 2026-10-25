"use client";
import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva } from "class-variance-authority";
import { cn } from "../utils.js"

import { useIsMobile } from "../use-mobile.js"
import { Button } from "./button.jsx"
import { Input } from "./input.jsx"
import { Separator } from "./separator.jsx"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./sheet.jsx"
import { Skeleton } from "./skeleton.jsx"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./tooltip.jsx"
import { PanelLeftIcon } from "lucide-react"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "16rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

const SidebarContext = React.createContext(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // This sets the cookie to keep the sidebar state.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo(() => ({
    state,
    open,
    setOpen,
    isMobile,
    openMobile,
    setOpenMobile,
    toggleSidebar,
  }), [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar])

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-hc-ui="" data-hc-surface="toolbar" data-slot="sidebar-wrapper"
        style={
          {
            "--ds-sidebar-width": SIDEBAR_WIDTH,
            "--ds-sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style
          }
        }
        className={cn(
          "ds-group/sidebar-wrapper ds-flex ds-min-h-svh ds-w-full ds-has-data-[variant=inset]:bg-background",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  dir,
  ...props
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        data-hc-ui="" data-slot="sidebar"
        className={cn(
          "ds-flex ds-h-full ds-w-(--ds-sidebar-width) ds-flex-col ds-bg-background ds-text-foreground",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          dir={dir}
          data-sidebar="sidebar"
          data-hc-ui="" data-slot="sidebar"
          data-mobile="true"
          className="ds-w-(--ds-sidebar-width) ds-bg-background ds-p-0 ds-text-foreground ds-[&>button]:hidden"
          style={
            {
              "--ds-sidebar-width": SIDEBAR_WIDTH_MOBILE
            }
          }
          side={side}
        >
          <SheetHeader className="ds-sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="ds-flex ds-h-full ds-w-full ds-flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      className="ds-group ds-peer ds-hidden ds-text-foreground ds-md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-hc-ui="" data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-hc-ui="" data-slot="sidebar-gap"
        className={cn(
          "ds-relative ds-w-(--ds-sidebar-width) ds-bg-transparent ds-transition-[width] ds-duration-200 ds-ease-linear",
          "ds-group-data-[collapsible=offcanvas]:w-0",
          "ds-group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "ds-group-data-[collapsible=icon]:w-[calc(var(--ds-sidebar-width-icon)+(--ds-spacing(4)))]"
            : "ds-group-data-[collapsible=icon]:w-(--ds-sidebar-width-icon)"
        )}
      />
      <div
        data-hc-ui="" data-slot="sidebar-container"
        data-side={side}
        className={cn(
          "ds-fixed ds-inset-y-0 ds-z-10 ds-hidden ds-h-svh ds-w-(--ds-sidebar-width) ds-transition-[left,right,width] ds-duration-200 ds-ease-linear ds-data-[side=left]:left-0 ds-data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--ds-sidebar-width)*-1)] ds-data-[side=right]:right-0 ds-data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--ds-sidebar-width)*-1)] ds-md:flex",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "ds-p-2 ds-group-data-[collapsible=icon]:w-[calc(var(--ds-sidebar-width-icon)+(--ds-spacing(4))+2px)]"
            : "ds-group-data-[collapsible=icon]:w-(--ds-sidebar-width-icon) ds-group-data-[side=left]:border-r ds-group-data-[side=right]:border-l",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-hc-ui="" data-slot="sidebar-inner"
          className="ds-flex ds-size-full ds-flex-col ds-bg-background ds-group-data-[variant=floating]:rounded-lg ds-group-data-[variant=floating]:shadow-sm ds-group-data-[variant=floating]:ring-1 ds-group-data-[variant=floating]:ring-border"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-hc-ui="" data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn(className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="ds-sr-only">Toggle Sidebar</span>
    </Button>
  )
}

function SidebarRail({
  className,
  ...props
}) {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      data-sidebar="rail"
      data-hc-ui="" data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={cn(
        "ds-absolute ds-inset-y-0 ds-z-20 ds-hidden ds-w-4 ds-transition-all ds-ease-linear ds-group-data-[side=left]:-right-4 ds-group-data-[side=right]:left-0 ds-after:absolute ds-after:inset-y-0 ds-after:start-1/2 ds-after:w-[2px] ds-hover:after:bg-border ds-sm:flex ds-ltr:-translate-x-1/2 ds-rtl:-translate-x-1/2",
        "ds-in-data-[side=left]:cursor-w-resize ds-in-data-[side=right]:cursor-e-resize",
        "ds-[[data-side=left][data-state=collapsed]_&]:cursor-e-resize ds-[[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "ds-group-data-[collapsible=offcanvas]:translate-x-0 ds-group-data-[collapsible=offcanvas]:after:left-full ds-hover:group-data-[collapsible=offcanvas]:bg-background",
        "ds-[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "ds-[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInset({
  className,
  ...props
}) {
  return (
    <main
      data-hc-ui="" data-slot="sidebar-inset"
      className={cn(
        "ds-relative ds-flex ds-w-full ds-flex-1 ds-flex-col ds-bg-background ds-md:peer-data-[variant=inset]:m-2 ds-md:peer-data-[variant=inset]:ml-0 ds-md:peer-data-[variant=inset]:rounded-xl ds-md:peer-data-[variant=inset]:shadow-sm ds-md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInput({
  className,
  ...props
}) {
  return (
    <Input
      data-hc-ui="" data-slot="sidebar-input"
      data-sidebar="input"
      className={cn("ds-h-8 ds-w-full ds-bg-background ds-shadow-none", className)}
      {...props}
    />
  )
}

function SidebarHeader({
  className,
  ...props
}) {
  return (
    <div
      data-hc-ui="" data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("ds-flex ds-flex-col ds-gap-2 ds-p-2", className)}
      {...props}
    />
  )
}

function SidebarFooter({
  className,
  ...props
}) {
  return (
    <div
      data-hc-ui="" data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("ds-flex ds-flex-col ds-gap-2 ds-p-2", className)}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}) {
  return (
    <Separator
      data-hc-ui="" data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("ds-mx-2 ds-w-auto ds-bg-border", className)}
      {...props}
    />
  )
}

function SidebarContent({
  className,
  ...props
}) {
  return (
    <div
      data-hc-ui="" data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "ds-no-scrollbar ds-flex ds-min-h-0 ds-flex-1 ds-flex-col ds-gap-0 ds-overflow-auto ds-group-data-[collapsible=icon]:overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({
  className,
  ...props
}) {
  return (
    <div
      data-hc-ui="" data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("ds-relative ds-flex ds-w-full ds-min-w-0 ds-flex-col ds-p-2", className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  render,
  ...props
}) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps({
      className: cn(
        "ds-flex ds-h-8 ds-shrink-0 ds-items-center ds-rounded-md ds-px-2 ds-text-xs ds-font-medium ds-text-foreground/70 ds-ring-ring ds-outline-hidden ds-transition-[margin,opacity] ds-duration-200 ds-ease-linear ds-group-data-[collapsible=icon]:-mt-8 ds-group-data-[collapsible=icon]:opacity-0 ds-focus-visible:ring-2 ds-[&>svg]:size-4 ds-[&>svg]:shrink-0",
        className
      ),
    }, props),
    render,
    state: {
      slot: "sidebar-group-label",
      sidebar: "group-label",
    },
  });
}

function SidebarGroupAction({
  className,
  render,
  ...props
}) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps({
      className: cn(
        "ds-absolute ds-top-3.5 ds-right-3 ds-flex ds-aspect-square ds-w-5 ds-items-center ds-justify-center ds-rounded-md ds-p-0 ds-text-foreground ds-ring-ring ds-outline-hidden ds-transition-transform ds-group-data-[collapsible=icon]:hidden ds-after:absolute ds-after:-inset-2 ds-hover:bg-muted ds-hover:text-foreground ds-focus-visible:ring-2 ds-md:after:hidden ds-[&>svg]:size-4 ds-[&>svg]:shrink-0",
        className
      ),
    }, props),
    render,
    state: {
      slot: "sidebar-group-action",
      sidebar: "group-action",
    },
  });
}

function SidebarGroupContent({
  className,
  ...props
}) {
  return (
    <div
      data-hc-ui="" data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("ds-w-full ds-text-sm", className)}
      {...props}
    />
  )
}

function SidebarMenu({
  className,
  ...props
}) {
  return (
    <ul
      data-hc-ui="" data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("ds-flex ds-w-full ds-min-w-0 ds-flex-col ds-gap-0", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({
  className,
  ...props
}) {
  return (
    <li
      data-hc-ui="" data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("ds-group/menu-item ds-relative", className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  "ds-peer/menu-button ds-group/menu-button ds-flex ds-w-full ds-items-center ds-gap-2 ds-overflow-hidden ds-rounded-md ds-p-2 ds-text-left ds-text-sm ds-ring-ring ds-outline-hidden ds-transition-[width,height,padding] ds-group-has-data-[sidebar=menu-action]/menu-item:pr-8 ds-group-data-[collapsible=icon]:size-8! ds-group-data-[collapsible=icon]:p-2! ds-hover:bg-muted ds-hover:text-foreground ds-focus-visible:ring-2 ds-active:bg-muted ds-active:text-foreground ds-disabled:pointer-events-none ds-disabled:opacity-50 ds-aria-disabled:pointer-events-none ds-aria-disabled:opacity-50 ds-data-open:hover:bg-muted ds-data-open:hover:text-foreground ds-data-active:bg-muted ds-data-active:font-medium ds-data-active:text-foreground ds-[&_svg]:size-4 ds-[&_svg]:shrink-0 ds-[&>span:last-child]:truncate",
  {
    variants: {
      variant: {
        default: "ds-hover:bg-muted ds-hover:text-foreground",
        outline:
          "ds-bg-background ds-shadow-[0_0_0_1px_var(--ds-color-border)] ds-hover:bg-muted ds-hover:text-foreground ds-hover:shadow-[0_0_0_1px_var(--ds-color-background-muted)]",
      },
      size: {
        default: "ds-h-8 ds-text-sm",
        sm: "ds-h-7 ds-text-xs",
        lg: "ds-h-12 ds-text-sm ds-group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function SidebarMenuButton({
  render,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}) {
  const { isMobile, state } = useSidebar()
  const comp = useRender({
    defaultTagName: "button",
    props: mergeProps({
      className: cn(sidebarMenuButtonVariants({ variant, size }), className),
    }, props),
    render: !tooltip ? render : <TooltipTrigger render={render} />,
    state: {
      slot: "sidebar-menu-button",
      sidebar: "menu-button",
      size,
      active: isActive,
    },
  })

  if (!tooltip) {
    return comp
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip>
      {comp}
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

function SidebarMenuAction({
  className,
  render,
  showOnHover = false,
  ...props
}) {
  return useRender({
    defaultTagName: "button",
    props: mergeProps({
      className: cn(
        "ds-absolute ds-top-1.5 ds-right-1 ds-flex ds-aspect-square ds-w-5 ds-items-center ds-justify-center ds-rounded-md ds-p-0 ds-text-foreground ds-ring-ring ds-outline-hidden ds-transition-transform ds-group-data-[collapsible=icon]:hidden ds-peer-hover/menu-button:text-foreground ds-peer-data-[size=default]/menu-button:top-1.5 ds-peer-data-[size=lg]/menu-button:top-2.5 ds-peer-data-[size=sm]/menu-button:top-1 ds-after:absolute ds-after:-inset-2 ds-hover:bg-muted ds-hover:text-foreground ds-focus-visible:ring-2 ds-md:after:hidden ds-[&>svg]:size-4 ds-[&>svg]:shrink-0",
        showOnHover &&
          "ds-group-focus-within/menu-item:opacity-100 ds-group-hover/menu-item:opacity-100 ds-peer-data-active/menu-button:text-foreground ds-aria-expanded:opacity-100 ds-md:opacity-0",
        className
      ),
    }, props),
    render,
    state: {
      slot: "sidebar-menu-action",
      sidebar: "menu-action",
    },
  });
}

function SidebarMenuBadge({
  className,
  ...props
}) {
  return (
    <div
      data-hc-ui="" data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "ds-pointer-events-none ds-absolute ds-right-1 ds-flex ds-h-5 ds-min-w-5 ds-items-center ds-justify-center ds-rounded-md ds-px-1 ds-text-xs ds-font-medium ds-text-foreground ds-tabular-nums ds-select-none ds-group-data-[collapsible=icon]:hidden ds-peer-hover/menu-button:text-foreground ds-peer-data-[size=default]/menu-button:top-1.5 ds-peer-data-[size=lg]/menu-button:top-2.5 ds-peer-data-[size=sm]/menu-button:top-1 ds-peer-data-active/menu-button:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}) {
  // Random width between 50 to 90%.
  const [width] = React.useState(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`
  })

  return (
    <div
      data-hc-ui="" data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("ds-flex ds-h-8 ds-items-center ds-gap-2 ds-rounded-md ds-px-2", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="ds-size-4 ds-rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="ds-h-4 ds-max-w-(--skeleton-width) ds-flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width
          }
        }
      />
    </div>
  );
}

function SidebarMenuSub({
  className,
  ...props
}) {
  return (
    <ul
      data-hc-ui="" data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        "ds-mx-3.5 ds-flex ds-min-w-0 ds-translate-x-px ds-flex-col ds-gap-1 ds-border-l ds-border-border ds-px-2.5 ds-py-0.5 ds-group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}) {
  return (
    <li
      data-hc-ui="" data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("ds-group/menu-sub-item ds-relative", className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  render,
  size = "md",
  isActive = false,
  className,
  ...props
}) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps({
      className: cn(
        "ds-flex ds-h-7 ds-min-w-0 ds--translate-x-px ds-items-center ds-gap-2 ds-overflow-hidden ds-rounded-md ds-px-2 ds-text-foreground ds-ring-ring ds-outline-hidden ds-group-data-[collapsible=icon]:hidden ds-hover:bg-muted ds-hover:text-foreground ds-focus-visible:ring-2 ds-active:bg-muted ds-active:text-foreground ds-disabled:pointer-events-none ds-disabled:opacity-50 ds-aria-disabled:pointer-events-none ds-aria-disabled:opacity-50 ds-data-[size=md]:text-sm ds-data-[size=sm]:text-xs ds-data-active:bg-muted ds-data-active:text-foreground ds-[&>span:last-child]:truncate ds-[&>svg]:size-4 ds-[&>svg]:shrink-0 ds-[&>svg]:text-foreground",
        className
      ),
    }, props),
    render,
    state: {
      slot: "sidebar-menu-sub-button",
      sidebar: "menu-sub-button",
      size,
      active: isActive,
    },
  });
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}
