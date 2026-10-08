/**
 * LearnerGuardCard: the guardian's two hard controls for one child (Aither Learn).
 *
 * - Sprite chat: GET/PUT {apiBase}/family/learners/{lid}/sprite/parental. Turns the
 *   child's sprite chat off or on behind a PIN only the guardian holds. The first save
 *   sets the PIN; later changes need it (wrong PIN 403, too many 429).
 * - Remove from Learn: POST {apiBase}/family/learners/{lid}/remove after a typed
 *   confirmation. The child's history stays readable to the guardian; the child can no
 *   longer start quests.
 * - Delete permanently: POST {apiBase}/family/learners/{lid}/erase with
 *   {"confirm": <the child's name>}. Deletes the child's profile, account, devices,
 *   sprite, Space and every record, history included (COPPA / Play Families).
 *   Guardian of record only, like Remove. On success the card turns into a receipt of
 *   what was deleted (the route's `removed` counts) until the guardian taps Done;
 *   onErased tells the host so it can hide the deleted child's other cards meanwhile.
 *   The receipt says only what is true: an AI-answer report the child sent leaves a
 *   copy with the safety team, so it says so.
 */
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { C, FONT_UI } from './learnTheme'
import { SheetHeading, fieldBox, help, labelText, mono, primary, quiet } from './learnParts'

type Call = (path: string, method?: string, body?: object) => Promise<{ status: number; ok: boolean; data: unknown }>

export interface LearnerGuardCardProps {
  call: Call
  lid: string
  alias?: string
  onNote?: (message: string) => void
  onRemoved?: () => void
  /** The child was deleted and the receipt is showing (onRemoved follows on Done). */
  onErased?: () => void
  /** False for a co-guardian: only the guardian of record can remove a child. */
  canRemove?: boolean
}

interface Parental { chat_disabled?: boolean; pin_set?: boolean }

/** POST .../erase answers {lid, erased, account, removed: {<store>: count}}. */
export interface EraseResult { account?: string; removed?: Record<string, number> }

