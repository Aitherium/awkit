'use client'

import React, { useEffect, useMemo, useState } from 'react'

/**
 * BadgeSwitcher — one account, four properties.
 *
 * Renders the aitherium.com properties this session's scope badges unlock
 * (portal = business ops, veil = platform ops, shop = storefront admin,
 * workspace = tenant workspace) as a pill strip: current property
 * highlighted, others linked. Badges come from Identity /auth/me
 * (`scope_badges`, derived server-side from RBAC roles — admin holds all).
 *
 * Renders nothing while loading or when the session unlocks fewer than two
 * properties (nothing to switch to). This is NAVIGATION sugar — enforcement
 * lives in the middleware (proxy.ts STEP 3a) and scope-gate/AdminShell.
 */

export type PropertyKey = 'portal' | 'veil' | 'shop' | 'workspace'

interface PropertyDef {
  key: PropertyKey
  badge: string
  label: string
  url: string
}

const DEFAULT_PROPERTIES: PropertyDef[] = [
  { key: 'portal', badge: 'portal:admin', label: 'Portal', url: 'https://portal.aitherium.com' },
  { key: 'veil', badge: 'veil:admin', label: 'Veil', url: 'https://veil.aitherium.com' },
  { key: 'shop', badge: 'shop:admin', label: 'Shop', url: 'https://shop.aitherium.com/admin' },
  { key: 'workspace', badge: 'workspace:admin', label: 'Workspace', url: 'https://portal.aitherium.com/workspace/dashboard' },
]

export interface BadgeSwitcherProps {
  /** Current property; auto-detected from the hostname when omitted */
  current?: PropertyKey
  /** Badges to render; fetched from `meEndpoint` when omitted */
  badges?: string[]
  /** Where to fetch the session (default '/api/auth/me') */
  meEndpoint?: string
  /** Override property URLs (e.g. self-hosted domains) */
  urls?: Partial<Record<PropertyKey, string>>
  className?: string
}

function detectCurrent(): PropertyKey | undefined {
  if (typeof window === 'undefined') return undefined
  const host = window.location.hostname
  if (host.startsWith('veil.')) return 'veil'
  if (host.startsWith('shop.')) return 'shop'
  if (host.startsWith('portal.')) {
    return window.location.pathname.startsWith('/workspace') ? 'workspace' : 'portal'
  }
  if (window.location.pathname.startsWith('/admin')) return 'veil'
  return undefined
}

export default function BadgeSwitcher({
  current,
  badges,
  meEndpoint = '/api/auth/me',
  urls,
  className = '',
}: BadgeSwitcherProps) {
  const [fetched, setFetched] = useState<string[] | null>(null)

  useEffect(() => {
    if (badges) return
    let cancelled = false
    fetch(meEndpoint)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled) setFetched(data?.scope_badges ?? [])
      })
      .catch(() => { if (!cancelled) setFetched([]) })
    return () => { cancelled = true }
  }, [badges, meEndpoint])

  const active = badges ?? fetched
  const cur = current ?? detectCurrent()

  const unlocked = useMemo(() => {
    if (!active) return []
    return DEFAULT_PROPERTIES
      .filter(p => active.includes(p.badge))
      .map(p => ({ ...p, url: urls?.[p.key] ?? p.url }))
  }, [active, urls])

  if (unlocked.length < 2) return null

  return (
    <div
      className={`flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-1.5 py-1 ${className}`}
      title="Properties your badges unlock"
    >
      {unlocked.map(p =>
        p.key === cur ? (
          <span
            key={p.key}
            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/15 text-cyan-300"
          >
            {p.label}
          </span>
        ) : (
          <a
            key={p.key}
            href={p.url}
            className="px-1.5 py-0.5 rounded text-[10px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04] transition-colors"
          >
            {p.label}
          </a>
        )
      )}
    </div>
  )
}
