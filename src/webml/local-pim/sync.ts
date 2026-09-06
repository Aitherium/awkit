// GENERATED — DO NOT EDIT.
// Synced from the canonical Bonsai webml runtime (the AitherVeil source
// tree in the AitherOS monorepo). Edit the canonical copy and re-run the
// sync; a hand edit here is overwritten on the next run.
/**
 * Fleet sync seams for the LOCAL-FIRST personal layer — the signed-in upgrade.
 *
 * Local-first stays the instant layer (no login, no round-trip); when a user IS signed
 * in, these seams mirror their data to the existing fleet apps: notes → AitherOne
 * documents (:8224, via /api/platform/one/notes) and events → Chronos (:8223, via the
 * /api/chronos proxy). Each synced item stores the remote id back on the local record
 * (`remoteId`), so a later sync skips it and never duplicates.
 *
 * FAILURE IS LOUD (owner rule: no silent fallbacks). Every item that cannot sync is
 * reported in `failed` with the reason; a sync that says "pushed: N" only counts items
 * whose remote write returned success. An unsigned-in caller gets a clear "not signed
 * in" outcome rather than a cheerful no-op.
 */

import {
  createNote,
  listNotes,
  updateNote,
  listEvents,
  updateEvent,
  type LocalNote,
  type LocalEvent,
} from './store'

export interface SyncOutcome {
  /** Items successfully mirrored to the fleet. */
  pushed: number
  /** Items pulled from the fleet into the local store. */
  pulled: number
  /** Human-readable failures — each is why an item was NOT synced. */
  failed: string[]
}

/** Cheap gate: the session cookie the API routes read. A stale/absent cookie → not synced. */
export function likelySignedIn(): boolean {
  return typeof document !== 'undefined' && document.cookie.includes('aither_auth_token')
}

/* ── Transport ───────────────────────────────────────────────────────────────
   Two ways to reach the fleet, picked per call:

   1. Same-origin /api fetch — works when this OS is served by a server-capable host
      (dev, the fleet-served Veil). On the STATIC apex those routes are moved out of
      the export and 404.
   2. The Awconnect extension — its portal-bridge content script marks <html
      data-aitherconnect> and relays a `fleet-sync` op to the background, which calls
      the fleet-served portal with the user's session cookie (no CORS wall). This is
      what makes Sync real on the static apex — and inside the holographic overlay.

   Failure stays LOUD on both paths. The extension path's auth truth-test is the
   fleet's own 401 (the portal session cookie may not be visible to this origin's
   document.cookie), so `likelySignedIn` is only the gate when there is no extension. */

/** True when the Awconnect content bridge is present on this page. */
export function hasAwconnect(): boolean {
  return typeof document !== 'undefined' && Boolean(document.documentElement.dataset.aitherconnect)
}

/** Whether a sync is worth attempting at all (used by the apps to show the button). */
export function canAttemptSync(): boolean {
  return likelySignedIn() || hasAwconnect()
}

const OP_FOR: Record<string, { op: string }> = {
  'GET /api/platform/one/notes': { op: 'notes-list' },
  'POST /api/platform/one/notes': { op: 'notes-create' },
  'PUT /api/platform/one/notes': { op: 'notes-update' },
  'POST /api/chronos/v1/calendar/events': { op: 'event-create' },
}

