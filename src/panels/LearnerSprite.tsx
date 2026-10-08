/**
 * Aither Learn sprite pieces (gap 6).
 *
 * - KidSpriteCard: the child's own learning buddy on the /learn home. Name, level and
 *   the latest thing it learned. Never needs, hunger, mood numbers, streaks or "I
 *   missed you": the server keeps a child's sprite in learner mode (no decay, no guilt).
 * - LearnerSpriteButton / SpriteOfferCard: the guardian's "Hatch a sprite" action.
 *   POST /family/learners/{lid}/sprite is idempotent and the sprite is private. The
 *   same POST converts a sprite the child already had into a learning buddy, so an
 *   existing non-learner sprite gets a "Make it a learning buddy" button.
 */
import { useState, type CSSProperties } from 'react'
import { C, FONT_MONO, FONT_UI } from './learnTheme'

export interface KidSprite {
  name?: string
  species?: string
  stage?: string
  stage_word?: string
  level?: number
  knowledge_count?: number
  latest_learned?: string | null
  /** false = an ordinary sprite the child already had (decay, whispers); true = learner buddy. */
  learner_mode?: boolean
}

const SPECIES_EMOJI: Record<string, string> = {
  sprout: '🌱', fox: '🦊', owl: '🦉', bunny: '🐰', dragon: '🐲', turtle: '🐢', cat: '🐱', otter: '🦦',
}

export function spriteEmoji(sprite?: KidSprite | null): string {
  if (!sprite) return '🌱'
  if (sprite.stage === 'egg') return '🥚'
  return SPECIES_EMOJI[String(sprite.species || '')] ?? '🌱'
}

/** The kid's sprite on the home screen: the hero. Name, level and the latest thing
 *  it learned, in a soft accent glow. Renders nothing without a sprite. `face={false}`
 *  leaves the emoji out where the page draws the Sprite's body itself (My Sprite). */
export function KidSpriteCard({ sprite, face = true }: { sprite?: KidSprite | null; face?: boolean }) {
  if (!sprite || !sprite.name) return null
  const level = Math.max(1, Number(sprite.level ?? 1))
  return (
    <div data-testid="kid-sprite-card" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%', textAlign: 'center',
    }}>
      {face ? <div aria-hidden className="al-glow" style={{
        width: 148, height: 148, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 76, lineHeight: 1, background: C.accentWash, border: `1px solid ${C.hairline}`,
        boxShadow: `0 0 48px ${C.accentGlow}`,
      }}>{spriteEmoji(sprite)}</div> : null}
      <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.02em', color: C.ink }}>{sprite.name}</div>
      <div data-testid="kid-sprite-level" style={{
        fontFamily: FONT_MONO, fontSize: 14, letterSpacing: '.18em', textTransform: 'lowercase', color: C.dim,
      }}>
        {sprite.stage_word ? `${sprite.stage_word} · ` : ''}Level {level}
      </div>
      {sprite.latest_learned ? (
        <div data-testid="kid-sprite-latest" style={{ fontSize: 20, color: C.ink }}>Just learned: {sprite.latest_learned}</div>
      ) : (
        <div style={{ fontSize: 20, color: C.dim }}>Ready to learn with you!</div>
      )}
    </div>
  )
}

type Call = (path: string, method?: string, body?: object) => Promise<{ status: number; ok: boolean; data: unknown }>

/** Quiet link-style action for the guardian console: hairline pill, 44px target. */
const BTN: CSSProperties = {
  minHeight: 44, padding: '0 14px', borderRadius: 999, border: `1px solid ${C.hairline}`,
  background: 'transparent', color: C.dim, cursor: 'pointer', fontFamily: FONT_UI, fontSize: 14,
  display: 'inline-flex', alignItems: 'center', gap: 6,
}
const NOTE: CSSProperties = { fontSize: 13, color: C.dim, fontFamily: FONT_UI }

/** Guardian: "Hatch a sprite" for one learner, or the sprite's name once it exists. */
export function LearnerSpriteButton({ call, lid, sprite, onDone }: {
  call: Call
  lid: string
  sprite?: KidSprite | null
  onDone?: (sprite: KidSprite) => void
}) {
  const [mine, setMine] = useState<KidSprite | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const shown = mine || sprite
  const hatch = async () => {
    setBusy(true); setNote(null)
    const r = await call(`/family/learners/${encodeURIComponent(lid)}/sprite`, 'POST', {}).catch(() => null)
    setBusy(false)
    const s = (r?.data as { sprite?: KidSprite } | null)?.sprite
    if (r?.ok && s) { setMine(s); onDone?.(s); return }
    setNote(r?.status === 409 ? 'Pair or connect first' : 'Could not hatch right now')
  }
  if (shown && shown.name) {
    const label = (
      <span data-testid={`sprite-of-${lid}`} style={{ fontSize: 13, color: C.dim, fontFamily: FONT_UI }}>
        {shown.name} · level {Math.max(1, Number(shown.level ?? 1))}
      </span>
    )
    if (shown.learner_mode !== false) return label
    return (
      <>
        {label}
        <button type="button" className="al-quiet al-focus" style={BTN} disabled={busy} onClick={hatch} data-testid={`convert-sprite-${lid}`}
          title="Keeps its name and level; turns off hunger, sulking and reminders; keeps what it learns private">
          Make it a learning buddy
        </button>
        {note && <span style={NOTE}>{note}</span>}
      </>
    )
  }
  return (
    <>
      <button type="button" className="al-quiet al-focus" style={BTN} disabled={busy} onClick={hatch} data-testid={`hatch-sprite-${lid}`}>
        Hatch a sprite
      </button>
      {note && <span style={NOTE}>{note}</span>}
    </>
  )
}

/** Shown right after "Add child": offer the private learning sprite. */
export function SpriteOfferCard({ call, lid, name, onClose }: {
  call: Call
  lid: string
  name: string
  onClose: () => void
}) {
  return (
    <div data-testid="sprite-offer" className="al-in" style={{
      border: `1px solid ${C.hairline}`, borderRadius: 16, padding: 18, background: C.surface, color: C.ink,
      display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontFamily: FONT_UI,
    }}>
      <div aria-hidden className="al-glow" style={{
        width: 52, height: 52, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, background: C.accentWash, boxShadow: `0 0 24px ${C.accentGlow}`, flexShrink: 0,
      }}>{spriteEmoji(null)}</div>
      <div style={{ flex: '1 1 220px', fontSize: 15, lineHeight: 1.5 }}>
        Give {name} a learning sprite? It is private to {name}, learns each skill they master, and
        never gets hungry, sad or sulky.
      </div>
      <LearnerSpriteButton call={call} lid={lid} />
      <button type="button" className="al-quiet al-focus" style={{ ...BTN, border: 'none' }} onClick={onClose}>Not now</button>
    </div>
  )
}
