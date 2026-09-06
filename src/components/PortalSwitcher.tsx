'use client'

import React from 'react'

export interface PortalSwitcherProps {
  /** Current context: 'portal' or 'shop' */
  current: 'portal' | 'shop'
  /** Portal URL (e.g. https://portal.aitherium.com) */
  portalUrl?: string
  /** Shop/storefront URL (e.g. https://shop.aitherium.com) */
  shopUrl?: string
  /** Workspace name shown in the switcher */
  workspaceName?: string
}

/**
 * Navigation component for switching between portal and shop contexts.
 * Renders a compact pill showing the current context with a link to the other.
 */
export default function PortalSwitcher({
  current,
  portalUrl = 'https://portal.aitherium.com',
  shopUrl = 'https://shop.aitherium.com',
  workspaceName = 'Workspace',
}: PortalSwitcherProps) {
  const isPortal = current === 'portal'
  const otherUrl = isPortal ? shopUrl : portalUrl
  const otherLabel = isPortal ? 'Shop' : 'Portal'
  const currentLabel = isPortal ? 'Portal' : 'Shop'

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1">
      <span className="text-[11px] font-medium text-zinc-400">{workspaceName}</span>
      <span className="text-zinc-700">/</span>
      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/15 text-cyan-300">
        {currentLabel}
      </span>
      <a
        href={otherUrl}
        className="px-1.5 py-0.5 rounded text-[10px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04] transition-colors"
      >
        {otherLabel}
      </a>
    </div>
  )
}
