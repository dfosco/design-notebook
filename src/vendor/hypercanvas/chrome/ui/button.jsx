import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva } from "class-variance-authority";
import { cn } from "../utils.js"

const buttonVariants = cva(
  "ds-group/button ds-inline-flex ds-shrink-0 ds-items-center ds-justify-center ds-rounded-lg ds-border ds-border-transparent ds-bg-clip-padding ds-text-sm ds-font-medium ds-whitespace-nowrap ds-transition-all ds-outline-none ds-select-none ds-focus-visible:border-ring ds-focus-visible:ring-3 ds-focus-visible:ring-ring/50 ds-active:not-aria-[haspopup]:translate-y-px ds-disabled:pointer-events-none ds-disabled:opacity-50 ds-aria-invalid:border-destructive ds-aria-invalid:ring-3 ds-aria-invalid:ring-destructive/20 ds-dark:aria-invalid:border-destructive/50 ds-dark:aria-invalid:ring-destructive/40 ds-[&_svg]:pointer-events-none ds-[&_svg]:shrink-0 ds-[&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "ds-bg-primary ds-text-primary-foreground ds-hover:bg-primary/80",
        outline:
          "ds-border-border ds-bg-background ds-hover:bg-muted ds-hover:text-foreground ds-aria-expanded:bg-muted ds-aria-expanded:text-foreground ds-dark:border-input ds-dark:bg-input/30 ds-dark:hover:bg-input/50",
        secondary:
          "ds-bg-secondary ds-text-secondary-foreground ds-hover:bg-[color-mix(in_oklch,var(--ds-color-secondary),var(--ds-color-foreground)_5%)] ds-aria-expanded:bg-secondary ds-aria-expanded:text-secondary-foreground",
        ghost:
          "ds-hover:bg-muted ds-hover:text-foreground ds-aria-expanded:bg-muted ds-aria-expanded:text-foreground ds-dark:hover:bg-muted/50",
        destructive:
          "ds-bg-destructive/10 ds-text-destructive ds-hover:bg-destructive/20 ds-focus-visible:border-destructive/40 ds-focus-visible:ring-destructive/20 ds-dark:bg-destructive/20 ds-dark:hover:bg-destructive/30 ds-dark:focus-visible:ring-destructive/40",
        link: "ds-text-primary ds-underline-offset-4 ds-hover:underline",
      },
      size: {
        default:
          "ds-h-8 ds-gap-1.5 ds-px-2.5 ds-has-data-[icon=inline-end]:pr-2 ds-has-data-[icon=inline-start]:pl-2",
        xs: "ds-h-6 ds-gap-1 ds-rounded-[min(var(--ds-radius-md),10px)] ds-px-2 ds-text-xs ds-in-data-[slot=button-group]:rounded-lg ds-has-data-[icon=inline-end]:pr-1.5 ds-has-data-[icon=inline-start]:pl-1.5 ds-[&_svg:not([class*='size-'])]:size-3",
        sm: "ds-h-7 ds-gap-1 ds-rounded-[min(var(--ds-radius-md),12px)] ds-px-2.5 ds-text-[0.8rem] ds-in-data-[slot=button-group]:rounded-lg ds-has-data-[icon=inline-end]:pr-1.5 ds-has-data-[icon=inline-start]:pl-1.5 ds-[&_svg:not([class*='size-'])]:size-3.5",
        lg: "ds-h-9 ds-gap-1.5 ds-px-2.5 ds-has-data-[icon=inline-end]:pr-2 ds-has-data-[icon=inline-start]:pl-2",
        icon: "ds-size-8",
        "icon-xs":
          "ds-size-6 ds-rounded-[min(var(--ds-radius-md),10px)] ds-in-data-[slot=button-group]:rounded-lg ds-[&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "ds-size-7 ds-rounded-[min(var(--ds-radius-md),12px)] ds-in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "ds-size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}) {
  return (
    <ButtonPrimitive
      data-hc-ui="" data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
