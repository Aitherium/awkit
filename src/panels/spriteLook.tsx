/**
 * One Sprite look on every surface (kids suite S6).
 *
 * A child's Sprite is drawn from its SpriteDesign v2 by ONE art set: the layered vector
 * Sprites (spriteVector.ts, "sprites v2"). A surface that has the design draws it directly;
 * the host may still PROVIDE a live renderer through <SpriteRendererProvider> (Veil draws the
 * signed-in child's own design with the same vector art and keeps its snapshot current). A
 * surface with only the card's `snapshot` key fetches the SNAPSHOT: the Sprite's design as the
 * server cleaned and stored it (AitherSprite /snapshots/<key>.json, readable only inside the
 * child's own household) and draws it with the same vector art. No picture a device drew is
 * ever stored or served. All of these are the same creature.
 *
 * Nothing else stands in for it: no emoji, no CSS blob, no stock art. With neither a renderer
 * nor a snapshot the Sprite is "waking up" (a soft glowing ring).
 *
 * spritePerf (the measured fallback) lives beside this: perfVerdict decides, from the first
 * three seconds of frame times, whether a device keeps the live creature or drops to the
 * snapshot with a CSS breathe.
 */
import { createContext, useContext, useEffect, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import type { VectorSpriteDesign } from './spriteVector'
import { SpriteVector } from './SpriteVectorView'

/** What a surface knows about a Sprite (the tutor/teacher card shape). */
export interface SpriteCardLike {
  name?: string | null
  species?: string | null
  stage?: string | null
  /** AitherSprite snapshot content key (64 hex): the Sprite's cleaned design, in-household. */
  snapshot?: string | null
  /** The SpriteDesign v2 itself, when the surface has it: drawn as the vector Sprite. */
  design?: VectorSpriteDesign | null
}

export interface SpriteRendererProps {
  sprite: SpriteCardLike
  height: number
  /** a reaction to play once (changes with actionKey) */
  action?: string
  actionKey?: number
  label?: string
}

/** The host's live renderer (Veil wires creature3d), or null: then surfaces show the snapshot. */
export const SpriteRendererContext = createContext<ComponentType<SpriteRendererProps> | null>(null)

export function SpriteRendererProvider({ renderer, children }: { renderer: ComponentType<SpriteRendererProps> | null; children: ReactNode }) {
  return <SpriteRendererContext.Provider value={renderer}>{children}</SpriteRendererContext.Provider>
}

export const SNAPSHOT_KEY_RE = /^[0-9a-f]{64}$/

/** The snapshot's URL through the host's sprite proxy, or null for anything that is not a key.
 *  A snapshot is the Sprite's cleaned DESIGN (JSON), read only inside its own household; the
 *  picture is drawn here with the vector art. No client-drawn pixels are ever served. */
export function snapshotSrc(key: unknown, apiBase = '/api/sprite'): string | null {
  return typeof key === 'string' && SNAPSHOT_KEY_RE.test(key) ? `${apiBase}/snapshots/${key}.json` : null
}

const designCache = new Map<string, VectorSpriteDesign | null>()

export const SPRITE_LOOK_CSS = `
@keyframes awk-sprite-breathe { 0%, 100% { transform: translateY(0) scale(1, 1) } 50% { transform: translateY(-3%) scale(1.02, 0.985) } }
@keyframes awk-sprite-wake { 0%, 100% { opacity: .45 } 50% { opacity: 1 } }
.awk-sprite-breathe { animation: awk-sprite-breathe 3.4s ease-in-out infinite; transform-origin: 50% 90%; }
@media (prefers-reduced-motion: reduce) { .awk-sprite-breathe, .awk-sprite-wake { animation: none !important; } }
`

/** The Sprite while there is nothing to draw yet: a soft glowing ring, never a stand-in creature. */
export function SpriteWaking({ size, label }: { size: number; label?: string }) {
  const ring: CSSProperties = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box',
    border: `${Math.max(2, Math.round(size / 24))}px solid rgba(143, 227, 255, .55)`,
    boxShadow: '0 0 24px rgba(143, 227, 255, .35), inset 0 0 18px rgba(143, 227, 255, .25)',
    animation: 'awk-sprite-wake 2.4s ease-in-out infinite',
  }
  return (
    <span role="img" aria-label={label ? `${label} is waking up` : 'Waking up'} data-testid="sprite-waking" data-look="waking" className="awk-sprite-wake" style={ring}>
      <style>{SPRITE_LOOK_CSS}</style>
    </span>
  )
}

