'use client'

/**
 * IntegrationsPanel — Data-driven integration key management UI.
 *
 * Product portals pass their integration definitions (fields, help URLs)
 * as props. The panel handles the connect/disconnect/update flow.
 */

import { useState, useEffect, useCallback } from 'react'

export interface IntegrationField {
  key: string
  label: string
  /** Input type: 'text' or 'password' (default: 'password') */
  type?: 'text' | 'password'
}

export interface IntegrationDef {
  id: string
  name: string
  color: string
  description: string
  fields: IntegrationField[]
  helpUrl?: string
  helpText?: string
}

export interface IntegrationsPanelProps {
  /** The integration definitions this portal supports */
  integrations: IntegrationDef[]
  /** Fetch integration connection status. Return { [integrationId]: boolean } */
  fetchStatus?: () => Promise<Record<string, boolean>>
  /** Save an integration key. Called with (key, value) for each field. */
  onSave?: (key: string, value: string) => Promise<void>
  /** Called after all fields saved so caller can refresh user/status */
  onSaved?: () => void
}

export default function IntegrationsPanel({
  integrations,
  fetchStatus,
  onSave,
  onSaved,
}: IntegrationsPanelProps) {
  const [status, setStatus] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (fetchStatus) {
      fetchStatus().then(setStatus)
    }
  }, [fetchStatus])

  const save = useCallback(async (fields: IntegrationField[]) => {
    if (!onSave) return
    setSaving(true)
    for (const f of fields) {
      if (values[f.key]) {
        await onSave(f.key, values[f.key])
      }
    }
    setSaving(false)
    setEditing(null)
    setValues({})
    onSaved?.()
    if (fetchStatus) {
      fetchStatus().then(setStatus)
    }
  }, [values, onSave, onSaved, fetchStatus])

  return (
    <div style={{ padding: 32, maxWidth: 700, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 600, marginBottom: 8 }}>Integrations</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 24 }}>
        Connect your business tools to unlock the full capabilities of your workspace.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {(integrations ?? []).map(int => {
          const isEditing = editing === int.id
          const connected = status[int.id] ?? false

          return (
            <div key={int.id} style={{
              background: 'var(--bg-base)', border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius)', padding: '20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: `${int.color}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.9rem', fontWeight: 700, color: int.color,
                  }}>
                    {int.name.charAt(0)}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>{int.name}</h3>
                      <span style={{
                        fontSize: '0.7rem', padding: '2px 8px', borderRadius: 8,
                        background: connected ? 'rgba(122, 176, 138, 0.1)' : 'var(--bg-surface)',
                        color: connected ? 'var(--accent-green, #7ab08a)' : 'var(--text-muted)',
                      }}>
                        {connected ? 'Connected' : 'Not connected'}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>{int.description}</p>
                  </div>
                </div>
                <button onClick={() => setEditing(isEditing ? null : int.id)} style={{
                  padding: '8px 14px', background: 'var(--bg-surface)',
                  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
                  color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer',
                }}>
                  {isEditing ? 'Cancel' : connected ? 'Update' : 'Connect'}
                </button>
              </div>

              {isEditing && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--glass-border)' }}>
                  {int.helpText && (
                    <div style={{
                      background: 'var(--bg-surface)', borderRadius: 'var(--radius)',
                      padding: '10px 14px', marginBottom: 12, fontSize: '0.8rem', color: 'var(--text-secondary)',
                    }}>
                      <strong style={{ color: 'var(--text-primary)' }}>Where to find it:</strong>{' '}
                      {int.helpText}{' '}
                      {int.helpUrl && (
                        <a href={int.helpUrl} target="_blank" rel="noopener"
                          style={{ color: 'var(--accent-primary)', fontSize: '0.75rem' }}>Open</a>
                      )}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {int.fields.map(field => (
                      <div key={field.key}>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                          {field.label}
                        </label>
                        <input
                          type={field.type || 'password'}
                          value={values[field.key] || ''}
                          onChange={e => setValues({ ...values, [field.key]: e.target.value })}
                          placeholder={connected ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'Paste here...'}
                          style={{
                            width: '100%', padding: '8px 12px',
                            background: 'var(--bg-deep)', color: 'var(--text-primary)',
                            border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)',
                            fontSize: '0.85rem',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <button onClick={() => save(int.fields)} disabled={saving} style={{
                    marginTop: 12, padding: '10px 20px',
                    background: 'var(--accent-primary)', color: 'white',
                    borderRadius: 'var(--radius)', fontSize: '0.85rem', fontWeight: 500,
                    opacity: saving ? 0.6 : 1, cursor: 'pointer',
                  }}>
                    {saving ? 'Saving...' : 'Save & Connect'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
