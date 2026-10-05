/**
 * FamilyTutorConsolePanel: the guardian's side of Aither Learn (family tutor).
 *
 * Backed by Genesis /api/v1/tutor/family/* through the host app's proxy (apiBase).
 * The server enforces that only the guardian of record can see or steer a learner
 * (anyone else gets 404), so this panel holds no authorization logic of its own.
 *
 * The screen: the family at a glance (one tile per child: Sprite, level, this
 * week's real minutes), ONE primary action per child ("Connect a phone", a sheet
 * with a large QR and the real expiry counting down), "Add a child" as a guided
 * three-step sheet, every other tool a quiet link that opens a sheet, and the
 * legacy paths (terminal, pair code) collapsed under Advanced.
 *
 * - Enroll needs BOTH consent boxes; the pair code is shown once, then dismissed.
 * - Reports are worded as observations, never as diagnoses or grades.
 * - The transcript is read-only: there is no delete control, by design.
 * - "Add child" creates the child's OWN account (no password anyone types) and a
 *   learner already bound to it; "Connect a phone" then shows a one-time QR/link
 *   (single use, ~15 min). The link lives only in component state, never storage.
 * - A failed load is retried once after 3 s, then shown as offline with "Try again".
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import AcademyMirrorCard from './AcademyMirrorCard'
import FamilySpaceCard from './FamilySpaceCard'
import FamilyMessagesSection from './FamilyMessagesSection'
import TutorFocusCard from './TutorFocusCard'
import TutorLevelCard from './TutorLevelCard'
import TutorProgressCard from './TutorProgressCard'
import LearnerGuardCard from './LearnerGuardCard'
import LearnVoiceCard from './LearnVoiceCard'
import CoGuardiansCard from './CoGuardiansCard'
import { LearnerSpriteButton, SpriteOfferCard, spriteEmoji, type KidSprite } from './LearnerSprite'
import { C, EASE, FONT_MONO, FONT_UI, LEARN_CSS, LearnModeSwitch, learnVars, useLearnMode } from './learnTheme'
import { CheckRow, Field, SelectBox, Sheet, SheetHeading, Skel, fieldBox, help, mono, primary, quiet } from './learnParts'

export interface FamilyTutorConsolePanelProps {
  /** Base of the tutor proxy, e.g. '/api/tutor'. */
  apiBase: string
  /** Headers the host app adds (its bearer). */
  extraHeaders?: Record<string, string>
}

interface LearnerSettings {
  quest_minutes?: number
  daily_cap_minutes?: number
  focus?: 'math' | 'reading' | 'mixed'
  theme?: string
  ask_enabled?: boolean
}

interface Learner {
  lid: string
  alias: string
  grade: number
  age_band: string
  claimed: boolean
  user_id?: string | null
  display_name?: string
  settings?: LearnerSettings
  sprite?: KidSprite | null
  /** 'co' when another guardian shared this child with the caller. */
  guardian_role?: 'primary' | 'co'
}

/** One-time phone link from Genesis (connect object of the family contract). */
interface ConnectLink {
  url: string
  expires_at?: string | number
  expires_in?: number
  qr_svg_data_uri?: string | null
}

interface ConnectState { lid: string; name: string; link: ConnectLink }

const GRADES: Array<[number, string]> = [
  [0, 'Kindergarten'], [1, '1st grade'], [2, '2nd grade'], [3, '3rd grade'],
  [4, '4th grade'], [5, '5th grade'], [6, '6th grade'],
]

function gradeWord(g: number): string {
  return g === 0 ? 'kindergarten' : `grade ${g}`
}

function firstName(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || ''
}

function possessive(name: string): string {
  const n = firstName(name)
  return n ? `${n}'s` : 'their'
}

function expiryMs(link: ConnectLink, issuedAt: number): number {
  const v = link.expires_at
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (!Number.isNaN(n)) return n < 1e12 ? n * 1000 : n
    const d = Date.parse(v)
    if (!Number.isNaN(d)) return d
  }
  return issuedAt + (link.expires_in ?? 900) * 1000
}

/** Text on the QR field (black in both modes): the paper colour, dimmed. */
const onQr = (alpha: number): CSSProperties => ({ color: C.qrPaper, opacity: alpha })