// Counts with a receipt line of their own; every other count is a learning record
// (skills, quests, transcript, rewards, inbox ...). Plumbing counts are not shown.
const NAMED = new Set(['devices', 'chats', 'memories', 'reports', 'sprite', 'space', 'roster', 'class_links'])
const PLUMBING = new Set(['learner', 'identity_sessions', 'device_codes', 'device_sessions', 'academy', 'claim_failures'])

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)
const count = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`

/** The guardian's receipt: one plain line per kind of thing that was deleted. */
export function eraseReceipt(result: EraseResult | null | undefined): string[] {
  const removed = result?.removed || {}
  const lines: string[] = []
  if (result?.account === 'erased') lines.push('Their Aither account, signed out everywhere')
  else if (result?.account === 'not_a_child_account') lines.push('Their own account was kept: they created it themselves')
  if (num(removed.devices)) lines.push(count(num(removed.devices), 'device', 'devices'))
  if (num(removed.chats)) lines.push(count(num(removed.chats), 'chat', 'chats'))
  if (num(removed.memories)) lines.push(count(num(removed.memories), 'saved memory', 'saved memories'))
  if (num(removed.reports)) lines.push(count(num(removed.reports), 'report they sent to support', 'reports they sent to support'))
  if (num(removed.sprite)) lines.push('Their sprite')
  if (num(removed.space)) lines.push('Their family Space')
  if (num(removed.roster)) lines.push('Their place on your workspace')
  if (num(removed.class_links)) lines.push(count(num(removed.class_links), 'class link', 'class links'))
  const records = Object.entries(removed)
    .filter(([k]) => !NAMED.has(k) && !PLUMBING.has(k))
    .reduce((sum, [, v]) => sum + num(v), 0)
  lines.push(records ? `${count(records, 'learning record', 'learning records')}, reports included` : 'Their profile')
  return lines
}

const S: Record<string, CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: 14, fontFamily: FONT_UI, color: C.ink },
  row: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  danger: { ...quiet, color: C.ink, border: `1px solid ${C.hairlineStrong}` },
}

export default function LearnerGuardCard({ call, lid, alias, onNote, onRemoved, onErased, canRemove = true }: LearnerGuardCardProps) {
  const name = alias || 'this child'
  const base = `/family/learners/${encodeURIComponent(lid)}`
  const [parental, setParental] = useState<Parental | null>(null)
  const [offline, setOffline] = useState(false)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [eraseName, setEraseName] = useState('')
  const [receipt, setReceipt] = useState<string[] | null>(null)
  const eraseOk = !!alias && eraseName.trim().toLowerCase() === alias.trim().toLowerCase()

  useEffect(() => {
    let alive = true
    call(`${base}/sprite/parental`)
      .then((r) => { if (!alive) return; if (r.ok && r.data) setParental(r.data as Parental); else setOffline(true) })
      .catch(() => { if (alive) setOffline(true) })
    return () => { alive = false }
  }, [call, base])

  const pinOk = pin.length >= 4 && pin.length <= 32

  const toggleChat = async (e: FormEvent) => {
    e.preventDefault()
    if (!parental || !pinOk || busy) return
    setBusy(true)
    const want = !parental.chat_disabled
    const r = await call(`${base}/sprite/parental`, 'PUT', { chat_disabled: want, pin }).catch(() => null)
    setBusy(false)
    if (r?.ok && r.data) {
      setParental(r.data as Parental); setPin('')
      onNote?.(want ? `Sprite chat is off for ${name}.` : `Sprite chat is on for ${name}.`)
    } else if (r?.status === 403) onNote?.('That PIN is not right.')
    else if (r?.status === 429) onNote?.('Too many wrong PINs. Try again later.')
    else if (r?.status === 404) onNote?.(`${name} has no sprite yet.`)
    else onNote?.('Could not change sprite chat.')
  }

  const remove = async () => {
    if (confirm.trim().toLowerCase() !== 'remove' || busy) return
    setBusy(true)
    const r = await call(`${base}/remove`, 'POST', {}).catch(() => null)
    setBusy(false)
    if (r?.ok) { onNote?.(`${name} was removed from Learn.`); onRemoved?.() }
    else onNote?.('Could not remove. Try again in a moment.')
  }

  const erase = async () => {
    if (!eraseOk || busy) return
    setBusy(true)
    const r = await call(`${base}/erase`, 'POST', { confirm: eraseName.trim() }).catch(() => null)
    setBusy(false)
    if (r?.ok) {
      onNote?.(`${name} and all of their records were deleted.`)
      setReceipt(eraseReceipt(r.data as EraseResult))
      onErased?.()
    }
    else if (r?.status === 400) onNote?.(`Type ${name} exactly as shown to confirm.`)
    else onNote?.('Could not delete. Nothing was lost; try again in a moment.')
  }

  if (receipt) {
    return (
      <section style={S.card} data-testid="erase-receipt">
        <SheetHeading label="deleted" title={`${name} was deleted`} />
        <p style={{ ...help, margin: 0 }}>What was deleted:</p>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {receipt.map((line) => <li key={line} style={help}>{line}</li>)}
        </ul>
        <p style={{ ...help, margin: 0 }} data-testid="erase-receipt-kept">
          We keep a note that a deletion happened and when, with no name. If {name} reported an
          AI answer, a copy of that report stays with our safety team so the answer can be fixed.
        </p>
        <div>
          <button type="button" className="al-primary al-focus" style={primary} onClick={() => onRemoved?.()}
            data-testid="erase-receipt-done">
            Done
          </button>
        </div>
      </section>
    )
  }

  return (
    <div style={S.card} data-testid="learner-guard">
      <section style={S.card} data-testid="sprite-chat-lock">
        <SheetHeading label="sprite" title="Sprite chat" />
        {offline ? (
          <p style={{ ...help, margin: 0 }}>Sprite settings are unavailable right now.</p>
        ) : !parental ? (
          <p style={{ ...mono, color: C.faint, margin: 0 }}>loading</p>
        ) : (
          <form onSubmit={toggleChat} style={S.card}>
            <p style={{ ...help, margin: 0 }} data-testid="sprite-chat-state">
              Chat is {parental.chat_disabled ? 'off' : 'on'} for {name}.{' '}
              {parental.pin_set ? 'Enter your PIN to change it.' : 'Choose a PIN (4 or more characters). Only you will know it.'}
            </p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelText}>{parental.pin_set ? 'Your PIN' : 'New PIN'}</span>
              <input type="password" autoComplete="off" value={pin} maxLength={32} className="al-field" style={fieldBox}
                data-testid="sprite-pin" onChange={(e) => setPin(e.target.value)} />
            </label>
            <div>
              <button type="submit" className="al-primary al-focus" style={primary} disabled={!pinOk || busy}
                data-testid="sprite-chat-toggle">
                {parental.chat_disabled ? 'Turn chat on' : 'Turn chat off'}
              </button>
            </div>
          </form>
        )}
      </section>

      {canRemove && <section style={{ ...S.card, borderTop: `1px solid ${C.hairline}`, paddingTop: 14 }} data-testid="remove-learner">
        <SheetHeading label="remove" title={`Remove ${name} from Learn`} />
        <p style={{ ...help, margin: 0 }}>
          {name} can no longer start quests. You can still read past reports. Type remove to confirm.
        </p>
        <div style={S.row}>
          <input value={confirm} placeholder="remove" className="al-field" style={{ ...fieldBox, maxWidth: 200 }}
            data-testid="remove-confirm" onChange={(e) => setConfirm(e.target.value)} />
          <button type="button" className="al-quiet al-focus" style={S.danger} onClick={remove}
            disabled={confirm.trim().toLowerCase() !== 'remove' || busy} data-testid="remove-learner-btn">
            Remove
          </button>
        </div>
      </section>}

      {canRemove && alias && <section style={{ ...S.card, borderTop: `1px solid ${C.hairline}`, paddingTop: 14 }} data-testid="erase-learner">
        <SheetHeading label="delete" title={`Delete ${name} permanently`} />
        <p style={{ ...help, margin: 0 }}>
          Deletes {name}&apos;s profile, account, devices, sprite, Space and every record, including
          past reports. This cannot be undone. Type {name} to confirm.
        </p>
        <div style={S.row}>
          <input value={eraseName} placeholder={alias} className="al-field" style={{ ...fieldBox, maxWidth: 200 }}
            data-testid="erase-confirm" onChange={(e) => setEraseName(e.target.value)} />
          <button type="button" className="al-quiet al-focus" style={S.danger} onClick={erase}
            disabled={!eraseOk || busy} data-testid="erase-learner-btn">
            Delete permanently
          </button>
        </div>
      </section>}
    </div>
  )
}
