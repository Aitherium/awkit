/**
 * Agent sessions — the pure rules behind `AgentSessionsPanel`.
 *
 * One list of the owner's running agent sessions across every machine (an awsh
 * harness daemon per machine, `GET /sessions/unified`), what a row says at one
 * glance, and the body that starts a new one. No I/O here: every host (Veil,
 * the desk, a WebView) supplies an `AgentSessionsTransport` and the panel never
 * learns which door it went through. That is what lets the SAME panel render
 * in AitherOS Online, AitherDesktop and the Android app.
 *
 * The transport owns auth. A host must scope the list to the AUTHENTICATED
 * caller (Veil does it server-side in `lib/harness-proxy.ts`); nothing in this
 * file ever names a tenant or a user.
 */

/** One running (or recently ended) agent session on one machine. */
export interface AgentSession {
  id: string
  /** Which machine answered: the device id the transport routes by. */
  nodeId: string
  /** What to call that machine on a phone-width row. */
  machine: string
  name?: string
  title?: string
  harness?: string
  harness_label?: string
  /** Daemon vocabulary: idle | working | waiting-input | waiting-permission | exited | blocked? */
  status?: string
  /** `daemon` = spawned by the daemon; `discovered` = a terminal tab it found. */
  origin?: string
  /** Epoch SECONDS. */
  last_activity_at?: number
  last_activity_summary?: string
  last_prompt?: string
  /** False when the daemon said this row takes no message; `whyNot` says why. */
  canMessage: boolean
  whyNot?: string
  /** The daemon says this session takes an interrupt (stop the current turn). */
  canInterrupt?: boolean
  /** A claude.ai remote-control address; rendered only if `safeRemoteUrl` passes it. */
  remoteUrl?: string
  /** Tokens spent so far; null/absent while the daemon is still counting. */
  tokens?: number | null
}

/** A machine the owner can see, and whether a session can be started on it. */
export interface AgentMachine {
  nodeId: string
  label: string
  online: boolean
  canStart: boolean
  /** Why `canStart` is false, in one sentence. */
  why?: string
}

export type TranscriptRole = 'you' | 'agent' | 'thinking' | 'tool' | 'system' | 'error'

export interface AgentTranscriptLine {
  seq: number
  role: TranscriptRole
  text: string
}

/** A decision card an agent raised and is waiting on (awask, the daemon's `/decisions`). */
export interface AgentDecision {
  id: string
  nodeId: string
  machine: string
  title: string
  description?: string
  urgency?: string
  options: Array<{ key: string; label: string; recommended?: boolean }>
  age_seconds?: number
}

export interface AgentListResult {
  sessions: AgentSession[]
  machines: AgentMachine[]
  /** Open decision cards on those machines, shown above the sessions. */
  decisions?: AgentDecision[]
  /** Machines that were asked and could not answer — shown, never swallowed. */
  errors: Array<{ machine: string; nodeId?: string; detail: string }>
}

export interface AgentReadResult {
  /** Only the lines that are NEW since `cursor`. */
  lines: AgentTranscriptLine[]
  /** Opaque to the panel: handed back on the next read. */
  cursor: unknown
  /** Set when the session can never be read here (an older daemon, a refusal). */
  unavailable?: string
}

export interface AgentActionResult {
  ok: boolean
  detail: string
}

export interface AgentStartRequest {
  nodeId: string
  harness: string
  /** Folder on that machine; '' = the daemon's default. */
  cwd?: string
  /** First message, typed into the new session once it exists. */
  prompt?: string
}

export interface AgentStartResult extends AgentActionResult {
  session?: AgentSession
}

/** The one seam a host implements. */
export interface AgentSessionsTransport {
  list(signal?: AbortSignal): Promise<AgentListResult>
  read(session: AgentSession, cursor: unknown, signal?: AbortSignal): Promise<AgentReadResult>
  send(session: AgentSession, text: string): Promise<AgentActionResult>
  start(request: AgentStartRequest): Promise<AgentStartResult>
  /** Stop the session's current turn. Hosts whose daemon has no interrupt omit it. */
  interrupt?(session: AgentSession): Promise<AgentActionResult>
  /** Answer a decision card in place. Hosts without decisions omit it. */
  answer?(decision: AgentDecision, key: string): Promise<AgentActionResult>
}

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 }