/** The QR, the real countdown and the fallback link. Lives in a sheet. */
function ConnectBody({ state, onRenew, onClose }: {
  state: ConnectState
  onRenew: () => void
  onClose: () => void
}) {
  const [issuedAt] = useState(() => Date.now())
  const deadline = expiryMs(state.link, issuedAt)
  const [now, setNow] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const left = Math.max(0, Math.floor((deadline - now) / 1000))
  const expired = left <= 0
  const mm = Math.floor(left / 60)
  const ss = String(left % 60).padStart(2, '0')
  const who = possessive(state.name).toLowerCase()
  const first = firstName(state.name) || 'your child'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.link.url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div data-testid="connect-phone-card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <SheetHeading label={`connect · ${first.toLowerCase()}`} title={`Connect ${possessive(state.name)} phone`} />
      <div style={{
        background: C.qrField, borderRadius: 16, padding: 'clamp(20px, 6vw, 36px)', display: 'flex',
        flexDirection: 'column', alignItems: 'center', gap: 16, border: `1px solid ${C.hairline}`,
      }}>
        {expired ? (
          <div data-testid="connect-expired" style={{ minHeight: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center' }}>
            <span style={{ ...mono, ...onQr(0.55) }}>expired</span>
            <span style={{ font: `300 22px/1.3 ${FONT_UI}`, letterSpacing: '-0.02em', ...onQr(0.92) }}>This code has run out</span>
          </div>
        ) : state.link.qr_svg_data_uri ? (
          <img src={state.link.qr_svg_data_uri} alt={`QR code that signs ${first} in on their phone`}
            className="al-in"
            style={{ display: 'block', width: 'min(280px, 64vw)', height: 'auto', aspectRatio: '1 / 1', background: C.qrPaper, padding: 12, borderRadius: 14, boxSizing: 'border-box' }} />
        ) : (
          <span style={{ ...mono, ...onQr(0.55), padding: '40px 0' }}>no qr · use the link below</span>
        )}
        {!expired && (
          <div data-testid="connect-countdown" style={{ ...mono, ...onQr(0.72), fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
            scan with {who} phone · {mm}:{ss}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button type="button" onClick={onRenew} className="al-quiet al-focus" style={{ ...quiet, color: C.accent }}>New code</button>
        {!expired && (
          <span style={help}>Works once, for {Math.max(1, Math.round((deadline - issuedAt) / 60000))} minutes.</span>
        )}
      </div>

      <ol style={{ margin: 0, paddingLeft: 20, color: C.dim, font: `400 15px/1.6 ${FONT_UI}` }}>
        <li>On {possessive(state.name)} phone, open the camera.</li>
        <li>Point it at the code and tap the link.</li>
        <li>Tap Continue. That&apos;s it.</li>
      </ol>

      {!expired && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${C.hairline}`, paddingTop: 14 }}>
          <span style={mono}>or send this link to their phone</span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <code data-testid="connect-url" style={{ flex: '1 1 220px', minWidth: 0, wordBreak: 'break-all', font: `400 12px/1.5 ${FONT_MONO}`, color: C.dim }}>
              {state.link.url}
            </code>
            <button type="button" onClick={copy} className="al-quiet al-focus" style={quiet}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      )}

      <div>
        <button type="button" onClick={onClose} className="al-quiet al-focus" style={quiet}>Done</button>
      </div>
    </div>
  )
}

interface SkillView { state?: string; kid_title?: string; score?: number }

interface Report {
  minutes?: number
  sessions?: number
  attempts?: number
  skills?: Record<string, SkillView>
  edge?: string[]
  at_risk_reviews?: string[]
  breaks_used?: number
  observations?: string[]
  notes?: string[]
}

interface TranscriptEvent {
  ts?: string | number
  kind?: string
  say?: string
  text?: string
  message?: string
  [k: string]: unknown
}

interface PairCode { alias: string; pair_code: string; expires_at?: string | number }

type View = { kind: 'none' } | { kind: 'report'; lid: string } | { kind: 'transcript'; lid: string }
  | { kind: 'settings'; lid: string } | { kind: 'assign'; lid: string } | { kind: 'messages'; lid: string }
  | { kind: 'focus'; lid: string } | { kind: 'progress'; lid: string } | { kind: 'level'; lid: string }

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden'
type Glance = Report | 'offline'

const STATE_WORDS: Record<string, string> = {
  locked: 'Not started yet',
  learning: 'Practising',
  secure: 'Comfortable',
  review_due: 'Ready for a quick review',
  fluent: 'Quick and easy now',
}

/** Pixel Linux terminal (Debian arm64 VM). The distribution is `awdk`; its console script is
 *  `adk`, `adk login` with no flags runs the device flow, and `adk learn play` runs one quest
 *  in text (awdk/adk/learn_cli.py). Every base dependency ships an aarch64 wheel and none is a
 *  GPU stack (awdk/tests/test_learn_cli.py pins the no-torch import path). */
const TERMINAL_STEPS = [
  'sudo apt update && sudo apt install -y python3-venv',
  'python3 -m venv ~/aw',
  '~/aw/bin/pip install awdk',
  '~/aw/bin/adk login',
  '~/aw/bin/adk learn play',
].join('\n')

const S: Record<string, CSSProperties> = {
  root: {
    fontFamily: FONT_UI, color: C.ink, background: C.ground, minHeight: '100%', fontSize: 15, lineHeight: 1.5,
    boxSizing: 'border-box', padding: 'clamp(20px, 4vw, 44px) clamp(16px, 4vw, 40px) 64px',
    transition: `background-color .3s ${EASE}, color .3s ${EASE}`,
  },
  column: { maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 },
  tile: {
    background: C.surface, border: `1px solid ${C.hairline}`, borderRadius: 16, padding: 20,
    display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0,
  },
  section: { background: C.surface, border: `1px solid ${C.hairline}`, borderRadius: 16, padding: 20 },
  h3: { margin: 0, font: `400 20px/1.2 ${FONT_UI}`, letterSpacing: '-0.02em', color: C.ink },
  stat: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  statNum: { font: `300 28px/1 ${FONT_UI}`, letterSpacing: '-0.02em', color: C.ink, fontVariantNumeric: 'tabular-nums' },
  links: { display: 'flex', flexWrap: 'wrap', columnGap: 18, rowGap: 0, alignItems: 'center' },
  formCol: { display: 'flex', flexDirection: 'column', gap: 16 },
  row: { display: 'flex', flexWrap: 'wrap', gap: 16 },
}

const CONSOLE_CSS = `
.al-grid{display:grid;grid-template-columns:1fr;gap:16px}
@media (min-width:720px){.al-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.al-head{display:flex;flex-direction:column;gap:18px}
@media (min-width:720px){.al-head{flex-direction:row;align-items:flex-end;justify-content:space-between}}
.al-primary-wide{width:100%}
`

function fmtTime(v: string | number | undefined): string {
  if (v === undefined || v === null || v === '') return ''
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString()
}

function Avatar({ sprite, name }: { sprite?: KidSprite | null; name: string }) {
  const has = !!sprite?.name
  return (
    <div aria-hidden style={{
      width: 64, height: 64, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center',
      background: C.raise, border: `1px solid ${has ? C.accent : C.hairline}`,
      boxShadow: has ? `0 0 28px ${C.accentGlow}` : 'none', color: C.dim,
      font: has ? `400 32px/1 ${FONT_UI}` : `400 22px/1 ${FONT_MONO}`,
    }}>
      {has ? spriteEmoji(sprite) : (firstName(name)[0] || '?').toLowerCase()}
    </div>
  )
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div style={S.stat}>
      <div style={S.statNum}>{value}</div>
      <div style={mono}>{label}</div>
    </div>
  )
}

function SkeletonTile() {
  return (
    <div style={S.tile} data-testid="learner-skeleton" aria-hidden>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <span className="al-skel" style={{ width: 64, height: 64, borderRadius: '50%', background: C.skeleton, flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
          <Skel w="45%" h={18} />
          <Skel w="30%" h={10} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 28 }}><Skel w={56} h={26} /><Skel w={56} h={26} /><Skel w={56} h={26} /></div>
      <Skel w="100%" h={48} r={999} />
    </div>
  )
}

function ReportList({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h4 style={{ margin: 0, ...mono }}>{title}</h4>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, color: C.ink }}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  )
}

export default function FamilyTutorConsolePanel({ apiBase, extraHeaders = {} }: FamilyTutorConsolePanelProps) {
  const headersRef = useRef(extraHeaders)
  headersRef.current = extraHeaders
  const rootRef = useRef<HTMLDivElement>(null)
  const { mode, pref, setPref } = useLearnMode()
  const [sheetHost, setSheetHost] = useState<Element | null>(null)

  const [learners, setLearners] = useState<Learner[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [glance, setGlance] = useState<Record<string, Glance>>({})
  const [note, setNote] = useState<string | null>(null)
  const [pair, setPair] = useState<PairCode | null>(null)
  const [view, setView] = useState<View>({ kind: 'none' })
  const [report, setReport] = useState<Report | null>(null)
  const [events, setEvents] = useState<TranscriptEvent[]>([])
  const [moreFor, setMoreFor] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)

  // enroll form (legacy, under Advanced)
  const [alias, setAlias] = useState('')
  const [grade, setGrade] = useState<1 | 2>(1)
  const [ageBand, setAgeBand] = useState<'6-7' | '8-9'>('6-7')
  const [noticeRead, setNoticeRead] = useState(false)
  const [consent, setConsent] = useState(false)

  // add-child sheet (creates the child's own account): three steps, then the QR
  const [addOpen, setAddOpen] = useState(false)
  const [addStep, setAddStep] = useState<1 | 2 | 3 | 4>(1)
  const [addErr, setAddErr] = useState<string | null>(null)
  const [childName, setChildName] = useState('')
  const [childEmail, setChildEmail] = useState('')
  const [childGrade, setChildGrade] = useState(1)
  const [childConsent, setChildConsent] = useState(false)
  const [childBusy, setChildBusy] = useState(false)
  const [connect, setConnect] = useState<ConnectState | null>(null)
  const [spaceFor, setSpaceFor] = useState<{ lid: string; name: string } | null>(null)
  const [spriteOffer, setSpriteOffer] = useState<{ lid: string; name: string } | null>(null)

  // optional terminal (device-code approval on the child's behalf)
  const [termOpen, setTermOpen] = useState(false)
  const [termLid, setTermLid] = useState('')
  const [userCode, setUserCode] = useState('')

  // settings + assign forms
  const [settings, setSettings] = useState<LearnerSettings>({})
  const [skillId, setSkillId] = useState('')
  const [assignNote, setAssignNote] = useState('')

  // Sheets render into the OS frame root when the panel lives inside one, so they
  // cover the frame's menubar and dock; inline otherwise (tests, embeds).
  useEffect(() => {
    setSheetHost(rootRef.current?.closest('[data-os-frame]') ?? null)
  }, [])

  // A status line fades on its own.
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 6000)
    return () => clearTimeout(t)
  }, [note])

  const call = useCallback(async (path: string, method = 'GET', body?: object) => {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', ...headersRef.current } }
    if (body) init.body = JSON.stringify(body)
    const r = await fetch(`${apiBase}${path}`, init)
    const data = await r.json().catch(() => null)
    return { status: r.status, ok: r.ok, data }
  }, [apiBase])

  /** One read of the learner list. Sets the list on success; a background
   *  refresh that fails never flips a loaded console to the error state. */
  const fetchLearners = useCallback(async (): Promise<'ok' | 'forbidden' | 'fail'> => {
    try {
      const r = await call('/family/learners')
      const list = Array.isArray(r.data) ? r.data
        : (r.data && Array.isArray((r.data as { learners?: unknown }).learners) ? (r.data as { learners: Learner[] }).learners : null)
      if (r.ok && list) { setLearners(list as Learner[]); setLoadState('ready'); return 'ok' }
      if (r.status === 403) { setLoadState('forbidden'); return 'forbidden' }
      return 'fail'
    } catch {
      return 'fail'
    }
  }, [call])

  const load = useCallback(async () => { await fetchLearners() }, [fetchLearners])

  // First load: one automatic retry after 3 s (a server restart is the usual
  // cause), then the offline state with "Try again".
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    fetchLearners().then((r) => {
      if (!alive || r !== 'fail') return
      timer = setTimeout(() => {
        fetchLearners().then((r2) => { if (alive && r2 === 'fail') setLoadState('error') })
      }, 3000)
    })
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [fetchLearners])

  const retry = async () => {
    setLoadState('loading')
    const r = await fetchLearners()
    if (r === 'fail') setLoadState('error')
  }

  // The glance: this week's real numbers per child. A failed read is "offline".
  const lidKey = learners.map((l) => l.lid).join(',')
  useEffect(() => {
    if (!lidKey) return
    let alive = true
    for (const lid of lidKey.split(',')) {
      call(`/family/learners/${encodeURIComponent(lid)}/report`)
        .then((r) => { if (alive) setGlance((g) => ({ ...g, [lid]: r.ok && r.data ? (r.data as Report) : 'offline' })) })
        .catch(() => { if (alive) setGlance((g) => ({ ...g, [lid]: 'offline' })) })
    }
    return () => { alive = false }
  }, [lidKey, call])

  const childNameOk = childName.trim().length >= 1 && childName.trim().length <= 80
  const childEmailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(childEmail.trim())
  const canAddChild = childNameOk && childEmailOk && childConsent && !childBusy

  const openAdd = () => {
    setAddErr(null); setAddStep(1); setConnect(null); setSpriteOffer(null); setAddOpen(true)
  }
  const closeAdd = () => {
    setAddOpen(false)
    if (addStep === 4) { setConnect(null); setSpriteOffer(null) }
  }

  const addChild = async () => {
    if (!canAddChild) return
    setAddErr(null)
    setChildBusy(true)
    const name = childName.trim()
    const r = await call('/family/children', 'POST', {
      full_name: name,
      email: childEmail.trim(),
      grade: childGrade,
      guardian_consent: true,
    }).catch(() => null)
    setChildBusy(false)
    const d = (r?.data || {}) as { learner?: Learner; connect?: ConnectLink; detail?: unknown; sprite_offer?: boolean }
    if (r?.ok && d.learner && d.connect?.url) {
      setConnect({ lid: d.learner.lid, name, link: d.connect })
      if (d.sprite_offer) setSpriteOffer({ lid: d.learner.lid, name: d.learner.alias || name })
      setChildName(''); setChildEmail(''); setChildConsent(false)
      setAddOpen(true); setAddStep(4)
      load()
    } else if (r?.status === 409) {
      setAddErr('That email already belongs to another account')
    } else if (r?.status === 403) {
      setAddErr('Only the workspace owner or an admin can add a child.')
    } else {
      setAddErr(typeof d.detail === 'string' ? d.detail : 'Could not add the child. Try again in a moment.')
    }
  }

  const onAddSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (addStep === 1) { if (childNameOk && childEmailOk) setAddStep(2); return }
    if (addStep === 2) { setAddStep(3); return }
    if (addStep === 3) void addChild()
  }

  const connectPhone = async (lid: string, name: string) => {
    setNote(null)
    const r = await call(`/family/learners/${encodeURIComponent(lid)}/connect-link`, 'POST', {}).catch(() => null)
    const d = (r?.data || {}) as { connect?: ConnectLink }
    if (r?.ok && d.connect?.url) setConnect({ lid, name, link: d.connect })
    else if (r?.status === 409) setNote('This child has no sign-in of their own yet. Open Advanced to use a one-time code.')
    else setNote('Could not make a phone code. Try again in a moment.')
  }

  const approveDevice = async (e: FormEvent) => {
    e.preventDefault()
    const code = userCode.trim().toUpperCase()
    if (!termLid || !code) return
    setNote(null)
    const r = await call(`/family/learners/${encodeURIComponent(termLid)}/approve-device`, 'POST', { user_code: code }).catch(() => null)
    if (r?.ok) { setNote('Approved. The phone terminal is signed in as your child.'); setUserCode('') }
    else if (r?.status === 404) setNote('That code was not found or has expired. Run adk login again.')
    else setNote('Could not approve that code.')
  }

  const boundLearners = learners.filter((l) => !!l.user_id)

  const aliasOk = /^[A-Za-z0-9 ]{1,24}$/.test(alias.trim())
  const canEnroll = aliasOk && noticeRead && consent

  const enroll = async (e: FormEvent) => {
    e.preventDefault()
    if (!canEnroll) return
    setNote(null)
    const r = await call('/family/learners', 'POST', {
      alias: alias.trim(),
      grade,
      age_band: ageBand,
      guardian_consent: { notice_read: noticeRead, consent },
    }).catch(() => null)
    const d = (r?.data || {}) as { lid?: string; pair_code?: string; expires_at?: string | number; detail?: unknown }
    if (r?.ok && d.pair_code) {
      setPair({ alias: alias.trim(), pair_code: d.pair_code, expires_at: d.expires_at })
      setAlias(''); setNoticeRead(false); setConsent(false)
      load()
    } else {
      setNote(typeof d.detail === 'string' ? d.detail : 'Could not enroll. Check the form and try again.')
    }
  }

  const newCode = async (l: Learner) => {
    setNote(null)
    const r = await call(`/family/learners/${encodeURIComponent(l.lid)}/pair-code`, 'POST', {}).catch(() => null)
    const d = (r?.data || {}) as { pair_code?: string; expires_at?: string | number }
    if (r?.ok && d.pair_code) setPair({ alias: l.alias, pair_code: d.pair_code, expires_at: d.expires_at })
    else setNote('Could not make a new code.')
  }

  const openReport = async (lid: string) => {
    setView({ kind: 'report', lid }); setReport(null)
    const r = await call(`/family/learners/${encodeURIComponent(lid)}/report`).catch(() => null)
    if (r?.ok && r.data) setReport(r.data as Report)
    else setNote('Could not load the report.')
  }

  const openTranscript = async (lid: string) => {
    setView({ kind: 'transcript', lid }); setEvents([])
    const r = await call(`/family/learners/${encodeURIComponent(lid)}/transcript?limit=100`).catch(() => null)
    const d = r?.data as unknown
    if (r?.ok && Array.isArray(d)) setEvents(d as TranscriptEvent[])
    else if (r?.ok && d && Array.isArray((d as { events?: unknown }).events)) setEvents((d as { events: TranscriptEvent[] }).events)
    else setNote('Could not load the transcript.')
  }

  const openSettings = (l: Learner) => {
    setSettings({ quest_minutes: 5, daily_cap_minutes: 15, focus: 'mixed', theme: '', ask_enabled: false, ...(l.settings || {}) })
    setView({ kind: 'settings', lid: l.lid })
  }

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault()
    if (view.kind !== 'settings') return
    // Only the fields this form edits: other settings keys (the focus card's, the voice
    // card's) have their own doors, and the PATCH model refuses unknown keys.
    const { quest_minutes, daily_cap_minutes, focus, theme, ask_enabled } = settings
    const patch = { quest_minutes, daily_cap_minutes, focus, theme, ask_enabled }
    const r = await call(`/family/learners/${encodeURIComponent(view.lid)}`, 'PATCH', { settings: patch }).catch(() => null)
    setNote(r?.ok ? 'Settings saved.' : 'Could not save settings.')
    if (r?.ok) load()
  }

  const assign = async (e: FormEvent) => {
    e.preventDefault()
    if (view.kind !== 'assign' || !skillId.trim()) return
    const r = await call(`/family/learners/${encodeURIComponent(view.lid)}/assign`, 'POST', {
      skill_id: skillId.trim(), note: assignNote.slice(0, 140),
    }).catch(() => null)
    setNote(r?.ok ? 'Practice assigned.' : 'Could not assign that skill.')
    if (r?.ok) { setSkillId(''); setAssignNote('') }
  }

  const clamp = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || lo))
  const current = 'lid' in view ? learners.find((l) => l.lid === view.lid) : undefined
  const closeView = () => setView({ kind: 'none' })

  // Header line: real numbers only, and only once every child's week has answered.
  const answered = learners.map((l) => glance[l.lid])
  const weekMinutes = learners.length > 0 && answered.every((g) => g !== undefined && g !== 'offline')
    ? answered.reduce((n, g) => n + ((g as Report).minutes ?? 0), 0) : null

  const linkBtn = (label: string, onClick: () => void, extra?: CSSProperties) => (
    <button type="button" onClick={onClick} className="al-quiet al-focus" style={{ ...quiet, ...extra }}>{label}</button>
  )
  const showFamily = loadState === 'ready' && learners.length > 0

  return (
    <div ref={rootRef} style={{ ...learnVars(mode), ...S.root }} data-learn-theme={mode} data-testid="family-tutor-console">
      <style>{LEARN_CSS + CONSOLE_CSS}</style>
      <div style={S.column}>

        {/* Header */}
        <header className="al-head al-in">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={mono}>aither learn · family</span>
            <h1 style={{ margin: 0, font: `300 clamp(32px, 6vw, 46px)/1.05 ${FONT_UI}`, letterSpacing: '-0.02em', color: C.ink }}>
              Your family
            </h1>
            <span style={{ ...mono, color: C.dim, letterSpacing: '.08em' }} data-testid="family-summary">
              {showFamily
                ? `${learners.length} ${learners.length === 1 ? 'child' : 'children'}${weekMinutes !== null ? ` · ${weekMinutes} min this week` : ''}`
                : "your family's learning, at a glance"}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            {showFamily && linkBtn('Add a child', openAdd, { color: C.accent })}
            <LearnModeSwitch pref={pref} onChange={setPref} />
          </div>
        </header>

        {/* The family */}
        <section aria-label="Your children" aria-busy={loadState === 'loading'}>
          {loadState === 'loading' && (
            <div className="al-grid" data-testid="learners-loading">
              <SkeletonTile /><SkeletonTile />
            </div>
          )}

          {loadState === 'error' && (
            <div style={{ ...S.section, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }} data-testid="learners-error" className="al-in">
              <span style={mono}>offline</span>
              <p style={{ margin: 0, font: `300 22px/1.3 ${FONT_UI}`, letterSpacing: '-0.02em' }}>
                We couldn&apos;t reach your family&apos;s learning just now.
              </p>
              <p style={{ margin: 0, ...help }}>Usually a quick restart on our side. Your children&apos;s progress is safe.</p>
              <button type="button" onClick={retry} className="al-primary al-focus" style={primary}>Try again</button>
            </div>
          )}

          {loadState === 'forbidden' && (
            <div style={{ ...S.section, display: 'flex', flexDirection: 'column', gap: 8 }} className="al-in">
              <span style={mono}>family owners only</span>
              <p style={{ margin: 0, color: C.dim }}>Only a workspace owner or admin can manage learners.</p>
            </div>
          )}

          {loadState === 'ready' && learners.length === 0 && (
            <div data-testid="learners-empty" className="al-in" style={{ ...S.section, padding: 'clamp(24px, 5vw, 44px)', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' }}>
              <span style={mono}>no children yet</span>
              <h2 style={{ margin: 0, font: `300 28px/1.15 ${FONT_UI}`, letterSpacing: '-0.02em' }}>Add your first child</h2>
              <p style={{ margin: 0, color: C.dim, maxWidth: 520 }}>
                They get their own sign-in. You connect their phone with a code, so nobody types a password.
              </p>
              <button type="button" onClick={openAdd} className="al-primary al-focus" style={{ ...primary, marginTop: 6 }}>Add a child</button>
            </div>
          )}

          {showFamily && (
            <div className="al-grid">
              {learners.map((l, i) => {
                const g = glance[l.lid]
                const more = moreFor === l.lid
                const name = l.display_name || l.alias
                return (
                  <article key={l.lid} className="al-tile al-in" data-testid={`learner-${l.lid}`}
                    style={{ ...S.tile, animationDelay: `${Math.min(i, 6) * 60}ms` }}>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', minWidth: 0 }}>
                      <Avatar sprite={l.sprite} name={l.alias} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                        <h3 style={S.h3}>{l.alias}</h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 2, ...mono, color: C.dim, letterSpacing: '.08em' }}>
                          <span>{gradeWord(l.grade)}</span>
                          <span aria-hidden>·</span>
                          <LearnerSpriteButton call={call} lid={l.lid} sprite={l.sprite} onDone={() => load()} />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', minHeight: 50 }} data-testid={`glance-${l.lid}`}>
                      {g === undefined ? (
                        <><Skel w={56} h={26} /><Skel w={56} h={26} /></>
                      ) : g === 'offline' ? (
                        <span style={{ ...mono, color: C.faint, alignSelf: 'center' }}>this week · offline</span>
                      ) : (
                        <>
                          <Stat value={g.minutes ?? 0} label="min this week" />
                          <Stat value={g.sessions ?? 0} label="quests" />
                          <Stat value={g.attempts ?? 0} label="questions" />
                        </>
                      )}
                    </div>

                    <button type="button" className="al-primary al-focus al-primary-wide" style={primary}
                      onClick={() => (l.user_id ? connectPhone(l.lid, name) : newCode(l))}>
                      Connect a phone
                    </button>

                    <nav aria-label={`More for ${l.alias}`} style={{ borderTop: `1px solid ${C.hairline}`, marginTop: -4 }}>
                      <div style={S.links}>
                        {linkBtn('Progress', () => setView({ kind: 'progress', lid: l.lid }))}
                        {linkBtn('Weekly report', () => openReport(l.lid))}
                        {linkBtn('Weekly focus', () => setView({ kind: 'focus', lid: l.lid }))}
                        {linkBtn('Level', () => setView({ kind: 'level', lid: l.lid }))}
                        {linkBtn('Messages', () => setView({ kind: 'messages', lid: l.lid }))}
                        <button type="button" aria-expanded={more} onClick={() => setMoreFor(more ? null : l.lid)}
                          className="al-quiet al-focus" style={{ ...quiet, color: C.faint }}>
                          {more ? 'Less' : 'More'}
                        </button>
                      </div>
                      {more && (
                        <div style={S.links} className="al-fade">
                          {linkBtn('Transcript', () => openTranscript(l.lid))}
                          {linkBtn('Settings', () => openSettings(l))}
                          {linkBtn('Assign practice', () => setView({ kind: 'assign', lid: l.lid }))}
                          {linkBtn('Make Space', () => setSpaceFor({ lid: l.lid, name: l.alias }))}
                        </div>
                      )}
                    </nav>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        {/* Academy: one quiet row */}
        {showFamily && <AcademyMirrorCard call={call} />}

        {/* Advanced: the terminal and the legacy code path */}
        <section style={{ borderTop: `1px solid ${C.hairline}`, paddingTop: 8 }}>
          <button type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}
            className="al-quiet al-focus" style={{ ...quiet, ...mono, minHeight: 44 }}>
            {advanced ? '▾' : '▸'} Advanced
          </button>
          {advanced && (
            <div className="al-fade" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
              <section style={S.section} data-testid="terminal-card">
                <button type="button" className="al-quiet al-focus" style={{ ...quiet, color: C.ink, width: '100%', justifyContent: 'flex-start' }}
                  aria-expanded={termOpen} onClick={() => setTermOpen(!termOpen)}>
                  {termOpen ? '▾' : '▸'} Terminal (optional)
                </button>
                {termOpen && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={help}>If this is too fiddly, the Home-screen app is all they need.</div>
                    <p style={{ margin: 0, color: C.dim }}>
                      Pixel: Settings &gt; System &gt; Developer options &gt; Linux development environment, open Terminal, then:
                    </p>
                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0, font: `400 13px/1.6 ${FONT_MONO}`, color: C.ink, background: C.raise, border: `1px solid ${C.hairline}`, padding: 14, borderRadius: 12, overflowX: 'auto' }}>
                      {TERMINAL_STEPS}
                    </pre>
                    <p style={{ margin: 0, ...help }}>
                      adk login shows a short code. Type it here and pick the child: the terminal then signs in as your
                      child, never as you. adk learn prints their /learn link; adk learn play practices one quest in text.
                      Use the Linux terminal: Termux is not tested.
                    </p>
                    <form style={{ ...S.row, alignItems: 'flex-end' }} onSubmit={approveDevice}>
                      <Field label="Child">
                        <SelectBox aria-label="terminal learner" value={termLid} onChange={(e) => setTermLid(e.target.value)}>
                          <option value="">Choose…</option>
                          {boundLearners.map((l) => <option key={l.lid} value={l.lid}>{l.display_name || l.alias}</option>)}
                        </SelectBox>
                      </Field>
                      <Field label="Code shown on the phone">
                        <input aria-label="code shown on the phone" value={userCode} maxLength={16} className="al-field"
                          style={{ ...fieldBox, fontFamily: FONT_MONO, letterSpacing: '.12em' }} onChange={(e) => setUserCode(e.target.value)} />
                      </Field>
                      <button type="submit" className="al-primary al-focus" style={primary} disabled={!termLid || !userCode.trim()}>Approve</button>
                    </form>
                  </div>
                )}
              </section>

              <form style={{ ...S.section, ...S.formCol }} onSubmit={enroll} data-testid="enroll-form">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={mono}>without an account</span>
                  <h3 style={S.h3}>Add a learner with a one-time code</h3>
                  <div style={help}>We keep a nickname, a grade and an age band. No birthday, email or diagnosis.</div>
                </div>
                <div style={S.row}>
                  <Field label="Nickname (letters, numbers, spaces)">
                    <input aria-label="nickname" value={alias} maxLength={24} className="al-field" style={fieldBox} onChange={(e) => setAlias(e.target.value)} />
                  </Field>
                  <Field label="Grade">
                    <SelectBox aria-label="grade" value={grade} onChange={(e) => setGrade(Number(e.target.value) === 2 ? 2 : 1)}>
                      <option value={1}>1st grade</option>
                      <option value={2}>2nd grade</option>
                    </SelectBox>
                  </Field>
                  <Field label="Age band">
                    <SelectBox aria-label="age band" value={ageBand} onChange={(e) => setAgeBand(e.target.value === '8-9' ? '8-9' : '6-7')}>
                      <option value="6-7">6 to 7</option>
                      <option value="8-9">8 to 9</option>
                    </SelectBox>
                  </Field>
                </div>
                <CheckRow ariaLabel="notice read" checked={noticeRead} onChange={setNoticeRead}>
                  I have read the notice about what Aither Learn stores and why.
                </CheckRow>
                <CheckRow ariaLabel="consent" checked={consent} onChange={setConsent}>
                  As this child’s parent or guardian, I consent.
                </CheckRow>
                <div><button type="submit" className="al-primary al-focus" style={primary} disabled={!canEnroll}>Enroll</button></div>
              </form>
            </div>
          )}
        </section>

        {note && (
          <div role="status" className="al-in" style={{
            position: 'sticky', bottom: 16, alignSelf: 'center', maxWidth: '100%', boxSizing: 'border-box',
            background: C.surface, color: C.ink, border: `1px solid ${C.hairlineStrong}`, borderRadius: 999,
            padding: '12px 20px', boxShadow: C.shadow, font: `400 14px/1.4 ${FONT_UI}`, zIndex: 5,
          }}>
            {note}
          </div>
        )}
      </div>

      {/* Sheets */}
      {addOpen && (
        <Sheet mode={mode} host={sheetHost} label="Add a child" onClose={closeAdd} testId="add-child-sheet">
          {addStep < 4 ? (
            <form onSubmit={onAddSubmit} data-testid="add-child-form" style={S.formCol}>
              <SheetHeading label={`add a child · step ${addStep} of 3`} title={
                addStep === 1 ? 'Who is learning?' : addStep === 2 ? `What grade is ${firstName(childName) || 'your child'} in?` : 'One last thing'
              } />
              <div aria-hidden style={{ display: 'flex', gap: 6 }}>
                {[1, 2, 3].map((n) => (
                  <span key={n} style={{ flex: 1, height: 2, borderRadius: 2, background: n <= addStep ? C.accent : C.hairline, transition: `background-color .3s ${EASE}` }} />
                ))}
              </div>

              {addStep === 1 && (
                <div className="al-in" style={S.formCol}>
                  <Field label="Their full name">
                    <input aria-label="full name" value={childName} maxLength={80} autoComplete="off" className="al-field" style={fieldBox}
                      onChange={(e) => setChildName(e.target.value)} />
                  </Field>
                  <Field label="An email for their sign-in" hint="Only used as their sign-in name. Nobody types or sees a password.">
                    <input aria-label="email" type="email" value={childEmail} placeholder="athena@aitherium.com" autoComplete="off" className="al-field" style={fieldBox}
                      onChange={(e) => setChildEmail(e.target.value)} />
                  </Field>
                </div>
              )}

              {addStep === 2 && (
                <div role="radiogroup" aria-label="child grade" className="al-in"
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                  {GRADES.map(([g, label]) => {
                    const on = childGrade === g
                    return (
                      <button key={g} type="button" role="radio" aria-checked={on} onClick={() => setChildGrade(g)} className="al-focus"
                        style={{
                          minHeight: 56, borderRadius: 12, cursor: 'pointer', font: `400 15px/1.2 ${FONT_UI}`,
                          border: `1px solid ${on ? C.accent : C.hairlineStrong}`, background: on ? C.accentWash : 'transparent',
                          color: on ? C.ink : C.dim, transition: `border-color .18s ${EASE}, background-color .18s ${EASE}`,
                        }}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}
              {addStep === 2 && childGrade > 2 && (
                // The skill graph is K-2 today (config/tutor/skill_graph.yaml). Say so
                // instead of silently serving 2nd-grade work to an older child.
                <p role="note" data-testid="k2-only-note"
                  style={{ marginTop: 10, font: `400 13px/1.4 ${FONT_UI}`, color: C.dim }}>
                  Lessons cover kindergarten to 2nd grade for now, so {gradeWord(childGrade)} will
                  start at the 2nd-grade level. Older levels are coming.
                </p>
              )}

              {addStep === 3 && (
                <div className="al-in" style={S.formCol}>
                  <p style={{ margin: 0, color: C.dim }}>
                    We&apos;ll make {possessive(childName)} own sign-in, then show a code you scan with their phone.
                  </p>
                  <CheckRow ariaLabel="child consent" checked={childConsent} onChange={setChildConsent}>
                    As {possessive(childName)} parent or guardian, I consent to creating their account.
                  </CheckRow>
                </div>
              )}

              {addErr && <div role="alert" style={{ color: C.amber, font: `400 14px/1.45 ${FONT_UI}` }}>{addErr}</div>}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                {addStep > 1
                  ? linkBtn('Back', () => { setAddErr(null); setAddStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s)) })
                  : <span />}
                {addStep < 3 ? (
                  <button type="submit" className="al-primary al-focus" style={primary} disabled={addStep === 1 && !(childNameOk && childEmailOk)}>Next</button>
                ) : (
                  <button type="submit" className="al-primary al-focus" style={primary} disabled={!canAddChild}>
                    {childBusy ? 'Adding…' : 'Add child'}
                  </button>
                )}
              </div>
            </form>
          ) : (
            <div style={S.formCol}>
              {connect && (
                <ConnectBody key={`${connect.lid}:${connect.link.url}`} state={connect}
                  onRenew={() => connectPhone(connect.lid, connect.name)} onClose={closeAdd} />
              )}
              {spriteOffer && (
                <SpriteOfferCard call={call} lid={spriteOffer.lid} name={spriteOffer.name} onClose={() => { setSpriteOffer(null); load() }} />
              )}
            </div>
          )}
        </Sheet>
      )}

      {connect && !addOpen && (
        <Sheet mode={mode} host={sheetHost} label="Connect a phone" onClose={() => setConnect(null)}>
          <ConnectBody key={`${connect.lid}:${connect.link.url}`} state={connect}
            onRenew={() => connectPhone(connect.lid, connect.name)} onClose={() => setConnect(null)} />
        </Sheet>
      )}

      {pair && (
        <Sheet mode={mode} host={sheetHost} label="Connect a phone" onClose={() => setPair(null)}>
          <div data-testid="pair-code-card" style={S.formCol}>
            <SheetHeading label={`connect · ${pair.alias.toLowerCase()}`} title={`${possessive(pair.alias)} code`} />
            <div style={{ background: C.qrField, borderRadius: 16, padding: '36px 20px', textAlign: 'center', border: `1px solid ${C.hairline}` }}>
              <div data-testid="pair-code" style={{ font: `400 clamp(34px, 10vw, 48px)/1 ${FONT_MONO}`, letterSpacing: '.24em', ...onQr(0.95) }}>{pair.pair_code}</div>
            </div>
            <p style={{ margin: 0, color: C.dim }}>
              Shown once. Have {pair.alias} sign in to their own account, open Learn, and type this code.
              {pair.expires_at ? ` It expires ${fmtTime(pair.expires_at)}.` : ''}
            </p>
            <div><button type="button" className="al-primary al-focus" style={primary} onClick={() => setPair(null)}>I wrote it down</button></div>
          </div>
        </Sheet>
      )}

      {spaceFor && (
        <Sheet mode={mode} host={sheetHost} label={`${spaceFor.name}'s Space`} onClose={() => setSpaceFor(null)} wide>
          <FamilySpaceCard key={spaceFor.lid} mode="guardian" apiBase={apiBase} extraHeaders={headersRef.current}
            lid={spaceFor.lid} name={spaceFor.name} onClose={() => setSpaceFor(null)} />
        </Sheet>
      )}

      {view.kind !== 'none' && (
        <Sheet mode={mode} host={sheetHost} wide label={view.kind} onClose={closeView}>
          {view.kind === 'report' && (
            <section data-testid="report-view" style={S.formCol}>
              <SheetHeading label="weekly report" title={`This week${current ? ` for ${current.alias}` : ''}`} />
              {!report ? (
                <div style={{ display: 'flex', gap: 28 }}><Skel w={64} h={30} /><Skel w={64} h={30} /><Skel w={64} h={30} /></div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 1, background: C.hairline, border: `1px solid ${C.hairline}`, borderRadius: 14, overflow: 'hidden' }}>
                    {([[report.minutes ?? 0, 'minutes'], [report.sessions ?? 0, 'sessions'], [report.attempts ?? 0, 'practice items'], [report.breaks_used ?? 0, 'breaks taken']] as Array<[number, string]>).map(([v, k]) => (
                      <div key={k} style={{ background: C.surface, padding: '16px 18px' }}><Stat value={v} label={k} /></div>
                    ))}
                  </div>
                  {report.observations && report.observations.length > 0 && (
                    <ReportList title="What we noticed" items={report.observations} />
                  )}
                  {report.skills && Object.keys(report.skills).length > 0 && (
                    <ReportList title="Skills" items={Object.entries(report.skills).map(([id, s]) => `${s.kid_title || id}: ${STATE_WORDS[s.state || ''] || s.state || 'in progress'}`)} />
                  )}
                  {report.edge && report.edge.length > 0 && <ReportList title="Ready to learn next" items={report.edge} />}
                  {report.at_risk_reviews && report.at_risk_reviews.length > 0 && <ReportList title="Worth a quick review" items={report.at_risk_reviews} />}
                  {report.notes && report.notes.length > 0 && <ReportList title="Notes" items={report.notes} />}
                </>
              )}
            </section>
          )}

          {view.kind === 'transcript' && (
            <section data-testid="transcript-view" style={S.formCol}>
              <SheetHeading label="transcript · read-only" title={`Transcript${current ? ` for ${current.alias}` : ''}`} />
              <div style={help}>Everything the tutor said and every answer, in order.</div>
              {events.length === 0 ? <div style={mono}>nothing yet</div> : (
                <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
                  {events.map((ev, i) => (
                    <li key={i} style={{ padding: '10px 0', borderTop: i ? `1px solid ${C.hairline}` : 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ ...mono, letterSpacing: '.08em' }}>{fmtTime(ev.ts)} {ev.kind}</span>
                      <span>{String(ev.say ?? ev.text ?? ev.message ?? '')}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {view.kind === 'settings' && (
            <form onSubmit={saveSettings} data-testid="settings-view" style={S.formCol}>
              <SheetHeading label="settings" title={`Settings${current ? ` for ${current.alias}` : ''}`} />
              <div style={S.row}>
                <Field label="Quest minutes (2 to 10)">
                  <input type="number" min={2} max={10} value={settings.quest_minutes ?? 5} className="al-field" style={fieldBox}
                    onChange={(e) => setSettings({ ...settings, quest_minutes: clamp(e.target.value, 2, 10) })} />
                </Field>
                <Field label="Daily cap minutes (5 to 45)">
                  <input type="number" min={5} max={45} value={settings.daily_cap_minutes ?? 15} className="al-field" style={fieldBox}
                    onChange={(e) => setSettings({ ...settings, daily_cap_minutes: clamp(e.target.value, 5, 45) })} />
                </Field>
              </div>
              <div style={S.row}>
                <Field label="Focus">
                  <SelectBox value={settings.focus ?? 'mixed'}
                    onChange={(e) => setSettings({ ...settings, focus: e.target.value as LearnerSettings['focus'] })}>
                    <option value="math">Math</option>
                    <option value="reading">Reading</option>
                    <option value="mixed">Mixed</option>
                  </SelectBox>
                </Field>
                <Field label="Theme">
                  <input value={settings.theme ?? ''} maxLength={24} className="al-field" style={fieldBox}
                    onChange={(e) => setSettings({ ...settings, theme: e.target.value })} />
                </Field>
              </div>
              <CheckRow checked={!!settings.ask_enabled} onChange={(v) => setSettings({ ...settings, ask_enabled: v })}>
                Allow “ask a question” (off by default)
              </CheckRow>
              <div><button type="submit" className="al-primary al-focus" style={primary}>Save settings</button></div>
            </form>
          )}
          {view.kind === 'settings' && (
            <LearnVoiceCard key={`voice-${view.lid}`} call={call} apiBase={apiBase}
              getHeaders={() => headersRef.current} lid={view.lid} alias={current?.alias} onNote={setNote} />
          )}
          {view.kind === 'settings' && (
            <LearnerGuardCard key={`guard-${view.lid}`} call={call} lid={view.lid} alias={current?.alias}
              canRemove={current?.guardian_role !== 'co'}
              onNote={setNote} onRemoved={() => { closeView(); load() }} />
          )}
          {view.kind === 'settings' && current?.guardian_role !== 'co' && (
            <CoGuardiansCard key={`co-${view.lid}`} call={call} lid={view.lid} alias={current?.alias} onNote={setNote} />
          )}

          {view.kind === 'assign' && (
            <form onSubmit={assign} data-testid="assign-view" style={S.formCol}>
              <SheetHeading label="assign practice" title={`Assign practice${current ? ` for ${current.alias}` : ''}`} />
              <Field label="Skill id">
                <input value={skillId} placeholder="math.add_within_20" className="al-field" style={{ ...fieldBox, fontFamily: FONT_MONO }} onChange={(e) => setSkillId(e.target.value)} />
              </Field>
              <Field label="Note (optional)">
                <input value={assignNote} maxLength={140} className="al-field" style={fieldBox} onChange={(e) => setAssignNote(e.target.value)} />
              </Field>
              <div><button type="submit" className="al-primary al-focus" style={primary} disabled={!skillId.trim()}>Assign</button></div>
            </form>
          )}

          {view.kind === 'messages' && (
            <FamilyMessagesSection key={view.lid} apiBase={apiBase} extraHeaders={extraHeaders} lid={view.lid} name={current?.alias} />
          )}
          {view.kind === 'progress' && (
            <TutorProgressCard key={view.lid} apiBase={apiBase} lid={view.lid} alias={current?.alias}
              extraHeaders={extraHeaders} onNote={setNote} />
          )}
          {view.kind === 'level' && (
            <TutorLevelCard key={view.lid} apiBase={apiBase} lid={view.lid} alias={current?.alias}
              extraHeaders={extraHeaders} onNote={setNote} />
          )}
          {view.kind === 'focus' && (
            <TutorFocusCard key={view.lid} apiBase={apiBase} lid={view.lid} alias={current?.alias}
              extraHeaders={extraHeaders} onNote={setNote} />
          )}
        </Sheet>
      )}
    </div>
  )
}
