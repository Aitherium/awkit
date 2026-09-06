'use client'

/**
 * RelayEmbedPanel — the product-side "Comms" panel.
 *
 * Instead of maintaining a second, stripped-down comms UI, tenant products
 * embed the CANONICAL AitherRelay shell served by Veil at
 * `/relay/embed`. That guarantees full feature parity with the platform relay
 * (channels, DMs, groups, threads, search, members, reactions, files) and zero
 * drift — there is exactly one relay implementation.
 *
 * Resolution order for the relay origin (SAME-ORIGIN-FIRST to avoid X-Frame/routing failures):
 *   1. `relayBaseUrl` prop (panel override)
 *   2. `config.relay_base_url` from /api/config/embed (may be same-origin or absolute)
 *   3. Same-origin default (current origin + /relay, if no config.relay_base_url)
 *   4. NEXT_PUBLIC/window global if present
 *   5. https://relay.aitherium.com (public relay, fallback only)
 *
 * The signed-in user's display name is passed as `nick` so the embed connects
 * immediately (no nick picker), and the workspace slug scopes channels/DMs.
 */

import { useMemo } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useConfig } from '../hooks/useConfig'

// The dedicated relay host serves the embeddable shell at /embed (the app owns
// the whole origin); Veil-shaped origins (portal/veil.aitherium.com) serve it
// at /relay/embed. A base ending in /embed is therefore used verbatim, anything
// else gets /relay/embed appended.
const DEFAULT_RELAY_BASE = 'https://relay.aitherium.com/embed'

export interface RelayEmbedPanelProps {
  /** Override the relay origin (e.g. https://irc.aitherium.com). */
  relayBaseUrl?: string
  /** Workspace slug to scope the relay to. Falls back to config. */
  workspace?: string
  /** Land on this channel. */
  defaultChannel?: string
}

/**
 * Validate that a relay base URL is safe — must be an absolute https:// URL
 * or a relative same-origin path (starting with /). Rejects javascript:, file:,
 * and open-redirect attempts.
 */
function isValidRelayBase(url: string | undefined): boolean {
  if (!url) return false
  // Allow absolute https:// URLs
  if (url.startsWith('https://')) {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }
  // Allow same-origin paths (relative, starting with a single /)
  if (url.startsWith('/')) {
    // Reject protocol-relative URLs (//host, /\host) — they navigate off-origin
    // (open redirect), plus directory traversal and backslash escapes.
    if (url.startsWith('//') || url.startsWith('/\\')) return false
    return !url.includes('../') && !url.includes('\\')
  }
  return false
}

export default function RelayEmbedPanel({
  relayBaseUrl,
  workspace,
  defaultChannel = '#general',
}: RelayEmbedPanelProps = {}) {
  const { user } = useAuth()
  const config = useConfig()

  const src = useMemo(() => {
    // Resolve relay base URL with same-origin preference to avoid X-Frame/routing issues.
    // Same-origin paths (relative URLs like '/relay') always work; public subdomains may be
    // blocked or unrouted, so they're only fallback.

    // Resolution order:
    // 1. Explicit prop override (if valid)
    let base = relayBaseUrl && isValidRelayBase(relayBaseUrl) ? relayBaseUrl : undefined

    // 2. Config-provided URL (if valid)
    if (!base && config?.relay_base_url && isValidRelayBase(config.relay_base_url)) {
      base = config.relay_base_url
    }

    // 3. Config loaded but relay_base_url is null/empty → use same-origin default.
    // This ensures the embed works even if the public relay.aitherium.com is blocked or unrouted.
    if (!base && config) {
      base = '/relay'
    }

    // 4. Window global (if valid)
    if (!base && typeof window !== 'undefined' && (window as any).__AITHER_RELAY_BASE__) {
      if (isValidRelayBase((window as any).__AITHER_RELAY_BASE__)) {
        base = (window as any).__AITHER_RELAY_BASE__
      }
    }

    // 5. Public relay as last resort
    if (!base) {
      base = DEFAULT_RELAY_BASE
    }

    const resolvedBase = base

    const ws =
      workspace ||
      config?.workspace_slug ||
      config?.tenant_id ||
      (user?.tenant_id as string | undefined)

    const nick = user?.display_name || user?.name || ''

    const qs = new URLSearchParams()
    if (ws) qs.set('workspace', String(ws))
    if (nick) qs.set('nick', String(nick))
    if (defaultChannel) qs.set('channel', defaultChannel)
    const query = qs.toString()
    const trimmed = String(resolvedBase).replace(/\/$/, '')
    // Base already points at an embed surface (e.g. https://relay.aitherium.com/embed)
    // → use verbatim; otherwise it's an origin and the Veil-shaped path applies.
    const embedUrl = trimmed.endsWith('/embed') ? trimmed : `${trimmed}/relay/embed`
    return `${embedUrl}${query ? `?${query}` : ''}`
  }, [relayBaseUrl, workspace, defaultChannel, config, user])

  return (
    <iframe
      src={src}
      title="Comms"
      className="aither-relay-embed"
      style={{ width: '100%', height: '100%', border: 0, background: 'var(--bg-deep, #09090b)' }}
      allow="clipboard-write; microphone"
    />
  )
}
