/**
 * KidPhoneConnect: the ONE way a grown-up connects a kid's phone.
 *
 * The kid's phone, signed out, opens Aither Learn and shows "Ask your grown-up to connect
 * this phone" with a short code (Veil app/learn/AskGrownUp.tsx). The grown-up taps
 * "Connect a phone" (KID_CONNECT_BUTTON) on THAT child's card, types the code here, and
 * Genesis approves it FOR that child: POST {apiBase}/family/learners/{lid}/approve-device
 * -> Identity /auth/internal/child-device/authorize (guardian of record only, rate limited
 * per guardian; the code is single-use and lives 15 minutes). The kid's phone then signs
 * itself in within a few seconds.
 *
 * There is no grown-up-made QR or link any more (retired 2026-10-17): a guardian who
 * opened their child's link on their own phone was signed in as the child. Here the
 * grown-up never holds anything a phone could redeem; the code comes FROM the kid's phone
 * and the child is chosen by the card the button sits on.
 *
 * The kid's screen quotes KID_CONNECT_BUTTON verbatim, so the two can never drift.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { C, FONT_MONO, FONT_UI } from './learnTheme'

/** The guardian's button, and the words the kid's phone tells them to tap. */
export const KID_CONNECT_BUTTON = 'Connect a phone'

/** Upper-case, spaces dropped, and "ABCD1234" read as Identity's "ABCD-1234". */
export function normalizeKidCode(raw: string): string {
  const c = (raw || '').toUpperCase().replace(/[^A-Z0-9-]/g, '')
  if (/^[A-Z0-9]{8}$/.test(c)) return `${c.slice(0, 4)}-${c.slice(4)}`
  return c
}

/** A code worth sending (Genesis accepts ^[A-Za-z0-9-]{4,16}$). */
export function kidCodeLooksRight(code: string): boolean {
  return /^[A-Z0-9-]{4,16}$/.test(code) && /[A-Z0-9]{4}/.test(code)
}

/**
 * What a failed approval says. Genesis answers a status AND a reason (`detail`); the reason
 * decides the words, so an expired code never reads as "no account" (owner, 2026-10-17: both
 * kids HAD accounts and the page said they did not, because every 409 was read as one).
 */
export function kidCodeMessage(status: number, first = 'your child', detail = ''): string {
  const d = (detail || '').toLowerCase()
  if (/no account/.test(d)) return `${first} has no account yet. Add them first.`
  if (status === 404 || /expired|unknown_or|not_found/.test(d)) {
    return `That code expired or was already used. Tap "New code" on ${first}'s phone and type the new one.`
  }
  if (status === 429 || /rate_limit/.test(d)) return 'Too many tries. Wait a minute and try again.'
  if (status === 403) return "Only this child's grown-up can connect their phone."
  if (status === 409) {
    if (/email_taken/.test(d)) return `That sign-in is already used by another account. Tap "New code" on ${first}'s phone and try again.`
    return `That phone could not be connected${d && d.length <= 60 ? ` (${detail})` : ''}. Tap "New code" on ${first}'s phone and try again.`
  }
  if (status === 502 || status === 503) return 'The sign-in service is busy. Try again in a moment.'
  return "Couldn't connect the phone right now. Try again in a moment."
}

/** The approval call itself (the only thing this flow ever sends). */
export async function approveKidPhone(
  apiBase: string, lid: string, code: string, extraHeaders: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; detail: string }> {
  try {
    const res = await fetch(`${apiBase}/family/learners/${encodeURIComponent(lid)}/approve-device`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...extraHeaders },
      body: JSON.stringify({ user_code: code }),
    })
    let detail = ''
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { detail?: unknown } | null
      detail = typeof body?.detail === 'string' ? body.detail.slice(0, 160) : ''
    }
    return { ok: res.ok, status: res.status, detail }
  } catch {
    return { ok: false, status: 0, detail: '' }
  }
}

function firstName(name: string): string {
  return (name || '').trim().split(/\s+/)[0] || ''
}

