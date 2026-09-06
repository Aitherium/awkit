/**
 * BrandPanel — view & manage the active brand pack.
 *
 * Reads the live theme/brand from the ThemeProvider context and lets the
 * operator regenerate the palette + logo via the Iris design agent.
 *
 * Now brand-guide-aware: shows gradients, brand identity (Ai symbol),
 * typography samples, and asset inventory from .ELEMENT/brand.yaml.
 *
 * Backend endpoints:
 *   GET  /api/brand              -> { brand, theme, source, tokens? }
 *   POST /api/brand/regenerate   -> kicks Iris (design_system_generate)
 */

import { useEffect, useState } from 'react'
import { useTheme } from './ThemeProvider'
import type { BrandTokens } from '../lib/brandTokens'

interface RegenerateResponse {
  ok?: boolean
  job_id?: string
  message?: string
  theme?: unknown
}

export interface BrandPanelProps {
  /** Override the backend base URL (default: empty -> same origin). */
  baseUrl?: string
  /** Hide the regenerate button (read-only mode). */
  readOnly?: boolean
  /** Pre-loaded brand tokens (skip fetch). */
  tokens?: BrandTokens
}

export function BrandPanel({ baseUrl = '', readOnly = false, tokens: tokensProp }: BrandPanelProps) {
  const { theme, brand, refresh } = useTheme()
  const [regenStatus, setRegenStatus] = useState<string | null>(null)
  const [regenPrompt, setRegenPrompt] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [tokens, setTokens] = useState<BrandTokens | null>(tokensProp ?? null)

  // Load brand tokens from backend if not provided
  useEffect(() => {
    if (tokensProp) return
    fetch(`${baseUrl}/api/brand`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.tokens) setTokens(data.tokens)
      })
      .catch(() => {})
  }, [baseUrl, tokensProp])

  const palette = theme?.palette ?? {}
  const accent = palette.accent_primary ?? 'var(--accent-primary)'
  const accent2 = palette.accent_secondary ?? 'var(--accent-secondary, #7C4DFF)'
  const identity = tokens?.identity
  const gradients = tokens?.gradients

  async function regenerate() {
    if (readOnly) return
    setBusy(true)
    setRegenStatus(null)
    try {
      const res = await fetch(`${baseUrl}/api/brand/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt: regenPrompt || undefined }),
      })
      const data: RegenerateResponse = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRegenStatus(data.message || `Failed (${res.status})`)
      } else {
        setRegenStatus(data.message || 'Regeneration requested — Iris is on it.')
        setTimeout(() => { void refresh() }, 1500)
      }
    } catch (e) {
      setRegenStatus(`Error: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Brand Identity Header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {identity?.symbol ? (
          <div style={{
            width: 56, height: 68, borderRadius: 8,
            background: 'var(--bg-base, #0A1628)',
            border: '1.5px solid transparent',
            backgroundClip: 'padding-box',
            position: 'relative',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'var(--brand-glow)',
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', inset: -1, borderRadius: 8,
              background: 'var(--gradient-creation, linear-gradient(135deg, #00E5FF, #536DFE, #7C4DFF))',
              zIndex: 0, opacity: 0.6,
            }} />
            <div style={{
              position: 'absolute', inset: 1, borderRadius: 7,
              background: 'var(--bg-base, #0A1628)',
              zIndex: 1,
            }} />
            <div style={{ position: 'relative', zIndex: 2, textAlign: 'center' }}>
              {identity.atomic_number && (
                <div style={{
                  fontSize: '0.55rem', fontFamily: 'var(--font-mono)',
                  color: 'var(--accent-primary)', opacity: 0.7, marginBottom: 2,
                }}>{identity.atomic_number}</div>
              )}
              <div style={{
                fontSize: '1.6rem', fontWeight: 200,
                background: 'var(--gradient-ai-symbol, linear-gradient(135deg, #00E5FF, #40C4FF))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                lineHeight: 1,
              }}>{identity.symbol}</div>
              {identity.atomic_mass && (
                <div style={{
                  fontSize: '0.45rem', fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)', marginTop: 2,
                }}>{identity.atomic_mass}</div>
              )}
            </div>
          </div>
        ) : (
          <div style={{
            width: 48, height: 48, borderRadius: 'var(--radius-lg)',
            background: accent,
            color: 'var(--bg-deep)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.3rem', fontWeight: 700,
            boxShadow: 'var(--brand-glow)',
          }}>
            {brand?.logo_initial ?? (brand?.display_name ?? 'A').charAt(0).toUpperCase()}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: '1.15rem', margin: 0, fontWeight: 300, letterSpacing: '0.5px' }}>
            {identity?.name ?? brand?.display_name ?? 'Brand'}
          </h2>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>
            {identity?.tagline ?? brand?.tagline ?? ''}
          </div>
        </div>
        <span style={{
          fontSize: '0.65rem', padding: '4px 10px', borderRadius: 999,
          background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
          border: '1px solid var(--glass-border)',
        }}>
          theme: {theme?.id ?? 'default'}
        </span>
      </header>

      {/* Signature Gradient */}
      {gradients?.creation && (
        <section>
          <div style={labelStyle}>Signature Gradient</div>
          <div style={{
            height: 48, borderRadius: 'var(--radius-lg)',
            background: gradients.creation.css,
          }} />
          {gradients.creation.stops && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              {gradients.creation.stops.map(s => (
                <span key={s} style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{s}</span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Palette swatches */}
      <section>
        <div style={labelStyle}>Palette</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {Object.entries(palette)
            .filter(([, v]) => typeof v === 'string' && (v as string).match(/^#|^rgb|^hsl/i))
            .map(([k, v]) => (
              <div key={k} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: 8, borderRadius: 'var(--radius)',
                background: 'var(--bg-surface)', border: '1px solid var(--glass-border)',
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 6,
                  background: v as string,
                  border: '1px solid var(--glass-border)', flexShrink: 0,
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {k}
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {v as string}
                  </div>
                </div>
              </div>
            ))}
        </div>
      </section>

      {/* Typography Preview */}
      {tokens?.typography && (
        <section>
          <div style={labelStyle}>Typography</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              padding: 16, borderRadius: 'var(--radius)',
              background: 'var(--bg-surface)', border: '1px solid var(--glass-border)',
            }}>
              <div style={{ fontSize: '0.6rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                Display — Inter 200
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 200, letterSpacing: 3, color: 'var(--text-primary)' }}>
                {identity?.name?.toUpperCase() ?? 'AITHERIUM'}
              </div>
            </div>
            <div style={{
              padding: 16, borderRadius: 'var(--radius)',
              background: 'var(--bg-surface)', border: '1px solid var(--glass-border)',
            }}>
              <div style={{ fontSize: '0.6rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                Monospace — JetBrains Mono
              </div>
              <div style={{ fontSize: '0.9rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)' }}>
                {identity?.atomic_number ?? 47} &middot; {identity?.symbol ?? 'Ai'} &middot; {identity?.atomic_mass ?? '208.043'}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Brand Taglines */}
      {identity?.taglines && Object.keys(identity.taglines).length > 1 && (
        <section>
          <div style={labelStyle}>Brand Phrases</div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8,
          }}>
            {Object.entries(identity.taglines).map(([key, phrase]) => (
              <div key={key} style={{
                padding: '10px 14px', borderRadius: 'var(--radius)',
                background: 'var(--bg-surface)', border: '1px solid var(--glass-border)',
              }}>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>{key}</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 300, color: 'var(--text-primary)', fontStyle: 'italic' }}>{phrase}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Regenerate via Iris */}
      {!readOnly && (
        <section style={{
          padding: 16, borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-surface)', border: '1px solid var(--glass-border)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: '0.85rem' }}>Regenerate with Iris</strong>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>design_system_generate</span>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
            Send a prompt to the Iris design agent to regenerate palette and logo.
            Output is written to <code style={{ fontSize: '0.7rem' }}>.ELEMENT/brand.yaml</code> and pushed to portal.
          </p>
          <textarea
            value={regenPrompt}
            onChange={(e) => setRegenPrompt(e.target.value)}
            placeholder="Optional prompt, e.g. 'lean more architectural, blueprint blues, less violet'..."
            rows={3}
            style={{
              padding: 10, borderRadius: 'var(--radius)',
              background: 'var(--bg-deep)', color: 'var(--text-primary)',
              border: '1px solid var(--glass-border)', resize: 'vertical',
              fontSize: '0.8rem', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={regenerate}
              disabled={busy}
              style={{
                padding: '8px 16px', borderRadius: 'var(--radius)',
                background: busy ? 'var(--bg-elevated)' : accent,
                color: busy ? 'var(--text-muted)' : 'var(--bg-deep)',
                fontWeight: 600, fontSize: '0.8rem',
                opacity: busy ? 0.6 : 1,
                boxShadow: busy ? 'none' : `0 4px 14px ${accent2}33`,
              }}
            >
              {busy ? 'Working...' : 'Regenerate brand'}
            </button>
            <button
              onClick={() => { void refresh() }}
              style={{
                padding: '8px 14px', borderRadius: 'var(--radius)',
                background: 'transparent', color: 'var(--text-secondary)',
                border: '1px solid var(--glass-border)', fontSize: '0.75rem',
              }}
            >
              Reload from server
            </button>
            {regenStatus && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{regenStatus}</span>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--sidebar-section-label, var(--text-muted))',
  marginBottom: 8,
}

export default BrandPanel
