'use client'

/**
 * AgentSessionsPanel — my running agents, on every machine, from one screen.
 *
 * Three jobs, each a short tap path (phone-first, 390 px):
 *   (a) see my sessions and talk to one   list -> tap a row -> type -> Send
 *   (b) start an agent on a chosen machine  Start -> pick machine -> Start
 *   (c) answer an agent that is waiting    "needs you" rows sort first -> tap -> Yes/No
 *
 * The panel does no I/O of its own: the host passes an `AgentSessionsTransport`
 * (lib/agentSessions.ts). Veil's goes through its authenticated harness proxy;
 * any other React host (the desk, a WebView page) supplies its own. Failure is
 * a rendered sentence, never an empty list — "could not look" and "nothing is
 * running" must not read the same.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AGENT_HARNESSES,
  AUTO_ACCEPT_HARNESSES,
  QUICK_REPLIES,
  agentStatus,
  agoLabel,
  ageLabel,
  decisionOrder,
  defaultMachine,
  glanceOrder,
  lastLine,
  mergeLines,
  needsYouCount,
  offersQuickReplies,
  safeRemoteUrl,
  tokensText,
  sessionName,
  startableMachines,
  type AgentDecision,
  type AgentListResult,
  type AgentSession,
  type AgentSessionsTransport,
  type AgentTone,
  type AgentTranscriptLine,
} from '../lib/agentSessions'

// One import path for hosts: the panel AND its rules (Veil aliases this file, not lib/).
export * from '../lib/agentSessions'

export interface AgentSessionsPanelProps {
  transport: AgentSessionsTransport
  /** List refresh, ms. */
  listEveryMs?: number
  /** Open-session refresh, ms. */
  readEveryMs?: number
  /** Header title; hosts that already title the window pass ''. */
  title?: string
  /** Px kept clear under the composer for a host's floating button (Veil's chat FAB on a phone). */
  bottomInset?: number
  /** True while the host hides the panel (a background tab): polling stops. */
  paused?: boolean
}

const C = {
  ink: 'var(--text-primary, #EDEFF5)',
  dim: 'var(--text-secondary, rgba(237,239,245,.62))',
  faint: 'var(--text-muted, rgba(237,239,245,.42))',
  line: '1px solid var(--glass-border, rgba(237,239,245,.10))',
  card: 'var(--bg-elevated, rgba(255,255,255,.04))',
  accent: 'var(--accent, #5EC9CC)',
}

const TONE: Record<AgentTone, { fg: string; bg: string }> = {
  attention: { fg: '#FCD34D', bg: 'rgba(251,191,36,.14)' },
  working: { fg: '#6EE7B7', bg: 'rgba(16,185,129,.14)' },
  idle: { fg: 'rgba(237,239,245,.62)', bg: 'rgba(237,239,245,.06)' },
  ended: { fg: 'rgba(237,239,245,.42)', bg: 'rgba(237,239,245,.04)' },
}

const BTN: React.CSSProperties = {
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 12,
  border: C.line,
  background: 'transparent',
  color: C.ink,
  fontSize: 15,
  cursor: 'pointer',
}
const PRIMARY: React.CSSProperties = { ...BTN, background: C.accent, color: '#06121A', border: 'none', fontWeight: 600 }

function Chip({ tone, label }: { tone: AgentTone; label: string }) {
  return (
    <span
      data-tone={tone}
      style={{
        fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
        color: TONE[tone].fg, background: TONE[tone].bg, whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

/** `fallback` carries a just-started session until the next list read includes it. */
type View = { kind: 'list' } | { kind: 'session'; key: string; fallback?: AgentSession } | { kind: 'start' }

const keyOf = (s: Pick<AgentSession, 'nodeId' | 'id'>) => `${s.nodeId}/${s.id}`

/** Transcript lines kept on screen (and in memory) per open session. */
const MAX_LINES = 200

export function AgentSessionsPanel({
  transport,
  listEveryMs = 10_000,
  readEveryMs = 2_500,
  title = 'Agents',
  bottomInset = 0,
  paused = false,
}: AgentSessionsPanelProps) {
  const [view, setView] = useState<View>({ kind: 'list' })
  const [list, setList] = useState<AgentListResult | null>(null)
  const [listError, setListError] = useState('')

  // One list read at a time: a sleeping machine can hold a read for minutes, and a slow
  // old answer must never land over a newer one.
  const inFlight = useRef(false)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const next = await transport.list(signal)
      if (signal?.aborted) return
      setList(next)
      setListError('')
    } catch (err) {
      if (signal?.aborted) return
      setListError(err instanceof Error ? err.message : 'Could not read your sessions.')
    } finally {
      inFlight.current = false
    }
  }, [transport])

  useEffect(() => {
    if (paused) return
    const ctl = new AbortController()
    void refresh(ctl.signal)
    const id = setInterval(() => void refresh(ctl.signal), listEveryMs)
    return () => { ctl.abort(); clearInterval(id); inFlight.current = false }
  }, [refresh, listEveryMs, paused])

  const sessions = useMemo(() => glanceOrder(list?.sessions || []), [list])
  // Cards answered here vanish at once; the next list read confirms it.
  const [answered, setAnswered] = useState<Record<string, true>>({})
  const decisions = useMemo(
    () => decisionOrder((list?.decisions || []).filter((d) => !answered[`${d.nodeId}/${d.id}`])),
    [list, answered],
  )
  const [rowNote, setRowNote] = useState('')
  const answer = useCallback(async (d: AgentDecision, key: string) => {
    if (!transport.answer) return
    const k = `${d.nodeId}/${d.id}`
    setAnswered((v) => ({ ...v, [k]: true }))
    try {
      const r = await transport.answer(d, key)
      setRowNote(r.ok ? `Answered: ${d.title}` : `Not answered: ${r.detail}`)
      if (!r.ok) setAnswered((v) => { const n = { ...v }; delete n[k]; return n })
    } catch (err) {
      setRowNote(`Not answered: ${err instanceof Error ? err.message : String(err)}`)
      setAnswered((v) => { const n = { ...v }; delete n[k]; return n })
    }
  }, [transport])
  const quick = useCallback(async (s: AgentSession, text: string) => {
    try {
      const r = await transport.send(s, text)
      setRowNote(r.ok ? `${sessionName(s)}: ${text}` : `Not sent: ${r.detail}`)
    } catch (err) {
      setRowNote(`Not sent: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [transport])
  const open = view.kind === 'session' ? sessions.find((s) => keyOf(s) === view.key) || view.fallback || null : null

  const root: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, width: '100%',
    color: C.ink, fontFamily: 'inherit', fontSize: 15,
  }

  if (view.kind === 'start') {
    return (
      <div style={root} data-awkit="agent-sessions" data-view="start">
        <StartSheet
          transport={transport}
          list={list}
          onCancel={() => setView({ kind: 'list' })}
          onStarted={(s) => {
            void refresh()
            if (!s) { setView({ kind: 'list' }); return }
            const label = list?.machines.find((m) => m.nodeId === s.nodeId)?.label
            const fallback = label ? { ...s, machine: label } : s
            setView({ kind: 'session', key: keyOf(s), fallback })
          }}
        />
      </div>
    )
  }

  if (view.kind === 'session') {
    return (
      <div style={root} data-awkit="agent-sessions" data-view="session">
        <SessionView
          transport={transport}
          session={open}
          readEveryMs={readEveryMs}
          bottomInset={bottomInset}
          paused={paused}
          onBack={() => setView({ kind: 'list' })}
        />
      </div>
    )
  }

  const waiting = needsYouCount(sessions) + decisions.length
  const live = sessions.filter((s) => agentStatus(s.status).tone !== 'ended').length
  const canStart = startableMachines(list?.machines || []).length > 0

  return (
    <div style={root} data-awkit="agent-sessions" data-view="list">
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: C.line }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {title && <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{title}</h2>}
          <p style={{ margin: 0, fontSize: 13, color: waiting ? TONE.attention.fg : C.dim }} aria-live="polite">
            {listError && !list ? 'Could not look' : !list ? 'Looking…' : waiting ? `${waiting} need${waiting === 1 ? 's' : ''} you` : `${live} running`}
          </p>
        </div>
        <button
          type="button"
          style={canStart ? PRIMARY : { ...BTN, opacity: 0.5 }}
          disabled={!canStart}
          title={canStart ? 'Start an agent' : 'No machine can start one right now'}
          onClick={() => setView({ kind: 'start' })}
        >
          Start
        </button>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 12px 16px' }}>
        {listError && <Note>{listError}</Note>}
        {rowNote && <Note>{rowNote}</Note>}
        {decisions.length > 0 && (
          <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0, display: 'grid', gap: 8 }} aria-label="Waiting on you">
            {decisions.map((d) => (
              <li key={`${d.nodeId}/${d.id}`} data-decision={d.id}
                style={{ padding: '12px 14px', borderRadius: 14, border: `1px solid ${TONE.attention.fg}`, background: C.card, display: 'grid', gap: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{d.title}</span>
                  <Chip tone="attention" label="asks you" />
                </span>
                <span style={{ fontSize: 12, color: C.faint }}>
                  {d.machine}{ageLabel(d.age_seconds) ? ` · ${ageLabel(d.age_seconds)}` : ''}
                </span>
                {d.description && (
                  <span style={{ fontSize: 13, color: C.dim, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {d.description}
                  </span>
                )}
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {d.options.map((o) => (
                    <button key={o.key} type="button" disabled={!transport.answer}
                      style={o.recommended ? { ...PRIMARY, flex: '1 1 auto' } : { ...BTN, flex: '1 1 auto' }}
                      onClick={() => void answer(d, o.key)}>
                      {o.label}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
        {list && sessions.length === 0 && decisions.length === 0 && !listError && (
          <Note>
            {list.machines.length === 0
              ? 'No machines yet. Run `awsh rc` on a computer to add it.'
              : 'Nothing running. Tap Start.'}
          </Note>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }} aria-label="Sessions">
          {sessions.map((s) => {
            const st = agentStatus(s.status)
            const line = lastLine(s)
            return (
              <li key={keyOf(s)}>
                <button
                  type="button"
                  data-session={s.id}
                  onClick={() => setView({ kind: 'session', key: keyOf(s) })}
                  style={{
                    width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 14,
                    border: st.tone === 'attention' ? `1px solid ${TONE.attention.fg}` : C.line,
                    background: C.card, color: C.ink, cursor: 'pointer', display: 'grid', gap: 4,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sessionName(s)}
                    </span>
                    <Chip tone={st.tone} label={st.label} />
                  </span>
                  <span style={{ fontSize: 12, color: C.faint }}>
                    {s.machine}{agoLabel(s.last_activity_at) ? ` · ${agoLabel(s.last_activity_at)}` : ''}{tokensText(s.tokens) ? ` · ${tokensText(s.tokens)}` : ''}
                  </span>
                  {line && (
                    <span style={{ fontSize: 13, color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {line}
                    </span>
                  )}
                </button>
                {s.canMessage && offersQuickReplies(s.status) && (
                  <span style={{ display: 'flex', gap: 8, marginTop: 6 }} aria-label={`Answer ${sessionName(s)}`}>
                    {QUICK_REPLIES.map((q) => (
                      <button key={q} type="button" style={{ ...BTN, flex: 1, minHeight: 40 }} onClick={() => void quick(s, q)}>
                        {q[0].toUpperCase() + q.slice(1)}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        {(list?.errors || []).map((e, i) => (
          <Note key={`${e.nodeId || e.machine}-${i}`}>{e.machine}: {e.detail}</Note>
        ))}
      </div>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <p role="status" style={{ margin: '8px 4px', fontSize: 13, color: C.dim }}>{children}</p>
}

const ROLE_STYLE: Record<AgentTranscriptLine['role'], React.CSSProperties> = {
  you: { alignSelf: 'flex-end', background: 'rgba(94,201,204,.16)' },
  agent: { alignSelf: 'flex-start', background: 'rgba(255,255,255,.05)' },
  thinking: { alignSelf: 'flex-start', color: 'rgba(237,239,245,.42)', fontStyle: 'italic' },
  tool: { alignSelf: 'flex-start', color: 'rgba(237,239,245,.42)', fontFamily: 'ui-monospace, monospace', fontSize: 12 },
  system: { alignSelf: 'center', color: 'rgba(237,239,245,.42)', fontSize: 12 },
  error: { alignSelf: 'flex-start', color: '#FCA5A5' },
}

function SessionView({
  transport, session, readEveryMs, bottomInset, paused, onBack,
}: {
  transport: AgentSessionsTransport
  session: AgentSession | null
  readEveryMs: number
  bottomInset: number
  paused: boolean
  onBack: () => void
}) {
  const [lines, setLines] = useState<AgentTranscriptLine[]>([])
  const [unavailable, setUnavailable] = useState('')
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')
  const [sending, setSending] = useState(false)
  const cursor = useRef<unknown>(undefined)
  const tail = useRef<HTMLDivElement | null>(null)
  const sid = session ? keyOf(session) : ''

  // A new session starts a fresh transcript; a pause only stops the clock.
  useEffect(() => {
    cursor.current = undefined
    setLines([])
    setUnavailable('')
  }, [sid])

  useEffect(() => {
    if (!session || paused) return
    const ctl = new AbortController()
    let stop = false
    let failures = 0
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const r = await transport.read(session, cursor.current, ctl.signal)
        if (stop) return
        failures = 0
        cursor.current = r.cursor
        if (r.unavailable) { setUnavailable(r.unavailable); stop = true; return }
        if (r.lines.length) setLines((prev) => mergeLines(prev, r.lines).slice(-MAX_LINES))
      } catch (err) {
        // One miss is weather; three in a row is a fact the owner should see.
        failures += 1
        if (!stop && failures >= 3) {
          setUnavailable(err instanceof Error ? err.message : 'Could not read this session.')
        }
      } finally {
        busy = false
      }
    }
    void tick()
    const id = setInterval(() => { if (!stop) void tick() }, readEveryMs)
    return () => { stop = true; ctl.abort(); clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, transport, readEveryMs, paused])

  useEffect(() => {
    const el = tail.current
    if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight })
  }, [lines])

  const send = useCallback(async (text: string) => {
    const t = text.trim()
    if (!session || !t || sending) return
    setSending(true)
    setNotice('')
    try {
      const r = await transport.send(session, t)
      if (r.ok) {
        setDraft('')
        setNotice(r.detail || 'Sent.')
      } else {
        setNotice(`Not sent: ${r.detail}`)
      }
    } catch (err) {
      setNotice(`Not sent: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSending(false)
    }
  }, [session, sending, transport])

  if (!session) {
    return (
      <>
        <BackBar onBack={onBack} title="Session" />
        <Note>This session is gone from the list.</Note>
      </>
    )
  }

  const st = agentStatus(session.status)
  const waiting = st.tone === 'attention'
  const remote = safeRemoteUrl(session.remoteUrl)
  const canStop = !!transport.interrupt && !!session.canInterrupt && st.tone !== 'ended'
  const stop = async () => {
    if (!transport.interrupt) return
    setNotice('')
    try {
      const r = await transport.interrupt(session)
      setNotice(r.ok ? 'Stopped.' : `Not stopped: ${r.detail}`)
    } catch (err) {
      setNotice(`Not stopped: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <>
      <BackBar onBack={onBack} title={sessionName(session)} sub={session.machine} chip={<Chip tone={st.tone} label={st.label} />} />
      {(remote || canStop) && (
        <div style={{ display: 'flex', gap: 8, padding: '6px 12px', borderBottom: C.line }}>
          {canStop && (
            <button type="button" style={{ ...BTN, minHeight: 36 }} disabled={sending} onClick={() => void stop()}>
              Stop
            </button>
          )}
          {remote && (
            <a href={remote} target="_blank" rel="noopener noreferrer"
              style={{ ...BTN, minHeight: 36, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
              Open in claude.ai
            </a>
          )}
        </div>
      )}
      <div
        ref={tail}
        aria-label="Transcript"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        {lines.length === 0 && !unavailable && <Note>{lastLine(session, 400) || 'Nothing to read yet.'}</Note>}
        {unavailable && <Note>{unavailable}</Note>}
        {lines.map((l, i) => (
          <div
            key={l.seq ? `s${l.seq}` : `i${i}`}
            data-role={l.role}
            style={{ maxWidth: '88%', padding: '6px 10px', borderRadius: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14, ...ROLE_STYLE[l.role] }}
          >
            {l.text}
          </div>
        ))}
      </div>
      <footer style={{ borderTop: C.line, padding: 10, paddingBottom: 10 + bottomInset, display: 'grid', gap: 8 }}>
        {waiting && session.canMessage && offersQuickReplies(session.status) && (
          <div style={{ display: 'flex', gap: 8 }} aria-label="Quick answers">
            {QUICK_REPLIES.map((q) => (
              <button key={q} type="button" style={{ ...BTN, flex: 1 }} disabled={sending} onClick={() => void send(q)}>
                {q[0].toUpperCase() + q.slice(1)}
              </button>
            ))}
          </div>
        )}
        {session.canMessage ? (
          <form
            style={{ display: 'flex', gap: 8 }}
            onSubmit={(e) => { e.preventDefault(); void send(draft) }}
          >
            <input
              aria-label="Message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message"
              style={{ flex: 1, minHeight: 44, borderRadius: 12, border: C.line, background: 'transparent', color: C.ink, padding: '0 12px', fontSize: 16 }}
            />
            <button type="submit" style={PRIMARY} disabled={sending || !draft.trim()}>Send</button>
          </form>
        ) : (
          <Note>{session.whyNot || 'This session does not take messages.'}</Note>
        )}
        {notice && <Note>{notice}</Note>}
      </footer>
    </>
  )
}

function BackBar({ onBack, title, sub, chip }: { onBack: () => void; title: string; sub?: string; chip?: React.ReactNode }) {
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: C.line }}>
      <button type="button" aria-label="Back" onClick={onBack} style={{ ...BTN, padding: '0 12px' }}>‹</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>
        {sub && <p style={{ margin: 0, fontSize: 12, color: C.faint }}>{sub}</p>}
      </div>
      {chip}
    </header>
  )
}

function StartSheet({
  transport, list, onCancel, onStarted,
}: {
  transport: AgentSessionsTransport
  list: AgentListResult | null
  onCancel: () => void
  onStarted: (session: AgentSession | undefined) => void
}) {
  const machines = startableMachines(list?.machines || [])
  const [nodeId, setNodeId] = useState(() => defaultMachine(list?.machines || []))
  const [harness, setHarness] = useState(AGENT_HARNESSES[0].id)
  const [cwd, setCwd] = useState('')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pill = (on: boolean): React.CSSProperties => ({
    ...BTN, borderRadius: 999, minHeight: 40,
    background: on ? 'rgba(94,201,204,.18)' : 'transparent',
    border: on ? `1px solid ${C.accent}` : C.line,
  })

  const go = async () => {
    if (!nodeId || busy) return
    setBusy(true)
    setError('')
    try {
      const r = await transport.start({ nodeId, harness, cwd, prompt })
      if (r.ok) onStarted(r.session)
      else setError(r.detail || 'The machine refused.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const label: React.CSSProperties = { margin: '0 0 6px', fontSize: 12, color: C.faint, textTransform: 'uppercase', letterSpacing: '.08em' }

  return (
    <>
      <BackBar onBack={onCancel} title="Start an agent" />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'grid', gap: 18, alignContent: 'start' }}>
        <section aria-label="Machine">
          <p style={label}>Machine</p>
          {machines.length === 0 && <Note>No machine can start one right now.</Note>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {machines.map((m) => (
              <button key={m.nodeId} type="button" aria-pressed={nodeId === m.nodeId} style={pill(nodeId === m.nodeId)} onClick={() => setNodeId(m.nodeId)}>
                {m.label}
              </button>
            ))}
          </div>
        </section>
        <section aria-label="Agent">
          <p style={label}>Agent</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {AGENT_HARNESSES.map((h) => (
              <button key={h.id} type="button" aria-pressed={harness === h.id} style={pill(harness === h.id)} onClick={() => setHarness(h.id)}>
                {h.label}
              </button>
            ))}
          </div>
        </section>
        <section style={{ display: 'grid', gap: 8 }}>
          <input
            aria-label="Folder"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="Folder (optional)"
            style={{ minHeight: 44, borderRadius: 12, border: C.line, background: 'transparent', color: C.ink, padding: '0 12px', fontSize: 16 }}
          />
          <textarea
            aria-label="First message"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should it do? (optional)"
            rows={3}
            style={{ borderRadius: 12, border: C.line, background: 'transparent', color: C.ink, padding: 12, fontSize: 16, resize: 'vertical' }}
          />
        </section>
        {AUTO_ACCEPT_HARNESSES.includes(harness) && <Note>It accepts file edits on its own; you can still stop it.</Note>}
        {error && <Note>{error}</Note>}
      </div>
      <footer style={{ borderTop: C.line, padding: 12 }}>
        <button type="button" style={{ ...PRIMARY, width: '100%', opacity: nodeId ? 1 : 0.5 }} disabled={!nodeId || busy} onClick={() => void go()}>
          {busy ? 'Starting…' : 'Start'}
        </button>
      </footer>
    </>
  )
}

export default AgentSessionsPanel