/** Round-trip one op through the portal-bridge (page → content script → background). */
function bridgeRequest(op: string, body: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  // This bridge talks to the Awconnect extension through window.postMessage,
  // so it is client-only by construction. Resolve with the same shape the timeout
  // path uses rather than throwing: callers already handle ok:false, and an
  // exception during SSR would take the whole render down instead of degrading.
  if (typeof window === 'undefined') {
    return Promise.resolve({
      ok: false,
      status: 0,
      json: { success: false, error: 'Awconnect bridge is browser-only' },
    })
  }
  return new Promise((resolve) => {
    const reqId = `pim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMsg)
      resolve({ ok: false, status: 0, json: { success: false, error: 'Awconnect did not answer (30s) — is the extension enabled?' } })
    }, 30_000)
    const onMsg = (e: MessageEvent) => {
      const d = e.data
      if (!d || d.__aither !== 'ext→portal' || d.reqId !== reqId) return
      window.clearTimeout(timeout)
      window.removeEventListener('message', onMsg)
      const r = d.response ?? {}
      // The background returns { ok, status, json } from the portal fetch, or
      // { ok:false, error } when the fleet is unreachable. Normalize the error shape
      // so callers read one field.
      resolve({
        ok: Boolean(r.ok),
        status: Number(r.status ?? 0),
        json: r.json ?? (r.error ? { success: false, error: r.error } : null),
      })
    }
    window.addEventListener('message', onMsg)
    window.postMessage({ __aither: 'portal→ext', reqId, type: 'fleet-sync', payload: { op, body } }, window.location.origin)
  })
}

async function request(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  if (hasAwconnect()) {
    const mapped = OP_FOR[`${method} ${path}`]
    if (mapped) return bridgeRequest(mapped.op, body)
  }
  const init: RequestInit = { method, credentials: 'same-origin' }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await fetch(path, init)
  const json = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, json }
}

const postJson = (path: string, body: unknown) => request('POST', path, body)
const getJson = (path: string) => request('GET', path)

/**
 * Push every local note without a remoteId to AitherOne as a document, then pull the
 * caller's AitherOne docs back into the local store. Returns per-category counts.
 */
export async function syncNotesToAitherOne(): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { pushed: 0, pulled: 0, failed: [] }
  if (!canAttemptSync()) {
    outcome.failed.push('not signed in — sign in to sync notes to AitherOne')
    return outcome
  }

  const notes = await listNotes()
  const unsynced = notes.filter((n) => !n.remoteId)
  for (const n of unsynced) {
    try {
      const r = await postJson('/api/platform/one/notes', { title: n.title, content: n.body, tags: n.tags })
      if (!r.ok || !r.json?.success) {
        outcome.failed.push(`${n.title}: ${r.json?.error ?? `HTTP ${r.status}`}`)
        continue
      }
      const remoteId = r.json.data?.doc_id
      if (!remoteId) {
        outcome.failed.push(`${n.title}: AitherOne returned no doc_id`)
        continue
      }
      await updateNote(n.id, { remoteId })
      outcome.pushed++
    } catch (e) {
      outcome.failed.push(`${n.title}: ${(e as Error).message}`)
    }
  }

  // Pull: create local notes for AitherOne docs we don't already have (matched by remoteId).
  try {
    const r = await getJson('/api/platform/one/notes')
    if (r.ok && r.json?.success && Array.isArray(r.json.data?.notes)) {
      const have = new Set<string>(notes.map((n) => n.remoteId).filter(Boolean) as string[])
      for (const doc of r.json.data.notes as { id: string; title: string }[]) {
        if (doc.id && !have.has(doc.id)) {
          await createNote({ title: doc.title, body: '', tags: [], remoteId: doc.id })
          outcome.pulled++
        }
      }
    } else if (!r.ok) {
      outcome.failed.push(`pull: ${r.json?.error ?? `HTTP ${r.status}`}`)
    }
  } catch (e) {
    outcome.failed.push(`pull: ${(e as Error).message}`)
  }

  return outcome
}

/**
 * Push every local event without a remoteId to Chronos (via the /api/chronos proxy).
 * Pull-back from Chronos is intentionally not automatic — a local-first calendar should
 * not silently mirror a tenant calendar into every visitor's device.
 */
export async function syncEventsToChronos(): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { pushed: 0, pulled: 0, failed: [] }
  if (!canAttemptSync()) {
    outcome.failed.push('not signed in — sign in to sync events to Chronos')
    return outcome
  }

  const events = await listEvents()
  for (const e of events.filter((ev) => !ev.remoteId)) {
    try {
      const r = await postJson('/api/chronos/v1/calendar/events', {
        title: e.title,
        start: e.start,
        end: e.end,
        location: e.location,
      })
      if (!r.ok || !r.json?.success) {
        outcome.failed.push(`${e.title}: ${r.json?.error ?? `HTTP ${r.status}`}`)
        continue
      }
      const remoteId = r.json.data?.event?.id ?? r.json.data?.id ?? r.json.data?.event_id
      if (!remoteId) {
        outcome.failed.push(`${e.title}: Chronos returned no event id`)
        continue
      }
      await updateEvent(e.id, { remoteId })
      outcome.pushed++
    } catch (err) {
      outcome.failed.push(`${e.title}: ${(err as Error).message}`)
    }
  }

  return outcome
}

/** Run both syncs. Notes first (the primary product), then events. */
export async function syncAll(): Promise<{ notes: SyncOutcome; events: SyncOutcome }> {
  const notes = await syncNotesToAitherOne()
  const events = await syncEventsToChronos()
  return { notes, events }
}

/** Type-reference so the store types stay in the emitted graph for tests. */
export function _syncTypes(_n?: LocalNote, _e?: LocalEvent): void {
  /* no-op */
}
