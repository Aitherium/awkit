/**
 * SpriteCosmeticsCard — dress the sprite from its cosmetic catalog.
 *
 * Backed by lib/companion/SpriteCosmetics.py via /me/cosmetics,
 * /me/cosmetics/equip and /me/cosmetics/unequip. The server owns ownership and
 * slot rules (one item per slot; premium items need the sprite_cosmetics
 * entitlement and answer 402 without it); this card only shows the catalog and
 * sends the owner's choice.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'

export interface CosmeticItem {
  id: string
  name: string
  slot: string
  tier: string
  owned: boolean
  equipped: boolean
}

export interface CosmeticsView {
  entitled: boolean
  entitlement: string
  equipped: string[]
  inactive: string[]
  catalog: CosmeticItem[]
}

/** A body is a wardrobe only if it carries the catalog. Anything else (an older
 * service, a proxy error page, a mock that answers every URL with the status) must
 * leave the card hidden -- a throw here would take the whole SpritePanel down. */
function asView(data: unknown): CosmeticsView | null {
  const d = data as Partial<CosmeticsView> | null
  if (!d || !Array.isArray(d.catalog)) return null
  return {
    entitled: Boolean(d.entitled),
    entitlement: String(d.entitlement ?? ''),
    equipped: Array.isArray(d.equipped) ? d.equipped : [],
    inactive: Array.isArray(d.inactive) ? d.inactive : [],
    catalog: d.catalog,
  }
}

export interface SpriteCosmeticsCardProps {
  apiBase: string
  extraHeaders?: Record<string, string>
  name: string
}

export default function SpriteCosmeticsCard({ apiBase, extraHeaders: extraHeadersProp, name }: SpriteCosmeticsCardProps) {
  // Content-keyed headers, the same guard SpriteGuideCard needs: a fresh object per
  // render would re-create `load` and re-fire the effect after every setView.
  const headersKey = JSON.stringify(extraHeadersProp ?? {})
  const extraHeaders = useMemo<Record<string, string>>(() => JSON.parse(headersKey), [headersKey])
  const [view, setView] = useState<CosmeticsView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/me/cosmetics`, { headers: extraHeaders })
      if (r.ok) setView(asView(await r.json().catch(() => null)))
    } catch { /* the card simply stays hidden */ }
  }, [apiBase, extraHeaders])

  useEffect(() => { load() }, [load])

  const toggle = async (item: CosmeticItem) => {
    const verb = item.equipped ? 'unequip' : 'equip'
    setBusy(item.id)
    setNote(null)
    try {
      const r = await fetch(`${apiBase}/me/cosmetics/${verb}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: JSON.stringify({ cosmetic_id: item.id }),
      })
      const data = await r.json().catch(() => null)
      const next = r.ok ? asView(data) : null
      if (next) {
        setView(next)
      } else if (r.status === 402) {
        setNote(`${item.name} is a premium cosmetic — it comes with Sprite Plus or Family.`)
      } else if (data?.detail) {
        setNote(String(data.detail))
      }
    } catch {
      setNote('The wardrobe could not be reached.')
    } finally {
      setBusy(null)
    }
  }

  if (!view || view.catalog.length === 0) return null

  const slots = Array.from(new Set(view.catalog.map(c => c.slot)))
  const chip = (item: CosmeticItem): CSSProperties => ({
    padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: item.equipped ? 'var(--accent-primary)' : 'var(--bg-elevated)',
    color: item.equipped ? 'var(--text-on-accent, #fff)' : 'var(--text-primary)',
    opacity: item.owned ? 1 : 0.6,
    cursor: busy ? 'wait' : 'pointer', fontSize: '0.85rem',
  })

  return (
    <div
      data-testid="sprite-cosmetics"
      style={{
        marginTop: 14, padding: 12, borderRadius: 10,
        border: '1px solid var(--border)', background: 'var(--bg-card, var(--bg-elevated))',
      }}
    >
      <strong style={{ color: 'var(--text-primary)' }}>Wardrobe</strong>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: 2 }}>
        Dress {name} — one item per slot.
      </div>
      {slots.map(slot => (
        <div key={slot} style={{ marginTop: 8 }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'capitalize' }}>
            {slot}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {view.catalog.filter(c => c.slot === slot).map(item => (
              <button
                key={item.id}
                disabled={busy !== null}
                onClick={() => toggle(item)}
                style={chip(item)}
                aria-pressed={item.equipped}
                title={item.owned ? (item.equipped ? 'Take it off' : 'Put it on') : 'Premium — Sprite Plus or Family'}
              >
                {item.name}{item.owned ? '' : ' 🔒'}
              </button>
            ))}
          </div>
        </div>
      ))}
      {view.inactive.length > 0 && (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: 8 }}>
          {view.inactive.length} premium item{view.inactive.length === 1 ? '' : 's'} put away until the plan is back.
        </div>
      )}
      {note && (
        <div role="status" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 8 }}>
          {note}
        </div>
      )}
    </div>
  )
}
