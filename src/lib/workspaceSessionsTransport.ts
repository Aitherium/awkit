/**
 * The AgentSessionsTransport for a tenant WORKSPACE: one harness router at
 * `/api/workspace/harness` (the daemon bearer stays server-side). The workspace is one
 * "machine" to the panel. Used by awkit's `sessions` panel so tenant portals render the
 * SAME AgentSessionsPanel as AitherOS Online, the desk and the phone.
 */

import { rewriteApiUrl } from './apiBase'
import {
  foldEvents,
  type AgentActionResult,
  type AgentHarnessEvent,
  type AgentListResult,
  type AgentReadResult,
  type AgentSession,
  type AgentSessionsTransport,
  type AgentStartRequest,
  type AgentStartResult,
} from './agentSessions'

export const WORKSPACE_NODE = 'workspace'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

async function detailOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown; error?: unknown }
    if (typeof body?.detail === 'string' && body.detail) return body.detail
    if (typeof body?.error === 'string' && body.error) return body.error
  } catch {
    // a non-JSON refusal keeps the status line
  }
  return `HTTP ${res.status}`
}

interface WorkspaceRow {
  id?: unknown
  title?: string
  harness?: string
  harness_label?: string
  origin?: string
  status?: string
  last_activity_at?: string | number
  last_activity_summary?: string
}

function epoch(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v) {
    const t = Date.parse(v)
    return Number.isNaN(t) ? undefined : Math.floor(t / 1000)
  }
  return undefined
}

export function workspaceSessionsTransport(
  base = '/api/workspace/harness',
  doFetch: FetchLike = (input, init) => fetch(rewriteApiUrl(input), init),
  machine = 'This workspace',
): AgentSessionsTransport {
  const call = (path: string, init?: RequestInit) =>
    doFetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })

  return {
    async list(signal?: AbortSignal): Promise<AgentListResult> {
      const res = await call('/sessions', { cache: 'no-store', signal })
      if (!res.ok) throw new Error(await detailOf(res))
      const body = (await res.json()) as { sessions?: WorkspaceRow[] }
      const rows = Array.isArray(body?.sessions) ? body.sessions : []
      const sessions: AgentSession[] = rows
        .filter((r) => r && typeof r.id === 'string' && r.id)
        .map((r) => ({
          id: String(r.id),
          nodeId: WORKSPACE_NODE,
          machine,
          title: r.title,
          harness: r.harness,
          harness_label: r.harness_label,
          origin: r.origin || 'daemon',
          status: r.status,
          last_activity_at: epoch(r.last_activity_at),
          last_activity_summary: r.last_activity_summary,
          canMessage: (r.status || '').toLowerCase() !== 'exited',
          canInterrupt: (r.status || '').toLowerCase() !== 'exited',
        }))
      return { sessions, machines: [{ nodeId: WORKSPACE_NODE, label: machine, online: true, canStart: true }], errors: [] }
    },

    async read(session: AgentSession, cursor: unknown, signal?: AbortSignal): Promise<AgentReadResult> {
      const since = typeof cursor === 'number' ? cursor : 0
      const res = await call(`/sessions/${encodeURIComponent(session.id)}/events?since=${since}`, { cache: 'no-store', signal })
      if (res.status === 403 || res.status === 404) return { lines: [], cursor, unavailable: await detailOf(res) }
      if (!res.ok) throw new Error(await detailOf(res))
      const body = (await res.json()) as { events?: AgentHarnessEvent[]; last_seq?: number }
      const events = Array.isArray(body?.events) ? body.events : []
      return { lines: foldEvents([], events), cursor: typeof body?.last_seq === 'number' ? body.last_seq : since }
    },

    async send(session: AgentSession, text: string): Promise<AgentActionResult> {
      const res = await call(`/sessions/${encodeURIComponent(session.id)}/input`, {
        method: 'POST', body: JSON.stringify({ text, submit: true }),
      })
      return res.ok ? { ok: true, detail: 'Sent.' } : { ok: false, detail: await detailOf(res) }
    },

    async interrupt(session: AgentSession): Promise<AgentActionResult> {
      const res = await call(`/sessions/${encodeURIComponent(session.id)}/interrupt`, { method: 'POST' })
      return res.ok ? { ok: true, detail: '' } : { ok: false, detail: await detailOf(res) }
    },

    async start(request: AgentStartRequest): Promise<AgentStartResult> {
      // The workspace router takes the first turn in the create body (members run in
      // their sandbox; a refusal names the missing sandbox).
      const res = await call('/sessions', {
        method: 'POST', body: JSON.stringify({ harness: request.harness, prompt: (request.prompt || '').trim() }),
      })
      if (!res.ok) return { ok: false, detail: await detailOf(res) }
      const created = (await res.json().catch(() => ({}))) as { id?: string }
      if (!created?.id) return { ok: true, detail: '' }
      return {
        ok: true, detail: '',
        session: { id: created.id, nodeId: WORKSPACE_NODE, machine, harness: request.harness, status: 'working', origin: 'daemon', canMessage: true, canInterrupt: true },
      }
    },
  }
}