/** Colours, so the same control sits in a Learn sheet or on the /family page. */
export interface KidPhoneConnectPalette {
  ink: string; dim: string; accent: string; onAccent: string; hairline: string; surface: string; warn: string
}

const LEARN_PALETTE: KidPhoneConnectPalette = {
  ink: C.ink, dim: C.dim, accent: C.accent, onAccent: C.onAccent, hairline: C.hairlineStrong, surface: C.surface, warn: C.amber,
}

export interface KidPhoneConnectProps {
  apiBase: string
  extraHeaders?: Record<string, string>
  /** The child this approval is FOR (the card the button sits on). */
  lid: string
  name: string
  /** A code to pre-fill (?approve=CODE). */
  initialCode?: string
  palette?: KidPhoneConnectPalette
  /** After a successful approval. */
  onConnected?: () => void
}

export default function KidPhoneConnect({
  apiBase, extraHeaders = {}, lid, name, initialCode = '', palette = LEARN_PALETTE, onConnected,
}: KidPhoneConnectProps) {
  const first = firstName(name) || 'your child'
  const [code, setCode] = useState(() => normalizeKidCode(initialCode))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const normalized = normalizeKidCode(code)
  const ready = kidCodeLooksRight(normalized) && !busy
  const P = palette
  const id = `kid-code-${lid}`

  const submit = async () => {
    if (!ready) return
    setBusy(true)
    setNote(null)
    const r = await approveKidPhone(apiBase, lid, normalized, extraHeaders)
    setBusy(false)
    if (r.ok) {
      setCode('')
      setNote({ ok: true, text: `Done. ${first}'s phone signs in by itself in a few seconds.` })
      onConnected?.()
    } else {
      setNote({ ok: false, text: kidCodeMessage(r.status, first, r.detail) })
    }
  }

  const input: CSSProperties = {
    width: '100%', boxSizing: 'border-box', minHeight: 56, padding: '10px 14px', borderRadius: 12,
    border: `1px solid ${P.hairline}`, background: P.surface, color: P.ink,
    font: `400 26px/1.2 ${FONT_MONO}`, letterSpacing: '.14em', textAlign: 'center', textTransform: 'uppercase',
  }
  const button: CSSProperties = {
    width: '100%', minHeight: 52, borderRadius: 999, border: 'none', cursor: ready ? 'pointer' : 'default',
    background: P.accent, color: P.onAccent, font: `500 16px/1 ${FONT_UI}`, opacity: ready ? 1 : 0.5,
  }

  return (
    <form
      data-testid={`kid-phone-connect-${lid}`}
      onSubmit={(e) => { e.preventDefault(); void submit() }}
      style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 420, color: P.ink, fontFamily: FONT_UI }}
    >
      <label htmlFor={id} style={{ font: `500 15px/1.35 ${FONT_UI}`, color: P.ink }}>
        Type the code shown on {first}&apos;s phone
      </label>
      <input
        id={id}
        ref={inputRef}
        data-testid="kid-phone-code"
        value={code}
        onChange={(e) => { setCode(e.target.value); setNote(null) }}
        placeholder="ABCD-1234"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        enterKeyHint="go"
        maxLength={16}
        style={input}
      />
      <button type="submit" data-testid="kid-phone-connect-go" disabled={!ready} style={button}>
        {busy ? 'Connecting…' : `Connect ${first}'s phone`}
      </button>
      <p style={{ margin: 0, font: `400 13px/1.45 ${FONT_UI}`, color: P.dim }}>
        On {first}&apos;s phone open app.aitherium.com/learn (or the Aither app). It shows the code. Never type a code from your own phone.
      </p>
      {note && (
        <p role={note.ok ? 'status' : 'alert'} data-testid="kid-phone-connect-note"
          style={{ margin: 0, font: `500 14px/1.45 ${FONT_UI}`, color: note.ok ? P.ink : P.warn }}>
          {note.text}
        </p>
      )}
    </form>
  )
}
