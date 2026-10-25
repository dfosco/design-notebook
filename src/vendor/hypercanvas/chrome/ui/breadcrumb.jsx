import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cn } from "../utils.js"
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react"

function Breadcrumb({
  className,
  ...props
}) {
  return (
    <nav
      aria-label="breadcrumb"
      data-hc-ui="" data-slot="breadcrumb"
      className={cn(className)}
      {...props}
    />
  )
}

function BreadcrumbList({
  className,
  ...props
}) {
  return (
    <ol
      data-hc-ui="" data-slot="breadcrumb-list"
      className={cn(
        "ds-flex ds-flex-wrap ds-items-center ds-gap-1.5 ds-text-sm ds-wrap-break-word ds-text-muted-foreground ds-pl-0",
        className
      )}
      {...props}
    />
  )
}

function BreadcrumbItem({
  className,
  ...props
}) {
  return (
    <li
      data-hc-ui="" data-slot="breadcrumb-item"
      className={cn("ds-inline-flex ds-items-center ds-gap-1", className)}
      {...props}
    />
  )
}

function BreadcrumbLink({
  className,
  render,
  ...props
}) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps({
      className: cn("ds-transition-colors ds-hover:text-foreground", className),
    }, props),
    render,
    state: {
      slot: "breadcrumb-link",
    },
  });
}

function BreadcrumbPage({
  className,
  ...props
}) {
  return (
    <span
      data-hc-ui="" data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn("ds-font-normal ds-text-foreground", className)}
      {...props}
    />
  )
}

function BreadcrumbSeparator({
  children,
  className,
  ...props
}) {
  return (
    <li
      data-hc-ui="" data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("ds-[&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? (
        <ChevronRightIcon />
      )}
    </li>
  )
}

function BreadcrumbEllipsis({
  className,
  ...props
}) {
  return (
    <span
      data-hc-ui="" data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn(
        "ds-flex ds-size-5 ds-items-center ds-justify-center ds-[&>svg]:size-4",
        className
      )}
      {...props}
    >
      <MoreHorizontalIcon
      />
      <span className="ds-sr-only">More</span>
    </span>
  )
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
}
