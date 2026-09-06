'use client'

/**
 * What a summons brings back.
 *
 * A summons opens a context surface beside the conversation instead of
 * navigating away — the room never disappears. Each surface is bound to a real
 * endpoint supplied by the host app (`endpoints` prop), because portal-kit does
 * not know a given tenant's document or data routes.
 *
 * When an endpoint is absent or fails, this says so plainly and names what is
 * missing. It never renders a plausible-looking empty list — a surface that
 * looks populated but is inert is worse than one that admits it has nothing
 * (security-review-patterns #5, applied to UX).
 */

import { useEffect, useState } from 'react'
import type { SummonsId } from './summons'

/**
 * Where a summons looks. A plain string is a GET whose query is appended as
 * `?q=`; the object form covers search endpoints that take a POST body, which
 * most extraction backends do.
 */
export type Endpoint =
  | string
  | { url: string; method?: 'GET' | 'POST'; queryKey?: string }

/**
 * The summons this generic surface handles. `mail`, `fleet`, `notes`,
 * `bead-space`, `on-device`, and `hardware` have dedicated surfaces, so listing
 * them here would imply an endpoint that is never read — the type states which
 * ids actually route through this component.
 *
 * This exclusion is LOAD-BEARING, not decorative: every id left in the union is
 * used to index `ContextEndpoints`, so an id with no endpoint field is a compile
 * error.
 */
// 'pillars' is excluded for the same reason as fleet/notes: it is a LIVE LANE
// view, not a queryable document context, so it has no ContextEndpoints entry
// and indexing one by it is a type error rather than a missing feature.
export type ContextSurfaceId = Exclude<SummonsId, 'mail' | 'fleet' | 'notes' | 'bead-space' | 'on-device' | 'hardware' | 'pillars'>

export interface ContextEndpoints {
  /** Search across everything the room has read. */
  find?: Endpoint
  /** Documents the workspace has ingested. */
  docs?: Endpoint
  /** Structured data pulled out of those documents. */
  data?: Endpoint
  /** Workspace members. */
  people?: Endpoint
  /** Self-service hardware enrollment and status. */
  hardware?: Endpoint
}

export const DEFAULT_ENDPOINTS: ContextEndpoints = {
  people: '/api/platform/users',
}

interface ContextSurfaceProps {
  id: ContextSurfaceId
  title: string
  query: string
  endpoints: ContextEndpoints
  onClose: () => void
  /** Drop a result into the conversation so the room can act on it. */
  onCite: (text: string) => void
}

interface Row {
  key: string
  name: string
  meta?: string
  cite: string
}

/** Coerce whatever an endpoint returns into rows, without inventing content. */
function toRows(id: ContextSurfaceId, payload: unknown): Row[] {
  const body = payload as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return []
  const list =
    (Array.isArray(body) && body) ||
    (Array.isArray(body.results) && body.results) ||
    (Array.isArray(body.items) && body.items) ||
    (Array.isArray(body.documents) && body.documents) ||
    (Array.isArray(body.users) && body.users) ||
    (Array.isArray(body.messages) && body.messages) ||
    (Array.isArray(body.staff) && body.staff) ||
    (Array.isArray(body.projects) && body.projects) ||
    []

  return (list as Record<string, unknown>[]).slice(0, 40).map((row, i) => {
    const name = String(
      row.name || row.title || row.filename || row.nick || row.subject || row.id || `Item ${i + 1}`,
    )
    const metaBits = [row.role, row.client, row.location, row.doc_type, row.from, row.status]
      .filter((v) => typeof v === 'string' && v)
      .slice(0, 3) as string[]
    return {
      key: String(row.id || `${name}-${i}`),
      name,
      meta: metaBits.join(' · ') || undefined,
      cite: name,
    }
  })
}

export default function ContextSurface({
  id, title, query, endpoints, onClose, onCite,
}: ContextSurfaceProps) {
  const [rows, setRows] = useState<Row[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'unwired' | 'failed'>('loading')

  useEffect(() => {
    const config = endpoints[id]
    if (!config) { setState('unwired'); return }

    const spec = typeof config === 'string' ? { url: config } : config
    const method = spec.method || 'GET'
    const queryKey = spec.queryKey || 'q'

    let cancelled = false
    const url = method === 'GET' && query
      ? `${spec.url}${spec.url.includes('?') ? '&' : '?'}${queryKey}=${encodeURIComponent(query)}`
      : spec.url

    const init: RequestInit =
      method === 'POST'
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ [queryKey]: query }),
          }
        : { credentials: 'same-origin' }

    setState('loading')
    fetch(url, init)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (cancelled) return
        setRows(toRows(id, data))
        setState('ready')
      })
      .catch(() => { if (!cancelled) setState('failed') })

    return () => { cancelled = true }
  }, [id, query, endpoints])

  return (
    <div className="room-context">
      <div className="room-context-head">
        <span className="room-context-title">{title}</span>
        <button type="button" className="room-context-close" onClick={onClose}>Close</button>
      </div>

      <div className="room-context-body">
        {state === 'loading' && <p className="room-note">Looking…</p>}

        {state === 'unwired' && (
          <p className="room-note">
            This app has not connected a source for {title.toLowerCase()} yet. Pass an{' '}
            <code>endpoints.{id}</code> URL to the room to switch it on.
          </p>
        )}

        {state === 'failed' && (
          <p className="room-note">
            Could not reach {title.toLowerCase()}. The room is still live — try again, or ask an
            agent to look instead.
          </p>
        )}

        {state === 'ready' && rows.length === 0 && (
          <p className="room-note">
            {query
              ? `Nothing matched “${query}”.`
              : `Nothing here yet. Drop a file into the room to start filling this.`}
          </p>
        )}

        {state === 'ready' && rows.map((row) => (
          <button
            key={row.key}
            type="button"
            className="room-result"
            onClick={() => onCite(row.cite)}
          >
            <span className="room-result-name">{row.name}</span>
            {row.meta && <span className="room-result-meta">{row.meta}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
