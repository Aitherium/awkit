/**
 * StreamTugOfWarPanel — the control room for a live donation tug-of-war.
 *
 * A stream graphic has TWO surfaces and conflating them is the usual mistake:
 * the OVERLAY (a transparent page OBS loads as a browser source, which must
 * survive with no operator present) and the CONTROL (what a human drives during
 * the show). This panel is the control; `stream-overlay/overlay-html.ts` is the
 * overlay. That split is why nodecg exists — dashboard plus graphic — and it is
 * kept here so this can be wrapped as a nodecg bundle later without rewriting
 * the graphic.
 *
 * THE MECHANIC (confirmed with the show, 2026-08-28): the host sets an initial
 * KICK goal. Donations carrying the kick keyword fill the POT toward that goal;
 * donations carrying the keep keyword RAISE the goal — keepers are goalkeepers,
 * and the two forces tug. When the pot meets the goal the guest is kicked —
 * never before their guaranteed minimum airtime (default 2 minutes); if the
 * goal is met during the guarantee the kick is PENDING and the timer counts it
 * down, with keep donations still able to save the guest. Kicks are favoured on
 * purpose, but the KICKED message HOLDS until the operator presses play: the
 * next contestant sits down first, and their clock starts when they are ready
 * (donations that arrive during the pause are buffered onto the next guest).
 * That is how the show cycles people through without ever starting a guest who
 * is not seated.
 *
 * THE PANEL IS THE MANAGEMENT SURFACE, not a mock. It shows the overlay's LIVE
 * state (pot/goal/guest/kicked/timer, polled from the overlay itself once a
 * second — the same numbers OBS is showing), drives every operator control the
 * show needs (new guest, reset board, restart timer, set goal, manual
 * donations, demo feed), and hands over the exact OBS browser-source URL. The
 * overlay URL is DERIVED from this workspace's own origin (the overlay ships in
 * the same static export as the workspace, at /tugofwar/overlay.html) unless an
 * explicit `overlayUrl` prop is supplied — deriving beats inventing, and a
 * tenant workspace served from that export gets the real URL for free.
 *
 * Config persists in localStorage under `tugofwar.cfg`, so the operator's
 * segment settings (goal, guarantee, keywords, pop threshold) survive reloads —
 * re-typing $100/120s before every segment is how operators end up running
 * defaults they never chose.
 *
 * No donation platform is wired here on purpose. The overlay accepts events
 * from postMessage, a WebSocket or a polled endpoint, so the integration is a
 * URL the operator supplies rather than a provider this panel has to know
 * about — and `?demo=1` lets the whole thing be shown to a room with nothing
 * connected at all.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { TUGOFWAR_OVERLAY_HTML } from './stream-overlay/overlay-html'

export interface StreamTugOfWarPanelProps {
  /**
   * Where the overlay is served for OBS. When omitted the panel derives it from
   * this workspace's own origin (`<origin>/tugofwar/overlay.html`), which is
   * where the overlay is emitted for every entitled tenant. An explicit prop
   * always wins.
   */
  overlayUrl?: string
}

interface Config {
  left: string
  right: string
  baseGoalCents: number
  guaranteeSeconds: number
  bigDonationCents: number
}

const DEFAULTS: Config = {
  left: 'kick',
  right: 'keep',
  baseGoalCents: 10000,
  guaranteeSeconds: 120,
  bigDonationCents: 2500,
}

const CFG_STORAGE_KEY = 'tugofwar.cfg'

/** The overlay's live state, as replied to a `snapshot` postMessage. */
interface Snapshot {
  pot: number
  goal: number
  guest: number
  kicked: number
  kickPending: number | null
  /** True while the KICKED splash is holding between guests: the board is
   * frozen and the next guest's clock has not started. The panel shows the
   * play button off this flag. */
  held: boolean
  guestStart: number
  now: number
}

const money = (cents: number) =>
  '$' + (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })

const mmss = (sec: number) =>
  String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0')

