/**
 * SpriteGuideCard — the sprite's spirit guide + training loop.
 *
 * Backed by lib/companion/SpriteGuide.py via /me/guide, /me/guide/beat,
 * /me/guide/answer, /me/train, /me/challenge and /me/charms. The server owns
 * every rule; this card only shows state and sends the owner's choices.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'

interface GuideOffer { act: string; stat?: string; foe?: string }

interface GuideView {
  temperament: 'bright' | 'wavering' | 'shadowed'
  available_acts: string[]
  offer: GuideOffer | null
  stats: Record<string, number>
  stat_cap: number
  ladder: { rung: number; of: number; next_foe: string | null; wins: number; losses: number }
  charms: string[]
  equipped: string[]
  result?: Record<string, unknown>
}

export interface SpriteGuideCardProps {
  apiBase: string
  extraHeaders?: Record<string, string>
  name: string
  /** Called after any action so the parent can refresh the needs bars. */
  onChange?: () => void
}

const STATS = ['strength', 'dexterity', 'speed'] as const
const STAT_ICON: Record<string, string> = { strength: '💪', dexterity: '🎯', speed: '💨' }
const TEMPER_ICON: Record<string, string> = { bright: '✨', wavering: '🌗', shadowed: '🌑' }
const CHARM_ICON: Record<string, string> = {
  ember: '🔥', feather: '🪶', thorn: '🌵', bramble: '🌿', hearth: '🏠', lantern: '🏮',
}

function describe(result: Record<string, unknown> | undefined, name: string): string | null {
  if (!result) return null
  if (typeof result.line === 'string') return result.line
  const outcome = (result.outcome ?? result) as Record<string, unknown>
  if (typeof outcome.foe === 'string') {
    if (outcome.won) return `${name} beat ${outcome.foe} in ${outcome.rounds} rounds!`
    return outcome.charm
      ? `${name} lost to ${outcome.foe}… but found a ${outcome.charm} charm.`
      : `${name} lost to ${outcome.foe}. Train and try again.`
  }
  if (typeof outcome.stat === 'string') {
    return `${outcome.stat} +${outcome.gain} → ${outcome.value}/${outcome.cap}`
  }
  if (result.accepted === false) return `${name} lets it go.`
  return null
}

export default function SpriteGuideCard({ apiBase, extraHeaders: extraHeadersProp, name, onChange }: SpriteGuideCardProps) {
  // A fresh headers object per render made `load` a new function per render, and the
  // load effect re-fired after every setView: a /me/guide request loop. Key on content.
  const headersKey = JSON.stringify(extraHeadersProp ?? {})
  const extraHeaders = useMemo<Record<string, string>>(() => JSON.parse(headersKey), [headersKey])
  const [view, setView] = useState<GuideView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/me/guide`, { headers: extraHeaders })
      if (r.ok) setView(await r.json())
    } catch { /* the card simply stays hidden */ }
  }, [apiBase, extraHeaders])

  useEffect(() => { load() }, [load])

  const post = async (path: string, tag: string, body?: object) => {
    setBusy(tag)
    try {
      const r = await fetch(`${apiBase}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await r.json().catch(() => null)
      if (r.ok && data) {
        setView(data)
        setNote(describe(data.result, name))
        onChange?.()
      } else if (data?.detail) {
        setNote(String(data.detail))
      }
    } catch {
      setNote('The guide could not be reached.')
    } finally {
      setBusy(null)
    }
  }

  if (!view) return null
  const toggleCharm = (c: string) => {
    const next = view.equipped.includes(c)
      ? view.equipped.filter(x => x !== c)
      : [...view.equipped, c].slice(-2)
    post('/me/charms', 'charms', { charms: next })
  }
  const btn = (active: boolean): CSSProperties => ({
    padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: active ? 'var(--accent-primary)' : 'var(--bg-elevated)',
    color: active ? 'var(--text-on-accent, #fff)' : 'var(--text-primary)',
    cursor: busy ? 'wait' : 'pointer', fontSize: '0.85rem',
  })

  return (
    <div style={{
      marginTop: 14, padding: 12, borderRadius: 10,
      border: '1px solid var(--border)', background: 'var(--bg-card, var(--bg-elevated))',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ color: 'var(--text-primary)' }}>
          {TEMPER_ICON[view.temperament]} Spirit guide · {view.temperament}
        </strong>
        <button
          disabled={busy !== null || view.available_acts.length === 0}
          onClick={() => post('/me/guide/beat', 'beat', {})}
          style={btn(view.available_acts.length > 0)}
          title={view.available_acts.length ? 'Let the guide choose today’s act' : 'The guide has acted today'}
        >
          {view.available_acts.length ? 'Today’s act' : 'Acted today'}
        </button>
      </div>

      {view.offer && (
        <div style={{ marginTop: 10, padding: 8, borderRadius: 8, background: 'var(--bg-deep)' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {view.offer.act === 'spar'
              ? `${name} wants to spar and train ${view.offer.stat}.`
              : `${name} wants to take on ${view.offer.foe}.`}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button disabled={busy !== null} style={btn(true)}
              onClick={() => post('/me/guide/answer', 'answer', { accept: true })}>Yes</button>
            <button disabled={busy !== null} style={btn(false)}
              onClick={() => post('/me/guide/answer', 'answer', { accept: false })}>Not today</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
        {STATS.map(s => (
          <button key={s} disabled={busy !== null} onClick={() => post('/me/train', `train-${s}`, { stat: s })}
            style={{ ...btn(false), textAlign: 'left' }}>
            {STAT_ICON[s]} {s}
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {view.stats[s] ?? 0} / {view.stat_cap}
            </div>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          {view.ladder.next_foe
            ? `Rung ${view.ladder.rung}/${view.ladder.of}: ${view.ladder.next_foe}`
            : 'Ladder cleared'}
          {' '}· {view.ladder.wins}W {view.ladder.losses}L
        </span>
        <button disabled={busy !== null || !view.ladder.next_foe} style={btn(true)}
          onClick={() => post('/me/challenge', 'challenge')}>⚔️ Challenge</button>
      </div>

      {view.charms.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {view.charms.map(c => (
            <button key={c} disabled={busy !== null} onClick={() => toggleCharm(c)}
              style={btn(view.equipped.includes(c))}
              title={view.equipped.includes(c) ? 'Worn: click to remove' : 'Click to wear (max 2)'}>
              {CHARM_ICON[c] ?? '🔹'} {c}
            </button>
          ))}
        </div>
      )}

      {note && (
        <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{note}</div>
      )}
    </div>
  )
}
