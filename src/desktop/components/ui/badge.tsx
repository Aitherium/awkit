import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import type { ClassValue } from "clsx"

import { cn } from "../../lib/utils"

// Explicit type: the inferred cva() type is only nameable through
// class-variance-authority's internal types path, and when awkit is built nested
// (WorkspaceRuntime's Dockerfile builds it under node_modules/awkit) tsc emits
// TS2742 for the declaration. Keep the unions in step with the variants below.
// Mirrors cva's ClassProp (not exported from its index).
type ClassProp =
  | { class: ClassValue; className?: never }
  | { class?: never; className: ClassValue }
  | { class?: never; className?: never }

type BadgeVariantArgs = {
  variant?: "default" | "secondary" | "destructive" | "outline" | null
} & ClassProp

const badgeVariants: (props?: BadgeVariantArgs) => string = cva(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }

