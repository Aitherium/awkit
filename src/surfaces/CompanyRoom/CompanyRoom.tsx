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

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
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
}: CompanyRoomProps, ref) {
  const room = useRoom(apiBase)
  const [summoned, setSummoned] = useState<{ s: Summons; q: string } | null>(null)
  const [blockOpen, setBlockOpen] = useState(false)
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

  // Follow the conversation, but never yank the sheet away from someone reading
  // back through it.
  useEffect(() => {
    const el = sheetRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [room.messages])

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

  return (
    <div
      className="room"
      data-oswindow={osWindow ? 'true' : undefined}
      data-surface={wideSurface ? 'wide' : undefined}
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

      <div className="room-sheet" ref={sheetRef} onScroll={onScroll}>
        <div
          className="room-datum"
          data-ambient={room.ambient.enabled}
          data-listening={room.listening}
          aria-hidden="true"
        />

        {!room.loading && room.messages.length === 0 && (
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

        {room.messages.map((m, i) => {
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
            const onCite = (text: string) => room.say(text)

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

      <RoomComposer
        agents={room.agents.map((a) => a.nick)}
        busy={false}
        onSay={(text) => room.say(text)}
        onSummon={(s, q) => { setSummoned({ s, q }); setBlockOpen(true) }}
        hiddenSummons={[
          ...(onDeviceWorker ? [] : ['on-device'] as const),
          ...(enableHardware ? [] : ['hardware'] as const),
        ]}
      />
    </div>
  )
})

export default CompanyRoom
