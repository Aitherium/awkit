/**
 * CoGuardiansCard: share one child with another adult on the same workspace (Aither Learn).
 *
 * - GET {apiBase}/family/learners/{lid}/co-guardians -> { can_manage, co_guardians, candidates }.
 *   Only the guardian of record gets can_manage; for anyone else this card renders nothing.
 * - POST .../co-guardians { member_user_id } shares the child; POST .../co-guardians/remove
 *   { member_user_id } stops sharing. The server matches the id against the caller's OWN
 *   roster (user_id only) and refuses everyone else, so this card holds no authority logic.
 * - A co-guardian sees and steers the child but cannot share further or remove the child.
 */
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { C, FONT_MONO, FONT_UI } from './learnTheme'
import { SheetHeading, fieldBox, help, labelText, mono, primary, quiet } from './learnParts'

type Call = (path: string, method?: string, body?: object) => Promise<{ status: number; ok: boolean; data: unknown }>

export interface CoGuardiansCardProps {
  call: Call
  lid: string
  alias?: string
  onNote?: (message: string) => void
}

interface Person { user_id: string; display_name?: string; added_at?: string }
interface CoView { can_manage?: boolean; co_guardians?: Person[]; candidates?: Person[] | null }

const S: Record<string, CSSProperties> = {
  card: {
    display: 'flex', flexDirection: 'column', gap: 12, fontFamily: FONT_UI, color: C.ink,
    borderTop: `1px solid ${C.hairline}`, paddingTop: 14,
  },
  row: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  item: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0' },
  id: { fontFamily: FONT_MONO, fontSize: 11, color: C.faint, letterSpacing: '.04em' },
}

function nameOf(p: Person): string {
  return (p.display_name || '').trim() || p.user_id
}

export default function CoGuardiansCard({ call, lid, alias, onNote }: CoGuardiansCardProps) {
  const name = alias || 'this child'
  const base = `/family/learners/${encodeURIComponent(lid)}/co-guardians`
  const [view, setView] = useState<CoView | null>(null)
  const [entry, setEntry] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    call(base)
      .then((r) => { if (alive && r.ok && r.data) setView(r.data as CoView) })
      .catch(() => { /* hidden when unreachable: sharing is an extra, never a blocker */ })
    return () => { alive = false }
  }, [call, base])

  if (!view || !view.can_manage) return null
  const people = view.co_guardians || []
  const candidates = view.candidates || []

  /** A typed display name resolves to its roster user id; anything else is sent as an id. */
  const resolve = (raw: string): string => {
    const v = raw.trim()
    const byName = candidates.filter((c) => nameOf(c).toLowerCase() === v.toLowerCase())
    return byName.length === 1 ? byName[0].user_id : v
  }

  const share = async (e: FormEvent) => {
    e.preventDefault()
    const member = resolve(entry)
    if (!member || busy) return
    setBusy(true)
    const r = await call(base, 'POST', { member_user_id: member }).catch(() => null)
    setBusy(false)
    if (r?.ok && r.data) {
      const shared = (r.data as CoView).co_guardians || []
      setView({ ...view, co_guardians: shared, candidates: candidates.filter((c) => c.user_id !== member) })
      setEntry('')
      const who = shared.find((p) => p.user_id === member)
      onNote?.(`${who ? nameOf(who) : 'They'} can now see and help with ${name}.`)
    } else if (r?.status === 422) onNote?.('Only people already in your workspace can be added.')
    else if (r?.status === 409) onNote?.(`They already help with ${name}.`)
    else onNote?.('Could not share. Try again in a moment.')
  }

  const unshare = async (p: Person) => {
    if (busy) return
    setBusy(true)
    const r = await call(`${base}/remove`, 'POST', { member_user_id: p.user_id }).catch(() => null)
    setBusy(false)
    if (r?.ok) {
      setView({ ...view, co_guardians: people.filter((x) => x.user_id !== p.user_id), candidates: [...candidates, p] })
      onNote?.(`${nameOf(p)} no longer sees ${name}.`)
    } else onNote?.('Could not stop sharing. Try again in a moment.')
  }

  const listId = `co-guardian-candidates-${lid}`
  return (
    <section style={S.card} data-testid="co-guardians">
      <SheetHeading label="co-guardians" title={`Who else helps with ${name}`} />
      <p style={{ ...help, margin: 0 }}>
        Another adult in your workspace can see reports and change settings for {name}. Only you can add or remove them, or remove {name}.
      </p>
      {people.length === 0 ? (
        <div style={{ ...mono, color: C.faint }} data-testid="co-guardians-empty">just you</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }} data-testid="co-guardians-list">
          {people.map((p, i) => (
            <li key={p.user_id} style={{ ...S.item, borderTop: i ? `1px solid ${C.hairline}` : 'none' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>{nameOf(p)}</span>
                <span style={S.id}>{p.user_id}</span>
              </span>
              <button type="button" className="al-quiet al-focus" style={quiet} disabled={busy}
                data-testid={`co-guardian-remove-${p.user_id}`} onClick={() => unshare(p)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={share} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelText}>Add someone from your workspace</span>
          <input value={entry} list={listId} maxLength={128} autoComplete="off" className="al-field"
            placeholder={candidates.length ? 'pick or type a name' : 'workspace member id'}
            style={fieldBox} data-testid="co-guardian-input" onChange={(e) => setEntry(e.target.value)} />
          <datalist id={listId}>
            {candidates.map((c) => <option key={c.user_id} value={c.user_id}>{nameOf(c)}</option>)}
          </datalist>
        </label>
        {view.candidates === null && (
          <span style={{ ...mono, color: C.faint }}>workspace list unavailable · type their member id</span>
        )}
        <div style={S.row}>
          <button type="submit" className="al-primary al-focus" style={primary} disabled={!entry.trim() || busy}
            data-testid="co-guardian-add">
            Share {name}
          </button>
        </div>
      </form>
    </section>
  )
}
