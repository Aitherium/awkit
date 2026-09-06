'use client'

/**
 * PollEmbedPanel — embeds a single poll via the canonical Veil `/polls/embed`
 * route in an <iframe>, mirroring RelayEmbedPanel. Tenant products
 * render the SAME poll widget Veil serves, so there is one implementation and
 * no drift.
 *
 * Resolution order for the embed origin:
 *   1. `embedBaseUrl` prop
 *   2. `config.poll_embed_base_url` / `config.app_url` from /api/config/embed
 *   3. NEXT_PUBLIC/window global
 *   4. same-origin ('')
 */

import { useMemo } from 'react'
import { useConfig } from '../hooks/useConfig'

export interface PollEmbedPanelProps {
  /** The poll id to display. */
  pollId: string
  /** Override the origin that serves /polls/embed. */
  embedBaseUrl?: string
  /** Tokenized vote link param (from an emailed link), optional. */
  token?: string
  compact?: boolean
}

export default function PollEmbedPanel({ pollId, embedBaseUrl, token, compact }: PollEmbedPanelProps) {
  const config = useConfig()

  const src = useMemo(() => {
    const base =
      embedBaseUrl ||
      config?.poll_embed_base_url ||
      config?.relay_base_url ||
      (typeof window !== 'undefined' && (window as any).__AITHER_POLL_BASE__) ||
      ''
    const qs = new URLSearchParams({ pollId })
    if (token) qs.set('token', token)
    if (compact) qs.set('compact', '1')
    return `${String(base).replace(/\/$/, '')}/polls/embed?${qs.toString()}`
  }, [embedBaseUrl, pollId, token, compact, config])

  return (
    <iframe
      src={src}
      title="Poll"
      className="aither-poll-embed"
      style={{ width: '100%', minHeight: compact ? 280 : 420, border: 0, background: 'transparent' }}
    />
  )
}