/** Most urgent first, then oldest first (the one that has waited longest). Never mutates. */
export function decisionOrder(decisions: readonly AgentDecision[]): AgentDecision[] {
  return [...(decisions || [])].sort((a, b) => {
    const u = (URGENCY_RANK[(a.urgency || 'normal').toLowerCase()] ?? 2)
      - (URGENCY_RANK[(b.urgency || 'normal').toLowerCase()] ?? 2)
    if (u !== 0) return u
    return (b.age_seconds || 0) - (a.age_seconds || 0)
  })
}

/** "5m" from seconds, for a card's corner. */
export function ageLabel(seconds?: number): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return ''
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

/**
 * A remote-control link only when it is https on claude.ai. The row comes from somebody's
 * machine; an href built from it unchecked is a `javascript:` URL one bad write away.
 */
export function safeRemoteUrl(url?: string): string {
  if (!url) return ''
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return ''
  }
  if (u.protocol !== 'https:') return ''
  const h = u.hostname.toLowerCase()
  return h === 'claude.ai' || h.endsWith('.claude.ai') ? u.toString() : ''
}

/** The harnesses offered in Start, most-used first. Ids match awdk `harnesses/registry.py`. */
export const AGENT_HARNESSES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'opencode', label: 'opencode' },
  { id: 'aither', label: 'Aither' },
]

/** One-tap answers offered on a session waiting for INPUT. Not on waiting-permission: a
 *  harness permission menu takes its own keys, and a typed "yes" may select nothing. */
export const QUICK_REPLIES: readonly string[] = ['yes', 'no', 'continue']

export type AgentTone = 'attention' | 'working' | 'idle' | 'ended'

/** The one word a row's chip says. A session waiting on a human is never folded into "working". */
export function agentStatus(status?: string): { label: string; tone: AgentTone } {
  const s = (status || '').toLowerCase()
  if (s.startsWith('waiting') || s === 'blocked?') return { label: 'needs you', tone: 'attention' }
  if (s === 'working') return { label: 'working', tone: 'working' }
  if (s === 'exited') return { label: 'ended', tone: 'ended' }
  return { label: 'idle', tone: 'idle' }
}

const TONE_RANK: Record<AgentTone, number> = { attention: 0, working: 1, idle: 2, ended: 3 }

/** Needs-you first, then working, idle, ended; newest first inside each. Never mutates. */
export function glanceOrder(sessions: readonly AgentSession[]): AgentSession[] {
  return [...(sessions || [])].sort((a, b) => {
    const rank = TONE_RANK[agentStatus(a.status).tone] - TONE_RANK[agentStatus(b.status).tone]
    if (rank !== 0) return rank
    return (b.last_activity_at || 0) - (a.last_activity_at || 0)
  })
}

/** How many rows are waiting on the owner — the number the header leads with. */
/** Whether the one-tap answers fit this session's wait. */
export function offersQuickReplies(status?: string): boolean {
  const s = (status || '').toLowerCase()
  return s === 'waiting-input' || s === 'blocked?'
}

/** Harnesses whose Start turns on auto-accepted file edits (the Start sheet says so). */
export const AUTO_ACCEPT_HARNESSES: readonly string[] = ['claude', 'gemini']

export function needsYouCount(sessions: readonly AgentSession[]): number {
  return (sessions || []).filter((s) => agentStatus(s.status).tone === 'attention').length
}

/** What to call a session: its own name, then its title, then its harness. */
export function sessionName(session: Pick<AgentSession, 'name' | 'title' | 'harness_label' | 'harness'>): string {
  for (const v of [session.name, session.title, session.harness_label, session.harness]) {
    const t = (v || '').replace(/\s+/g, ' ').trim()
    if (t) return t
  }
  return 'session'
}

/** The row's one line: what it last did, else the last thing it was asked. Single line, capped. */
export function lastLine(
  session: Pick<AgentSession, 'last_activity_summary' | 'last_prompt'>,
  max = 120,
): string {
  const raw = (session.last_activity_summary || session.last_prompt || '').replace(/\s+/g, ' ').trim()
  if (raw.length <= max) return raw
  return `${raw.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

/** "12.3k tokens", or '' when the daemon has not counted yet. */
export function tokensText(tokens?: number | null): string {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) return ''
  if (tokens < 1000) return `${tokens} tokens`
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k tokens`
  return `${(tokens / 1_000_000).toFixed(1)}M tokens`
}