export default function StreamTugOfWarPanel({ overlayUrl }: StreamTugOfWarPanelProps) {
  const [cfg, setCfg] = useState<Config>(() => {
    try {
      const saved = typeof localStorage !== 'undefined'
        ? JSON.parse(localStorage.getItem(CFG_STORAGE_KEY) || 'null')
        : null
      if (saved && typeof saved === 'object') return { ...DEFAULTS, ...saved }
    } catch { /* corrupt saved config -> defaults */ }
    return DEFAULTS
  })
  const [demo, setDemo] = useState(false)
  const [copied, setCopied] = useState(false)
  const [live, setLive] = useState<Snapshot | null>(null)
  const frame = useRef<HTMLIFrameElement | null>(null)

  // Manual entry, for the case every stream eventually hits: a donation the
  // feed missed, or one whose keyword the donor typed in a way the parser
  // cannot see. An operator needs a way to put it on the board.
  const [manualAmount, setManualAmount] = useState('')
  const [manualSide, setManualSide] = useState<'left' | 'right'>('left')

  // The host's own lever: set the goal outright (a bigger target for drama,
  // without faking a donation). Sent as a postMessage event, same as everything
  // else that reaches the overlay.
  const [goalOverride, setGoalOverride] = useState('')

  // Segment settings are the operator's working state -- persist them so a
  // reload (or a show next week) does not start from defaults they never chose.
  useEffect(() => {
    try { localStorage.setItem(CFG_STORAGE_KEY, JSON.stringify(cfg)) } catch { /* private mode */ }
  }, [cfg])

  /** The query string the overlay reads. Single source for OBS and preview. */
  const params = useMemo(() => {
    const p = new URLSearchParams({
      left: cfg.left,
      right: cfg.right,
      goal: String(cfg.baseGoalCents),
      guarantee: String(cfg.guaranteeSeconds),
      big: String(cfg.bigDonationCents),
    })
    if (demo) p.set('demo', '1')
    return p.toString()
  }, [cfg, demo])

  // Remounting on config change is deliberate: the overlay reads its config
  // once at startup, exactly as it will in OBS. Mutating a running preview
  // would show the operator a state OBS can never reproduce.
  const srcDoc = useMemo(() => {
    const withQuery = TUGOFWAR_OVERLAY_HTML.replace(
      '<script>',
      `<script>history.replaceState(null,'','?${params}');</script><script>`,
    )
    return withQuery
  }, [params])

  const post = useCallback((msg: unknown) => {
    frame.current?.contentWindow?.postMessage(msg, '*')
  }, [])

  // Poll the overlay for its live state once a second. The panel is the
  // management surface: the numbers here and the numbers OBS is showing are
  // the same numbers, because both come from the overlay.
  useEffect(() => {
    const iv = setInterval(() => post({ type: 'snapshot' }), 1000)
    return () => clearInterval(iv)
  }, [post])

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; payload?: Snapshot } | null
      if (d && d.type === 'snapshot' && d.payload) setLive(d.payload)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const timerInfo = useMemo(() => {
    if (!live) return null
    if (live.held) {
      // Between guests: nothing is counting. The next contestant's clock
      // starts when the operator presses play.
      return { label: 'NEXT GUEST', left: 0, danger: true }
    }
    if (live.kickPending) {
      const left = Math.max(0, Math.ceil((live.kickPending - live.now) / 1000))
      return { label: 'KICK', left, danger: true }
    }
    const end = live.guestStart + cfg.guaranteeSeconds * 1000
    if (live.now < end) {
      const left = Math.max(0, Math.ceil((end - live.now) / 1000))
      return { label: 'WINDOW', left, danger: end - live.now <= 30000 }
    }
    return { label: 'ON AIR', left: Math.floor((live.now - live.guestStart) / 1000), danger: false }
  }, [live, cfg.guaranteeSeconds])

  const addManual = useCallback(() => {
    const dollars = Number.parseFloat(manualAmount)
    if (!Number.isFinite(dollars) || dollars <= 0) return
    post({
      type: 'donation',
      payload: {
        id: `manual-${Date.now()}`,
        amount_cents: Math.round(dollars * 100),
        // Send the configured keyword rather than the side name, so the manual
        // path goes through the SAME parser as a real donation. A second route
        // into the score is a second thing that can disagree with air.
        message: manualSide === 'left' ? cfg.left : cfg.right,
      },
    })
    setManualAmount('')
  }, [manualAmount, manualSide, cfg, post])

  const setGoal = useCallback(() => {
    const dollars = Number.parseFloat(goalOverride)
    if (!Number.isFinite(dollars) || dollars <= 0) return
    post({ type: 'setgoal', goal_cents: Math.round(dollars * 100) })
    setGoalOverride('')
  }, [goalOverride, post])

  // The overlay's serving convention: it ships inside the SAME static export
  // as this workspace, at /tugofwar/overlay.html. Deriving from the workspace's
  // own origin is the truth for every entitled tenant; an explicit prop wins.
  const derivedUrl = typeof location !== 'undefined'
    ? `${location.origin}/tugofwar/overlay.html`
    : ''
  const baseUrl = overlayUrl || derivedUrl
  const obsUrl = baseUrl ? `${baseUrl}?${params}` : ''

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      <div>
        <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>Tug of War</h2>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.7, maxWidth: '72ch' }}>
          <strong>{cfg.left}</strong> donations fill the pot toward the goal;{' '}
          <strong>{cfg.right}</strong> donations raise the goal — the goalkeepers push the
          line back. When the pot meets the goal the guest is kicked (never before their
          guaranteed airtime; keep can still save them during the countdown). The KICKED
          message then holds until you press play — the next contestant sits down first,
          and their clock starts when you start them; donations during the pause count on
          the next guest. Donations with neither keyword, or with both, are counted as
          donations but not as votes.
        </p>
      </div>

      {/* Live preview — the same page OBS loads. */}
      <iframe
        key={params}
        ref={frame}
        title="Overlay preview"
        srcDoc={srcDoc}
        style={{
          width: '100%', height: 190, border: '1px solid rgba(128,128,128,.3)',
          borderRadius: 8, background: '#1b1b1f',
        }}
      />

      {/* Live state — the same numbers OBS is showing, straight from the overlay. */}
      {live && (
        <div style={{
          display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center',
          fontSize: 13, background: 'rgba(128,128,128,.12)', borderRadius: 8, padding: '8px 12px',
        }}>
          <span>POT <strong style={{ color: '#FF2537' }}>{money(live.pot)}</strong></span>
          <span>GOAL <strong style={{ color: '#3D6DFF' }}>{money(live.goal)}</strong></span>
          {timerInfo && (
            <span>
              TIMER{' '}
              <strong style={timerInfo.danger ? { color: '#FF2537' } : undefined}>
                {timerInfo.label} {mmss(timerInfo.left)}
              </strong>
            </span>
          )}
          <span>GUEST <strong>{live.guest}</strong></span>
          <span>KICKED <strong>{live.kicked}</strong></span>
        </div>
      )}

      {/* The play control: appears only while the overlay holds a KICKED
          splash. This is the button the show waits on — the next contestant
          sits down, the operator presses it, and their clock starts. */}
      {live?.held && (
        <button
          onClick={() => post({ type: 'play' })}
          title="The next contestant is seated — clear the KICKED message and start their clock"
          style={{
            width: '100%', padding: '12px 16px', fontSize: 16, fontWeight: 800,
            background: '#fff', color: '#000', border: '1px solid #fff',
            borderRadius: 8, cursor: 'pointer',
          }}
        >
          ▶ NEXT GUEST READY — START THEM
        </button>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => post({ type: 'reset' })} title="Next guest on — pot and goal reset, guest counter advances">New guest</button>
        <button onClick={() => post({ type: 'clear' })} title="Fresh pot and goal for the SAME guest (clear totals)">Reset board</button>
        <button onClick={() => post({ type: 'window' })} title="Restart the guaranteed airtime for the current guest">Restart timer</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          Set goal $
          <input
            value={goalOverride}
            onChange={(e) => setGoalOverride(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setGoal() }}
            placeholder="100"
            inputMode="decimal"
            style={{ width: 64 }}
          />
          <button onClick={setGoal}>Set</button>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
          Demo feed
        </label>
      </div>

      {/* Manual entry */}
      <fieldset style={{ border: '1px solid rgba(128,128,128,.3)', borderRadius: 8, padding: 12 }}>
        <legend style={{ fontSize: 12, opacity: 0.7 }}>Add a donation by hand</legend>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={manualAmount}
            onChange={(e) => setManualAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addManual() }}
            placeholder="25.00"
            inputMode="decimal"
            style={{ width: 96 }}
          />
          <select value={manualSide} onChange={(e) => setManualSide(e.target.value as 'left' | 'right')}>
            <option value="left">{cfg.left} (fills the pot)</option>
            <option value="right">{cfg.right} (raises the goal)</option>
          </select>
          <button onClick={addManual}>Add</button>
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            pops on screen at {money(cfg.bigDonationCents)} and above
          </span>
        </div>
      </fieldset>

      {/* Configuration */}
      <fieldset style={{ border: '1px solid rgba(128,128,128,.3)', borderRadius: 8, padding: 12 }}>
        <legend style={{ fontSize: 12, opacity: 0.7 }}>Segment settings</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={{ fontSize: 13 }}>
            Kick keyword
            <input
              value={cfg.left}
              onChange={(e) => setCfg({ ...cfg, left: e.target.value.trim().toLowerCase() })}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Keep keyword
            <input
              value={cfg.right}
              onChange={(e) => setCfg({ ...cfg, right: e.target.value.trim().toLowerCase() })}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Kick goal (dollars)
            <input
              type="number" min={1}
              value={Math.round(cfg.baseGoalCents / 100)}
              onChange={(e) => setCfg({ ...cfg, baseGoalCents: Math.max(1, Number(e.target.value) || 1) * 100 })}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Guaranteed airtime (seconds)
            <input
              type="number" min={10}
              value={cfg.guaranteeSeconds}
              onChange={(e) => setCfg({ ...cfg, guaranteeSeconds: Math.max(10, Number(e.target.value) || 10) })}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Pop threshold (dollars)
            <input
              type="number" min={1}
              value={Math.round(cfg.bigDonationCents / 100)}
              onChange={(e) => setCfg({ ...cfg, bigDonationCents: Math.max(1, Number(e.target.value) || 1) * 100 })}
              style={{ width: '100%' }}
            />
          </label>
        </div>
      </fieldset>

      {/* OBS wiring */}
      <fieldset style={{ border: '1px solid rgba(128,128,128,.3)', borderRadius: 8, padding: 12 }}>
        <legend style={{ fontSize: 12, opacity: 0.7 }}>OBS browser source</legend>
        {obsUrl ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{
              flex: 1, fontSize: 12, padding: '6px 8px', borderRadius: 6,
              background: 'rgba(128,128,128,.15)', overflowX: 'auto', whiteSpace: 'nowrap',
            }}>{obsUrl}</code>
            <button onClick={() => {
              navigator.clipboard?.writeText(obsUrl).then(() => setCopied(true)).catch(() => {})
            }}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
            No overlay URL — this panel is not running on a host that serves the overlay.
            Pass <code>overlayUrl</code> to this panel once the page is served.
          </p>
        )}
        <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.6 }}>
          Set the source to 1920×1080 with a transparent background. The overlay also accepts{' '}
          <code>&amp;ws=</code> or <code>&amp;poll=</code> to read a live donation feed.
          {!overlayUrl && derivedUrl && (
            <> URL derived from this workspace's origin — pass <code>overlayUrl</code> to override.</>
          )}
        </p>
      </fieldset>
    </div>
  )
}