/** The Sprite from its snapshot (the cleaned design, fetched in-household and drawn with the
 *  vector art), breathing gently. Waking until it arrives; waking if it cannot be read. */
export function SpriteSnapshot({ sprite, size, apiBase, breathe = true }: { sprite: SpriteCardLike; size: number; apiBase?: string; breathe?: boolean }) {
  const src = snapshotSrc(sprite.snapshot, apiBase)
  const [design, setDesign] = useState<VectorSpriteDesign | null>(() => (src && designCache.get(src)) || null)
  useEffect(() => {
    if (!src) return
    if (designCache.has(src)) { setDesign(designCache.get(src) || null); return }
    let off = false
    fetch(src, { credentials: 'same-origin' }).then(async (r) => {
      const j = r.ok ? await r.json().catch(() => null) : null
      const d = j && typeof j.design === 'object' ? (j.design as VectorSpriteDesign) : null
      designCache.set(src, d)
      if (!off) setDesign(d)
    }).catch(() => undefined)
    return () => { off = true }
  }, [src])
  const label = sprite.name || 'Sprite'
  if (!src || !design) return <SpriteWaking size={size} label={label} />
  return (
    <span data-testid="sprite-snapshot" data-look="snapshot" style={{ display: 'inline-grid', placeItems: 'center', width: size, height: size, flexShrink: 0 }}>
      <style>{SPRITE_LOOK_CSS}</style>
      <SpriteVector design={design} size={size} label={label} shadow={size > 48} className={breathe ? 'awk-sprite-breathe' : undefined} />
    </span>
  )
}

/**
 * THE Sprite on any awkit surface. `live` asks for the host's 3D renderer (use it for the one
 * big Sprite on a screen: a scene shows at most one live creature); everything else, and every
 * host without a renderer, gets the snapshot.
 */
export function SpriteFace({ sprite, size, live = false, apiBase, action, actionKey }: {
  sprite?: SpriteCardLike | null
  size: number
  live?: boolean
  apiBase?: string
  action?: string
  actionKey?: number
}) {
  const Renderer = useContext(SpriteRendererContext)
  if (!sprite) return <SpriteWaking size={size} />
  if (live && Renderer) {
    return (
      <span data-testid="sprite-live" data-look="live" style={{ display: 'block', width: size, height: size, flexShrink: 0 }}>
        <Renderer sprite={sprite} height={size} action={action} actionKey={actionKey} label={sprite.name || undefined} />
      </span>
    )
  }
  if (sprite.design) {
    return (
      <span data-testid="sprite-vector-face" data-look="vector" style={{ display: 'inline-grid', placeItems: 'center', width: size, height: size, flexShrink: 0 }}>
        <style>{SPRITE_LOOK_CSS}</style>
        <SpriteVector design={sprite.design} expression={expressionFor(action)} size={size} label={sprite.name || undefined}
          shadow={size > 48} className="awk-sprite-breathe" />
      </span>
    )
  }
  return <SpriteSnapshot sprite={sprite} size={size} apiBase={apiBase} />
}

/** A surface's action or mood word as one of the vector Sprite's six expressions. Pure. */
export function expressionFor(action?: string): string {
  switch (action) {
    case 'happy': case 'cheer': case 'joyful': case 'wiggle': case 'spin': return 'happy'
    case 'think': case 'curious': return 'curious'
    case 'sleepy': return 'sleepy'
    case 'proud': case 'nod': return 'proud'
    case 'surprised': return 'surprised'
    default: return 'content'
  }
}