/** "3m ago" from epoch SECONDS. */
export function agoLabel(epochSeconds?: number, nowMs: number = Date.now()): string {
  if (!epochSeconds || epochSeconds <= 0) return ''
  const d = Math.max(0, Math.round(nowMs / 1000 - epochSeconds))
  if (d < 45) return 'just now'
  if (d < 3600) return `${Math.round(d / 60)}m ago`
  if (d < 86400) return `${Math.round(d / 3600)}h ago`
  return `${Math.round(d / 86400)}d ago`
}

/** Machines a session can be started on, online first. */
export function startableMachines(machines: readonly AgentMachine[]): AgentMachine[] {
  return (machines || []).filter((m) => m.canStart)
}

/** The machine Start preselects: the only startable one, else none (the owner picks). */
export function defaultMachine(machines: readonly AgentMachine[]): string {
  const ok = startableMachines(machines)
  return ok.length === 1 ? ok[0].nodeId : ''
}

/**
 * `POST /sessions` body for the harness daemon (`CreateSession` in
 * awdk/adk/harnesses/daemon.py). The prompt is NOT here: the daemon has no
 * such field, so the transport types it into the session once it exists.
 * Unknown harness ids are refused rather than forwarded — the daemon enforces
 * entitlement too, but a picker must not offer what it does not list.
 */
export function startBody(request: AgentStartRequest): Record<string, unknown> {
  const harness = (request.harness || '').trim()
  if (!AGENT_HARNESSES.some((h) => h.id === harness)) {
    throw new Error(`unknown harness: ${harness || '(none)'}`)
  }
  const body: Record<string, unknown> = { harness, cwd: (request.cwd || '').trim() }
  if (AUTO_ACCEPT_HARNESSES.includes(harness)) body.permission_mode = 'acceptEdits'
  return body
}

/** A harness event (`awdk/adk/harnesses/events.py::EventKind`), as far as a phone needs it. */
export interface AgentHarnessEvent {
  kind: string
  seq?: number
  text?: string
  tool?: string
}

function lineFor(event: AgentHarnessEvent): AgentTranscriptLine | null {
  const seq = typeof event.seq === 'number' ? event.seq : 0
  switch (event.kind) {
    case 'turn.started': return { seq, role: 'you', text: event.text || '' }
    case 'text.delta': return { seq, role: 'agent', text: event.text || '' }
    case 'thinking.delta': return { seq, role: 'thinking', text: event.text || '' }
    case 'tool.call': return { seq, role: 'tool', text: event.tool ? `${event.tool}()` : 'tool call' }
    case 'notice': return { seq, role: 'system', text: event.text || '' }
    case 'error': return { seq, role: 'error', text: event.text || 'error' }
    case 'session.exited': return { seq, role: 'system', text: 'session ended' }
    default: return null
  }
}

const COALESCE: ReadonlySet<TranscriptRole> = new Set(['agent', 'thinking'])

/** Fold events into transcript lines in seq order, coalescing consecutive model deltas. */
export function foldEvents(
  lines: readonly AgentTranscriptLine[],
  events: readonly AgentHarnessEvent[],
): AgentTranscriptLine[] {
  const out = [...lines]
  for (const ev of events || []) {
    const next = lineFor(ev)
    if (!next || (!next.text && next.role !== 'system')) continue
    const last = out[out.length - 1]
    if (last && last.role === next.role && COALESCE.has(next.role)) {
      out[out.length - 1] = { ...last, seq: next.seq, text: last.text + next.text }
    } else {
      out.push(next)
    }
  }
  return out
}

/** Append freshly read lines to what is on screen, merging a delta split across two reads. */
export function mergeLines(
  shown: readonly AgentTranscriptLine[],
  fresh: readonly AgentTranscriptLine[],
): AgentTranscriptLine[] {
  if (!fresh.length) return shown as AgentTranscriptLine[]
  const out = [...shown]
  for (const line of fresh) {
    const last = out[out.length - 1]
    if (last && last.role === line.role && COALESCE.has(line.role)) {
      out[out.length - 1] = { ...last, seq: line.seq, text: last.text + line.text }
    } else {
      out.push(line)
    }
  }
  return out
}
