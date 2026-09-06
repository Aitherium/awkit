'use client'

import { useState, useEffect, useCallback } from 'react'

interface Step {
  id: string
  title: string
  status: string // pending | in_progress | done | skipped
  instructions: string
  action_url?: string | null
  details?: Record<string, any>
}

interface Plan {
  plan_id: string
  tenant_id: string
  percent_complete: number
  steps: Step[]
}

export interface OnboardingPanelProps {
  apiBase?: string
}

const STATUS_COLOR: Record<string, string> = {
  done: 'var(--accent-success, #7ab08a)',
  in_progress: 'var(--accent-primary, #ec4899)',
  skipped: 'var(--text-muted, #988294)',
  pending: 'var(--text-muted, #988294)',
}

export default function OnboardingPanel({ apiBase = '/api/onboarding' }: OnboardingPanelProps) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = await fetch(`${apiBase}/plan`).then(r => r.ok ? r.json() : null)
      setPlan(p)
    } catch { /* leave null */ } finally { setLoading(false) }
  }, [apiBase])

  useEffect(() => { load() }, [load])

  const complete = useCallback(async (stepId: string) => {
    setBusy(stepId)
    try {
      await fetch(`${apiBase}/steps/${stepId}/complete`, { method: 'POST' })
      await load()
    } catch { /* ignore */ } finally { setBusy(null) }
  }, [apiBase, load])

  if (loading) return <div style={{ padding: 24, color: 'var(--text-muted)' }}>Loading setup…</div>

  const steps = plan?.steps || []
  const pct = plan?.percent_complete ?? 0

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto', color: 'var(--text-primary)' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Get set up</h2>
      <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 13 }}>
        Connect your studio data and turn on automation — Chelle handles the rest.
      </p>

      {/* progress bar */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Setup progress</span>
          <strong>{pct}%</strong>
        </div>
        <div style={{ height: 8, borderRadius: 99, background: 'var(--bg-surface, #27202d)', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-primary, #ec4899)', transition: 'width .3s' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {steps.map((s, i) => {
          const done = s.status === 'done' || s.status === 'skipped'
          return (
            <div key={s.id} style={{
              padding: 14, borderRadius: 'var(--radius, 10px)',
              background: 'var(--bg-surface, #27202d)',
              border: '1px solid var(--divider, rgba(255,255,255,0.06))',
              display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: 99, flexShrink: 0, marginTop: 2,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, color: '#fff',
                background: STATUS_COLOR[s.status] || 'var(--text-muted)',
              }}>{done ? '✓' : i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <strong style={{ fontSize: 14 }}>{s.title}</strong>
                  <span style={{ fontSize: 11, color: STATUS_COLOR[s.status], textTransform: 'capitalize' }}>
                    {s.status.replace('_', ' ')}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>{s.instructions}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {s.action_url && (
                    <a href={s.action_url} target="_blank" rel="noopener noreferrer" style={{
                      fontSize: 12, padding: '5px 12px', borderRadius: 8, textDecoration: 'none',
                      background: 'var(--bg-base, #1d1622)', color: 'var(--accent-primary, #ec4899)',
                      border: '1px solid var(--divider, rgba(255,255,255,0.08))',
                    }}>Open</a>
                  )}
                  {!done && (
                    <button onClick={() => complete(s.id)} disabled={busy === s.id} style={{
                      fontSize: 12, padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
                      background: 'var(--accent-primary, #ec4899)', color: '#fff', border: 'none',
                      opacity: busy === s.id ? 0.6 : 1,
                    }}>{busy === s.id ? '…' : 'Mark done'}</button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        {steps.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No setup plan yet.</p>}
      </div>
    </div>
  )
}
