'use client'

/**
 * Tooltip — a small label on hover/focus, for controls whose meaning is not
 * self-evident. Minimal and styled from the portal CSS variables so it matches
 * whatever surface hosts it.
 *
 *   <Tooltip label="Type / to summon documents, data, mail, the fleet">
 *     <button className="summons-hint">/</button>
 *   </Tooltip>
 *
 * Accessible: the trigger is described by the tooltip (aria-describedby), and
 * the bubble appears on both hover and keyboard focus.
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export interface TooltipProps {
  /** The text shown in the bubble. */
  label: string
  /** The control being described. */
  children: ReactNode
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** Show delay in ms; hovered briefly means not-interested. */
  delay?: number
  /**
   * Wrap as a block instead of inline-flex. Use for layout-sensitive children
   * (a full-width textarea, a listbox item) where an inline-flex wrapper would
   * shrink the child's width and break the layout.
   */
  block?: boolean
}

const BUBBLE: Record<NonNullable<TooltipProps['placement']>, CSSProperties> = {
  top: { bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' },
  bottom: { top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' },
  left: { right: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' },
  right: { left: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' },
}

export default function Tooltip({
  label,
  children,
  placement = 'top',
  delay = 400,
  block = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()

  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(false)
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <span
      style={{ position: 'relative', display: block ? 'block' : 'inline-flex' }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && (
        <span
          role="tooltip"
          id={id}
          style={{
            position: 'absolute',
            zIndex: 10000,
            ...BUBBLE[placement],
            maxWidth: 280,
            padding: '0.5rem 0.7rem',
            fontSize: '0.75rem',
            lineHeight: 1.4,
            textAlign: 'left',
            whiteSpace: 'normal',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 8px 24px oklch(0 0 0 / 0.28)',
            pointerEvents: 'none',
          }}
        >
          {label}
        </span>
      )}
    </span>
  )
}
