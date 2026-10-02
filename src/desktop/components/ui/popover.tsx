"use client"

import * as React from "react"
import { cn } from "../../lib/utils"

// Simple Popover implementation using React state
interface PopoverContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const PopoverContext = React.createContext<PopoverContextValue | null>(null)

function usePopover() {
  const context = React.useContext(PopoverContext)
  if (!context) {
    throw new Error("usePopover must be used within a Popover")
  }
  return context
}

interface PopoverProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
}

function Popover({ children, open: controlledOpen, onOpenChange, defaultOpen = false }: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  
  const setOpen = React.useCallback((value: boolean) => {
    if (!isControlled) {
      setUncontrolledOpen(value)
    }
    onOpenChange?.(value)
  }, [isControlled, onOpenChange])

  return (
    <PopoverContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block">
        {children}
      </div>
    </PopoverContext.Provider>
  )
}

interface PopoverTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}

const PopoverTrigger = React.forwardRef<HTMLButtonElement, PopoverTriggerProps>(
  ({ children, asChild, onClick, ...props }, ref) => {
    const { open, setOpen } = usePopover()
    
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      setOpen(!open)
      onClick?.(e)
    }

    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<any>, {
        onClick: handleClick,
        ref,
        "data-state": open ? "open" : "closed",
        ...props,
      })
    }

    return (
      <button ref={ref} onClick={handleClick} data-state={open ? "open" : "closed"} {...props}>
        {children}
      </button>
    )
  }
)
PopoverTrigger.displayName = "PopoverTrigger"

interface PopoverContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  sideOffset?: number
}

const PopoverContent = React.forwardRef<HTMLDivElement, PopoverContentProps>(
  ({ className, children, side = "bottom", align = "center", sideOffset = 4, ...props }, ref) => {
    const { open, setOpen } = usePopover()
    const contentRef = React.useRef<HTMLDivElement>(null)

    // Close on click outside
    React.useEffect(() => {
      if (!open) return

      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as Node
        if (contentRef.current && !contentRef.current.contains(target)) {
          // Check if the click is on the trigger
          const trigger = contentRef.current.parentElement?.querySelector('[data-state]')
          if (trigger && trigger.contains(target)) return
          setOpen(false)
        }
      }

      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setOpen(false)
        }
      }

      document.addEventListener("mousedown", handleClickOutside)
      document.addEventListener("keydown", handleEscape)
      return () => {
        document.removeEventListener("mousedown", handleClickOutside)
        document.removeEventListener("keydown", handleEscape)
      }
    }, [open, setOpen])

    if (!open) return null

    // Position classes based on side
    const positionClasses = {
      top: "bottom-full mb-2",
      bottom: "top-full mt-2",
      left: "right-full mr-2",
      right: "left-full ml-2",
    }

    const alignClasses = {
      start: "left-0",
      center: "left-1/2 -translate-x-1/2",
      end: "right-0",
    }

    return (
      <div
        ref={(node) => {
          (contentRef as React.MutableRefObject<HTMLDivElement | null>).current = node
          if (typeof ref === "function") ref(node)
          else if (ref) ref.current = node
        }}
        className={cn(
          "absolute z-50 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
          "animate-in fade-in-0 zoom-in-95",
          positionClasses[side],
          alignClasses[align],
          className
        )}
        style={{ marginTop: side === "bottom" ? sideOffset : undefined, marginBottom: side === "top" ? sideOffset : undefined }}
        {...props}
      >
        {children}
      </div>
    )
  }
)
PopoverContent.displayName = "PopoverContent"

// For compatibility
const PopoverAnchor = ({ children }: { children: React.ReactNode }) => <>{children}</>

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }


