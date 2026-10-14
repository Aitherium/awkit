'use client'

/**
 * The Company Room — the app's home surface.
 *
 * There is no navigation. You land in a live room holding the workspace's
 * people and the agents rostered to speak up on their own, and everything else
 * is summoned into the title block beside the conversation.
 *
 * The datum line down the sheet is the signature and it is functional: while
 * rostered agents are eligible to answer, a charge travels it at a rate bound
 * to the roster's cooldown, so the ambient machinery is something you watch
 * rather than something that surprises you.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import ContextSurface, { DEFAULT_ENDPOINTS, type ContextEndpoints } from './ContextSurface'
import RoomComposer from './RoomComposer'
import TitleBlock from './TitleBlock'
import { msgKey, useRoom, type RoomMessage } from './useRoom'
import { SUMMONS, type Summons, type SummonsId } from './summons'
import MailSurface from '../Mail/MailSurface'
import FleetSurface from '../Fleet/FleetSurface'
import NotesSurface from '../Notes/NotesSurface'
import PillarLanes from './PillarLanes'
import BeadSpacePanel from '../../panels/BeadSpacePanel'
import OnDevicePanel from '../../panels/OnDevicePanel'
import MyHardwarePanel from '../../panels/MyHardwarePanel'
import Tooltip from '../../ui/Tooltip'
import { useSpeechOutput } from '../../voice/useSpeechOutput'
import './room.css'

export interface CompanyRoomProps {
  /** Room + platform proxy base. */
  apiBase?: string
  /** True when rendered inside an OS window — fill the window (100%) not 100vh. */
  osWindow?: boolean
  /** Where each summons looks. Merged over the platform defaults. */
  endpoints?: ContextEndpoints
  /** Shown in the sheet caption. */
  appName?: string
  /**
   * Enables the `/local` summons: an on-device WebGPU model (Bonsai) beside
   * the conversation. The host app owns the factory because a Worker URL must
   * be resolved by ITS bundler. Absent → the summons is not offered at all.
   */
  onDeviceWorker?: () => Worker
  /** System prompt for the on-device model (defaults to a generic helper). */
  onDeviceSystem?: string
  /**
   * Host-side tools for the on-device model (e.g. a local KB search). The
   * model declares/calls them via the Bonsai tool contract; execution happens
   * in the page, results feed back into generation.
   */
  onDeviceTools?: import('../../webml').WebMLTools
  /**
   * Opts the host into the `/hardware` summons (MyHardwarePanel). Requires the
   * host's backend to serve GET/POST `/api/devices`. Absent → the summons is
   * not offered (same enabled-filter rule as on-device).
   */
  enableHardware?: boolean
  /**
   * Take the composer's SAY instead of posting it to the room.
   *
   * MEASURED 2026-09-13: `room.say` POSTs `{apiBase}/room/messages`, and on the
   * platform that route is a 501 stub -- `/room/stream` and `/room/agents` do not
   * exist and `state/route.ts` always answers `messages: []`. So the composer a GUEST
   * is shown has never worked: they type, an optimistic bubble appears, the POST 501s,
   * the bubble is marked failed. Real room chat is a Team-plan WebSocket.
   *
   * The 501 route is CORRECT and stays. What was wrong is showing a guest a composer
   * wired to it. A host that supplies `onSay` answers the guest itself -- in Veil, on
   * the Sprite lane through `useBrain()` -- and `room.say` is never called, so nothing
   * is posted to a door that would refuse it.
   *
   * Absent → unchanged: members post to the room exactly as before.
   */
  onSay?: (text: string) => void | Promise<void>
  /**
   * Messages the HOST is holding, shown after whatever the room returned.
   *
   * `useRoom`'s own `pending` list is reconciled against the next poll and a message
   * the server never echoes stays in it forever; these are explicitly the host's, are
   * never reconciled, and never travel anywhere.
   */
  localMessages?: RoomMessage[]
  /**
   * Hide the whole `/summons` catalogue.
   *
   * For a guest, every summons behind it (mail, fleet, notes, the fleet panels) is a
   * signed-in surface. Offering the menu and refusing each entry is a worse first
   * impression than a composer that only talks.
   */
  hideSummons?: boolean
  /** Replaces the blank-sheet copy with the assistant's greeting and openers. */
  greeting?: RoomGreeting
  /**
   * Files dropped anywhere on the room. The host owns the upload (it knows its
   * `drop_endpoint`). Absent → the room is not a drop target at all. A string it
   * resolves to ("Added resume.pdf.") is shown in the room as the outcome; while
   * it is pending the room says it is adding the files, and a rejection says the
   * files could not be added -- a refused upload is never silent.
   */
  onDropFiles?: (files: File[]) => void | string | Promise<void | string>
  /** Read agent replies aloud. Absent or `enabled: false` → silent. */
  voice?: RoomVoice
}

/** A suggested opener shown under the greeting; clicking it SAYs `prompt`. */
export interface RoomGreetingChip {
  label: string
  prompt: string
}

/**
 * What an empty room says first. Without it the blank sheet shows the generic
 * "Nothing said yet" copy -- which is what a tenant's home room showed while its
 * brain pack's `welcome_message` was served and read by nothing but ChatPanel
 * (tenant UX audit 2026-10-13).
 */
export interface RoomGreeting {
  /** The assistant's opening line, e.g. the brain pack's `welcome_message`. */
  message: string
  /** Who is speaking. Defaults to `appName`. */
  from?: string
  /** Suggested openers. The host decides how many (three is typical). */
  chips?: RoomGreetingChip[]
}

/**
 * Room replies read aloud -- the same knobs ChatPanel takes from the brain
 * pack's `voice` block (`enabled`, `auto_speak_responses`, `tts_voice`,
 * `default_tier`), so a tenant configures speech once.
 */
export interface RoomVoice {
  enabled: boolean
  /** Speak each new agent reply as it lands. Default true when enabled. */
  autoSpeak?: boolean
  tier?: 'browser' | 'server'
  ttsVoice?: string
}

/** Imperative handle — lets a host (e.g. the first-run tour) open a summons. */
export interface CompanyRoomHandle {
  summon: (id: SummonsId | string, q?: string) => void
}

type Voice = 'person' | 'agent' | 'system'

/** Agents speak under their nick; Relay marks system notices with `type`. */
function voiceOf(m: RoomMessage, agentNicks: Set<string>): Voice {
  if (m.type === 'system' || (m.nick || '').toLowerCase() === 'system') return 'system'
  const who = (m.nick || m.sender || '').toLowerCase()
  return agentNicks.has(who) ? 'agent' : 'person'
}

/**
 * Speaks agent replies that ARRIVE while it is mounted. The backlog present when
 * it mounts is marked heard without speaking: opening the room (or turning voice
 * on) must not read the last hour of conversation aloud.
 */
function RoomVoiceReader({ messages, loading, agentNicks, voice }: {
  messages: RoomMessage[]
  loading: boolean
  agentNicks: Set<string>
  voice: RoomVoice
}) {
  const speech = useSpeechOutput({ tier: voice.tier ?? 'browser', voice: voice.ttsVoice ?? '' })
  const heard = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (loading) return
    const keys = messages.map((m, i) => msgKey(m, i))
    const seen = heard.current
    heard.current = new Set(keys)
    if (seen === null) return
    const fresh = messages.filter((m, i) => !seen.has(keys[i]) && !m.optimistic && m.content
      && voiceOf(m, agentNicks) === 'agent')
    if (fresh.length === 0) return
    // ONE utterance per update: the browser tier cancels whatever is speaking
    // before each `speak`, so several calls in a row would leave only the last
    // reply audible when two agents answer in the same refresh.
    void speech.speak(fresh.map((m) => m.content).join('\n\n'))
      .catch(() => { /* no TTS on this device: stay silent */ })
    // `speech.speak` changes identity when the voice list loads; re-running on
    // that would find nothing fresh, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, loading, agentNicks])
  return null
}

/** Annotations carry a clock time, the way a drawing's notes carry a datum. */
function stationOf(m: RoomMessage): string {
  const raw = m.timestamp || m.created_at
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const CompanyRoom = forwardRef<CompanyRoomHandle, CompanyRoomProps>(function CompanyRoom({
  apiBase = '/api/platform',
  osWindow = false,
  endpoints,
  appName = 'Company Room',
  onDeviceWorker,
  onDeviceSystem,
  onDeviceTools,
  enableHardware = false,
  onSay,
  localMessages,
  hideSummons = false,
  greeting,
  onDropFiles,
  voice,
}: CompanyRoomProps, ref) {
  const room = useRoom(apiBase)
  const [summoned, setSummoned] = useState<{ s: Summons; q: string } | null>(null)
  const [blockOpen, setBlockOpen] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [dropStatus, setDropStatus] = useState<string | null>(null)
  // A SAY from anywhere in the room (composer, cite, greeting chip) goes one way:
  // `onSay ?? room.say` and NOT "call both" -- posting to the 501 route as well
  // would put a failed bubble beside every answer the host just produced.
  const say = (text: string) => { void (onSay ? onSay(text) : room.say(text)) }
  const sheetRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  // Programmatic summon — the first-run tour opens /space, /local, /hardware
  // so it can spotlight inside the panel it is teaching.
  useImperativeHandle(ref, () => ({
    summon: (id, q = '') => {
      const known = SUMMONS.find((s) => s.id === id)
      const s: Summons = known ?? {
        id: id as SummonsId,
        token: `/${id}`,
        label: String(id),
        hint: '',
        takesQuery: false,
      }
      setSummoned({ s, q })
      setBlockOpen(true)
    },
  }))

  const resolvedEndpoints = useMemo(
    () => ({ ...DEFAULT_ENDPOINTS, ...(endpoints || {}) }),
    [endpoints],
  )

  const agentNicks = useMemo(
    () => new Set(room.agents.map((a) => a.nick.toLowerCase())),
    [room.agents],
  )

  // Spoken replies live in <RoomVoiceReader>, mounted only while speech is on:
  // the speech hook cancels window.speechSynthesis on unmount, so mounting it in
  // every room (voice off included) cut off other speech on the page -- a chat
  // panel's TTS -- whenever the room window closed.
  const speakOn = Boolean(voice?.enabled && voice.autoSpeak !== false)

  // What the sheet actually renders: the room's own messages, then the host's.
  // ONE list, derived once -- the blank-state check and the map below read the same
  // thing, and a guest whose only messages are local must not still be told "nothing
  // said yet" underneath their own conversation.
  const shownMessages = useMemo(
    () => (localMessages && localMessages.length
      ? [...room.messages, ...localMessages]
      : room.messages),
    [room.messages, localMessages],
  )

  // Follow the conversation, but never yank the sheet away from someone reading
  // back through it.
  useEffect(() => {
    const el = sheetRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [shownMessages])

  const onScroll = () => {
    const el = sheetRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  // The charge travels slower when agents must wait longer between turns.
  const chargeDuration = `${Math.max(4, (room.ambient.cooldown_seconds ?? 8) * 1.1)}s`

  // Block width the visitor last dragged to. Read defensively: localStorage throws
  // in private mode, and a hand-edited value must not produce `--room-block-w: NaNpx`
  // (which would make the whole grid-template declaration invalid).
  let storedBlockWidth = ''
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('aither_room_block_w') : null
    const n = raw ? parseInt(raw, 10) : NaN
    if (Number.isFinite(n) && n > 0) storedBlockWidth = `${n}px`
  } catch {
    storedBlockWidth = ''
  }

  // Summonses that bring back a WORKING SURFACE rather than a list. These need
  // room to be usable at all — the hardware panel's install commands, the model
  // picker, the space, the lanes — so the title block widens while one is open
  // and returns to the visitor's own width when it closes. A list-style surface
  // (find/docs/people) reads fine in the rail and is deliberately not here.
  const WIDE_SURFACES = new Set<string>(['hardware', 'on-device', 'bead-space', 'pillars', 'fleet'])
  const wideSurface = Boolean(summoned && blockOpen && WIDE_SURFACES.has(summoned.s.id))

  // A drop target only when the host takes the files. `types` carries 'Files' for
  // an OS file drag and not for a dragged text selection, which must stay inert.
  const isFileDrag = (e: ReactDragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files')
  const dropHandlers = onDropFiles ? {
    onDragOver: (e: ReactDragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      if (!dropping) setDropping(true)
    },
    onDragLeave: (e: ReactDragEvent) => {
      // Moving onto a child is not leaving the room.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setDropping(false)
    },
    onDrop: (e: ReactDragEvent) => {
      setDropping(false)
      const files = Array.from(e.dataTransfer?.files || [])
      if (files.length === 0) return
      e.preventDefault()
      setDropStatus(files.length === 1 ? `Adding ${files[0].name}…` : `Adding ${files.length} files…`)
      let pending: Promise<void | string>
      try {
        pending = Promise.resolve(onDropFiles(files))
      } catch (err) {
        pending = Promise.reject(err)
      }
      pending
        .then(
          (outcome) => setDropStatus(typeof outcome === 'string' && outcome ? outcome : null),
          () => setDropStatus(files.length === 1
            ? `Could not add ${files[0].name}.`
            : `Could not add those ${files.length} files.`),
        )
    },
  } : {}

  return (
    <div
      className="room"
      data-oswindow={osWindow ? 'true' : undefined}
      data-surface={wideSurface ? 'wide' : undefined}
      data-dropping={dropping ? 'true' : undefined}
      {...dropHandlers}
      style={{
        ['--charge-duration' as string]: chargeDuration,
        // Restore the visitor's dragged block width (TitleBlock's BlockGrip writes
        // it). Read at render rather than in an effect so the block does not paint
        // at the default width and then jump. A bad/absent value simply falls
        // through to room.css's default.
        ...(storedBlockWidth ? { ['--room-block-w' as string]: storedBlockWidth } : {}),
      }}
    >
      <header className="room-header">
        <span className="room-title">{appName}</span>
        {room.channel && <span className="room-channel">{room.channel}</span>}
        <Tooltip label={room.unauthenticated
          ? 'The room is private to this workspace. Sign in to join it.'
          : "The room's connection. Live — connected, agents may answer on their own. Listening — the room is open. Reconnecting — the link dropped and is coming back."}>
          {/* `unauthenticated` is checked FIRST and is not `degraded`. A visitor
              with no session is not a dropped link, and telling them
              "Reconnecting" is a promise that can never resolve — measured
              2026-08-19 on a customer's live portal, where an anonymous visitor
              watched a red RECONNECTING forever while the backend was healthy. */}
          <span
            className="room-state"
            data-degraded={room.degraded}
            data-signedout={room.unauthenticated}
            data-tour="room-state"
          >
            <span className="room-state-dot" aria-hidden="true" />
            {room.unauthenticated
              ? 'Sign in to join'
              : room.degraded ? 'Reconnecting' : room.listening ? 'Listening' : 'Live'}
          </span>
        </Tooltip>
      </header>

      {dropStatus && (
        // What happened to the files dropped on the room: in progress, added, or
        // refused. Click to dismiss; the next drop replaces it.
        <p className="room-drop-status" role="status" onClick={() => setDropStatus(null)}>
          {dropStatus}
        </p>
      )}

      <div className="room-sheet" ref={sheetRef} onScroll={onScroll}>
        <div
          className="room-datum"
          data-ambient={room.ambient.enabled}
          data-listening={room.listening}
          aria-hidden="true"
        />

        {!room.loading && shownMessages.length === 0 && greeting && (
          <div className="room-blank" data-greeting="true">
            <div />
            <div className="room-blank-body">
              <p className="room-blank-eyebrow">{greeting.from || appName}</p>
              <p className="room-blank-lede">
                {greeting.message.trim() || 'This is where your team and its agents work in the open.'}
              </p>
              {greeting.chips && greeting.chips.length > 0 && (
                <div className="room-greeting-chips">
                  {greeting.chips.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      className="room-greeting-chip"
                      onClick={() => say(c.prompt)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
              {onDropFiles && (
                <p className="room-blank-sub">
                  Drop a file anywhere on the room to add it to the knowledge base.
                </p>
              )}
            </div>
          </div>
        )}

        {!room.loading && shownMessages.length === 0 && !greeting && (
          <div className="room-blank">
            <div />
            <div className="room-blank-body">
              <p className="room-blank-eyebrow">Nothing said yet</p>
              <p className="room-blank-lede">
                This is where your team and its agents work in the open.
              </p>
              <p className="room-blank-sub">
                Say something and the room starts keeping it. Type <code>@</code> to bring an agent
                in, or <code>/</code> to pull up documents, data, mail, or the fleet without
                leaving.
              </p>
            </div>
          </div>
        )}

        {shownMessages.map((m, i) => {
          const voice = voiceOf(m, agentNicks)
          return (
            <article
              key={msgKey(m, i)}
              className="room-entry"
              data-voice={voice}
              data-pending={m.optimistic && !m.failed}
              data-failed={m.failed}
            >
              <span className="room-tick" aria-hidden="true" />
              <div className="room-gutter">
                <span className="room-who">{m.nick || m.sender || 'unknown'}</span>
                <span className="room-station">{stationOf(m)}</span>
              </div>
              <div className="room-said">
                {m.content}
                {m.failed && ' — did not send'}
              </div>
            </article>
          )
        })}
      </div>

      <TitleBlock
        people={room.people}
        agents={room.agents}
        ambient={room.ambient}
        onDismissAgent={room.dismissAgent}
        open={blockOpen && Boolean(summoned)}
      >
        {summoned && (
          <div className="room-summoned">{(() => {
            const onClose = () => { setSummoned(null); setBlockOpen(false) }
            // A cite is a SAY: when the host took the composer (`onSay`), a cite from a
            // summons panel must go the same way, not to the `room.say` door it replaced.
            const onCite = (text: string) => { void (onSay ? onSay(text) : room.say(text)) }

            switch (summoned.s.id) {
              case 'mail':
                return <MailSurface onClose={onClose} onCite={onCite} />
              case 'fleet':
                return <FleetSurface onClose={onClose} />
              case 'notes':
                return <NotesSurface onClose={onClose} onCite={onCite} />
              case 'bead-space':
                // Without this case '/space' fell through to ContextSurface, which would try
                // endpoints['bead-space'] — never defined — and render "not connected yet".
                return (
                  <div style={{ height: '60vh', minHeight: 380 }}>
                    <BeadSpacePanel />
                  </div>
                )
              case 'on-device':
                // Only reachable when the host app registered a worker factory
                // (the composer hides the summons otherwise) — but a stale
                // palette or direct parse must still degrade honestly.
                return onDeviceWorker ? (
                  <div style={{ maxHeight: '65vh', overflowY: 'auto' }}>
                    <OnDevicePanel
                      workerFactory={onDeviceWorker}
                      system={onDeviceSystem}
                      tools={onDeviceTools}
                      appName={appName}
                    />
                  </div>
                ) : (
                  <div style={{ padding: 16, fontSize: 13, opacity: 0.75 }}>
                    {appName} has not enabled on-device chat.
                  </div>
                )
              case 'hardware':
                // Same gate as on-device: only offered when the host opted in,
                // but a direct parse must still degrade honestly.
                return enableHardware ? (
                  <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    <MyHardwarePanel
                      productName={appName}
                      onShowUniverse={() => {
                        const space = SUMMONS.find((x) => x.id === 'bead-space')
                        if (!space) return
                        setSummoned({ s: space, q: '' })
                        setBlockOpen(true)
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ padding: 16, fontSize: 13, opacity: 0.75 }}>
                    {appName} has not enabled self-service hardware.
                  </div>
                )
              case 'pillars':
                return (
                  <div style={{ height: '65vh', display: 'flex', flexDirection: 'column' }}>
                    <PillarLanes />
                  </div>
                )
              default:
                return (
                  <ContextSurface
                    id={summoned.s.id}
                    title={summoned.s.label}
                    query={summoned.q}
                    endpoints={resolvedEndpoints}
                    onClose={onClose}
                    onCite={onCite}
                  />
                )
            }
          })()}</div>
        )}
      </TitleBlock>

      {speakOn && voice && (
        <RoomVoiceReader messages={room.messages} loading={room.loading} agentNicks={agentNicks} voice={voice} />
      )}

      <RoomComposer
        agents={room.agents.map((a) => a.nick)}
        busy={false}
        onSay={say}
        onSummon={(s, q) => { setSummoned({ s, q }); setBlockOpen(true) }}
        hiddenSummons={hideSummons
          ? SUMMONS.map((s) => s.id)
          : [
            ...(onDeviceWorker ? [] : ['on-device'] as const),
            ...(enableHardware ? [] : ['hardware'] as const),
          ]}
      />
    </div>
  )
})

export default CompanyRoom
