'use client'

import React from 'react'

export interface PackCardPack {
  id: string
  type: string
  name: string
  description: string
  category: string
  version: string
  author: string
  icon_url: string
  pricing_onetime: number
  pricing_monthly: number
  rating: number
  download_count: number
  tags: string[]
  status: string
}

export interface PackCardProps {
  pack: PackCardPack
  selected?: boolean
  owned?: boolean
  onSelect?: (pack: PackCardPack) => void
  onPurchase?: (pack: PackCardPack) => void
  compact?: boolean
}

function formatPrice(pack: PackCardPack): string {
  if (!pack.pricing_onetime && !pack.pricing_monthly) return 'Free'
  if (pack.pricing_onetime) return `$${pack.pricing_onetime}`
  if (pack.pricing_monthly) return `$${pack.pricing_monthly}/mo`
  return 'Paid'
}

function typeColor(type: string): { bg: string; fg: string } {
  switch (type) {
    case 'agent': return { bg: '#1a2a3a', fg: '#60a5fa' }
    case 'skill': return { bg: '#2a1a3a', fg: '#a78bfa' }
    case 'tool': return { bg: '#1a3a2a', fg: '#4ade80' }
    default: return { bg: '#2a2a2a', fg: '#888' }
  }
}

function StarRating({ rating }: { rating: number }) {
  const stars = Math.round(rating * 2) / 2
  return (
    <span style={{ fontSize: 11, color: '#fbbf24', letterSpacing: 1 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <span key={i} style={{ opacity: i <= stars ? 1 : 0.25 }}>&#9733;</span>
      ))}
      <span style={{ color: '#888', marginLeft: 4 }}>{rating.toFixed(1)}</span>
    </span>
  )
}

export default function PackCard({
  pack, selected, owned, onSelect, onPurchase, compact,
}: PackCardProps) {
  const tc = typeColor(pack.type)
  const isFree = !pack.pricing_onetime && !pack.pricing_monthly

  return (
    <div
      onClick={() => onSelect?.(pack)}
      style={{
        background: selected ? 'var(--bg-active, #1a2a4a)' : 'var(--bg-surface, #16162a)',
        border: `1px solid ${selected ? 'var(--accent, #6366f1)' : 'var(--glass-border, #2a2a4a)'}`,
        borderRadius: 'var(--radius, 10px)',
        padding: compact ? 12 : 16,
        display: 'flex',
        flexDirection: 'column',
        cursor: onSelect ? 'pointer' : 'default',
        transition: 'border-color 0.15s, background 0.15s',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Header: icon + name + type badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: compact ? 32 : 40, height: compact ? 32 : 40,
          borderRadius: 8, background: tc.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: compact ? 16 : 20, flexShrink: 0,
        }}>
          {pack.icon_url
            ? <img src={pack.icon_url} alt="" style={{ width: '100%', height: '100%', borderRadius: 8, objectFit: 'cover' }} />
            : pack.type === 'agent' ? '\uD83E\uDD16' : pack.type === 'skill' ? '\u26A1' : '\uD83D\uDD27'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: compact ? 13 : 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {pack.name}
            </strong>
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 12,
              background: tc.bg, color: tc.fg, textTransform: 'capitalize',
            }}>
              {pack.type}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted, #888)', marginTop: 2 }}>
            by {pack.author} &middot; v{pack.version}
          </div>
        </div>
      </div>

      {/* Description */}
      {!compact && (
        <p style={{
          fontSize: 12, color: 'var(--text-muted, #888)',
          margin: '0 0 10px', flex: 1,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {pack.description}
        </p>
      )}

      {/* Tags */}
      {!compact && pack.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
          {pack.tags.slice(0, 4).map(tag => (
            <span key={tag} style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 8,
              background: 'var(--bg-deep, #111)', color: 'var(--text-muted, #777)',
            }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer: rating + price/action */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: compact ? 4 : 0 }}>
        <StarRating rating={pack.rating} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {pack.download_count > 0 && (
            <span style={{ fontSize: 10, color: '#666' }}>
              {pack.download_count > 999 ? `${(pack.download_count / 1000).toFixed(1)}k` : pack.download_count} downloads
            </span>
          )}
          {owned ? (
            <span style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 12,
              background: '#1a3a1a', color: '#4ade80',
            }}>
              Owned
            </span>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); onPurchase?.(pack) }}
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 12, border: 'none',
                background: isFree ? '#1a2a3a' : '#3a2a1a',
                color: isFree ? '#60a5fa' : '#fbbf24',
                cursor: 'pointer', fontWeight: 600,
              }}
            >
              {isFree ? 'Free' : formatPrice(pack)}
            </button>
          )}
        </div>
      </div>

      {/* Selection indicator */}
      {selected && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          width: 20, height: 20, borderRadius: '50%',
          background: 'var(--accent, #6366f1)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700,
        }}>
          &#10003;
        </div>
      )}
    </div>
  )
}
