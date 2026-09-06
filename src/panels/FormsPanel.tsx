'use client'

import { useState, useEffect, useCallback } from 'react'

interface FormField {
  field_type: string
  label: string
  required: boolean
  placeholder?: string
  options?: string[]
}

interface FormDef {
  form_id: string
  title: string
  description?: string
  fields: FormField[]
  published: boolean
  submission_count?: number
  created_at?: string
}

interface Submission {
  submission_id: string
  responses: Record<string, any>
  submitter_name?: string
  submitter_email?: string
  submitted_at: string
}

interface FormAnalytics {
  total_submissions: number
  completion_rate?: number
  field_stats?: Record<string, any>
}

type ViewMode = 'list' | 'detail' | 'analytics'

const FIELD_TYPES = [
  'text', 'textarea', 'email', 'phone', 'number',
  'select', 'multiselect', 'checkbox', 'date', 'file',
] as const

export interface FormsPanelProps {
  apiBase?: string
}

export default function FormsPanel({ apiBase = '/api/forms' }: FormsPanelProps) {
  const [forms, setForms] = useState<FormDef[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewMode>('list')

  // Create form state
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newFields, setNewFields] = useState<FormField[]>([])

  // Add field state
  const [addFieldType, setAddFieldType] = useState<string>('text')
  const [addFieldLabel, setAddFieldLabel] = useState('')
  const [addFieldRequired, setAddFieldRequired] = useState(false)
  const [addFieldOptions, setAddFieldOptions] = useState('')

  // Detail view state
  const [selectedForm, setSelectedForm] = useState<FormDef | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [analytics, setAnalytics] = useState<FormAnalytics | null>(null)

  const fetchForms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiBase)
      if (res.ok) {
        const data = await res.json()
        if (data?.data?.forms) {
          setForms(data.data.forms)
        } else if (Array.isArray(data?.data)) {
          setForms(data.data)
        }
      }
    } catch (e) {
      console.error('Forms fetch error:', e)
    }
    setLoading(false)
  }, [apiBase])

  useEffect(() => { fetchForms() }, [fetchForms])

  const fetchDetail = async (form: FormDef) => {
    setSelectedForm(form)
    setView('detail')
    try {
      const [subRes, analyticsRes] = await Promise.all([
        fetch(`${apiBase}/${form.form_id}/submissions`).then(r => r.ok ? r.json() : null),
        fetch(`${apiBase}/${form.form_id}/analytics`).then(r => r.ok ? r.json() : null),
      ])
      if (subRes?.data?.submissions) {
        setSubmissions(subRes.data.submissions)
      } else if (Array.isArray(subRes?.data)) {
        setSubmissions(subRes.data)
      }
      if (analyticsRes?.data) {
        setAnalytics(analyticsRes.data)
      }
    } catch (e) {
      console.error('Form detail fetch error:', e)
    }
  }

  const handleAddField = () => {
    if (!addFieldLabel) return
    const field: FormField = {
      field_type: addFieldType,
      label: addFieldLabel,
      required: addFieldRequired,
    }
    if (['select', 'multiselect'].includes(addFieldType) && addFieldOptions) {
      field.options = addFieldOptions.split(',').map(s => s.trim()).filter(Boolean)
    }
    setNewFields([...newFields, field])
    setAddFieldLabel('')
    setAddFieldRequired(false)
    setAddFieldOptions('')
  }

  const handleRemoveField = (index: number) => {
    setNewFields(newFields.filter((_, i) => i !== index))
  }

  const handleMoveField = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= newFields.length) return
    const updated = [...newFields]
    const temp = updated[index]
    updated[index] = updated[target]
    updated[target] = temp
    setNewFields(updated)
  }

  const handleCreateForm = async () => {
    if (!newTitle || newFields.length === 0) return
    try {
      const resp = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          description: newDescription,
          fields: newFields,
          published: false,
        }),
      })
      if (resp.ok) {
        setShowCreate(false)
        setNewTitle('')
        setNewDescription('')
        setNewFields([])
        fetchForms()
      }
    } catch (e) {
      console.error('Create form error:', e)
    }
  }

  const handleDeleteForm = async (formId: string) => {
    try {
      const resp = await fetch(`${apiBase}/${formId}`, { method: 'DELETE' })
      if (resp.ok) {
        if (selectedForm?.form_id === formId) {
          setView('list')
          setSelectedForm(null)
        }
        fetchForms()
      }
    } catch (e) {
      console.error('Delete form error:', e)
    }
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch { return iso }
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading forms...
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {view !== 'list' && (
            <button
              onClick={() => { setView('list'); setSelectedForm(null) }}
              style={{
                padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                fontSize: '0.75rem',
              }}
            >
              Back
            </button>
          )}
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
            {view === 'list' ? 'Forms' : selectedForm?.title || 'Form Detail'}
          </h2>
        </div>
        {view === 'list' && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            style={{
              padding: '6px 14px', borderRadius: 6, border: 'none',
              background: 'var(--accent)', color: '#fff', cursor: 'pointer',
              fontSize: '0.8rem', fontWeight: 600,
            }}
          >
            + New Form
          </button>
        )}
        {(view === 'detail' || view === 'analytics') && selectedForm && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { setView('detail') }}
              style={{
                padding: '6px 14px', borderRadius: 6,
                border: view === 'detail' ? 'none' : '1px solid var(--border)',
                background: view === 'detail' ? 'var(--accent)' : 'transparent',
                color: view === 'detail' ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.8rem',
              }}
            >
              Submissions
            </button>
            <button
              onClick={() => setView('analytics')}
              style={{
                padding: '6px 14px', borderRadius: 6,
                border: view === 'analytics' ? 'none' : '1px solid var(--border)',
                background: view === 'analytics' ? 'var(--accent)' : 'transparent',
                color: view === 'analytics' ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.8rem',
              }}
            >
              Analytics
            </button>
          </div>
        )}
      </div>

      {/* Create Form Modal */}
      {showCreate && view === 'list' && (
        <div style={{
          padding: '1rem', borderRadius: 8, background: 'var(--bg-elevated)',
          border: '1px solid var(--border)', marginBottom: '1rem',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
            <input
              value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="Form title"
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)' }}
            />
            <textarea
              value={newDescription} onChange={e => setNewDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text)', resize: 'vertical' }}
            />

            {/* Field List */}
            {newFields.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Fields</div>
                {newFields.map((f, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '8px 12px', borderRadius: 6, background: 'var(--bg-deep)',
                      border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    <span style={{
                      padding: '2px 6px', borderRadius: 3, fontSize: '0.65rem', fontWeight: 600,
                      background: 'rgba(124,58,237,0.15)', color: 'var(--accent)',
                    }}>
                      {f.field_type}
                    </span>
                    <span style={{ flex: 1, fontSize: '0.85rem' }}>{f.label}</span>
                    {f.required && (
                      <span style={{ fontSize: '0.65rem', color: '#f44336' }}>required</span>
                    )}
                    <button onClick={() => handleMoveField(i, -1)} disabled={i === 0} style={{ padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.3 : 1, fontSize: '0.7rem' }}>Up</button>
                    <button onClick={() => handleMoveField(i, 1)} disabled={i === newFields.length - 1} style={{ padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: i === newFields.length - 1 ? 'default' : 'pointer', opacity: i === newFields.length - 1 ? 0.3 : 1, fontSize: '0.7rem' }}>Down</button>
                    <button onClick={() => handleRemoveField(i)} style={{ padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border)', background: 'transparent', color: '#f44336', cursor: 'pointer', fontSize: '0.7rem' }}>Remove</button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Field */}
            <div style={{
              padding: '10px 12px', borderRadius: 6, background: 'var(--bg-deep)',
              border: '1px dashed var(--border)',
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Add Field</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, alignItems: 'center' }}>
                <select
                  value={addFieldType} onChange={e => setAddFieldType(e.target.value)}
                  style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: '0.8rem' }}
                >
                  {FIELD_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input
                  value={addFieldLabel} onChange={e => setAddFieldLabel(e.target.value)}
                  placeholder="Field label"
                  onKeyDown={e => { if (e.key === 'Enter') handleAddField() }}
                  style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: '0.8rem' }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <input type="checkbox" checked={addFieldRequired} onChange={e => setAddFieldRequired(e.target.checked)} />
                  Required
                </label>
              </div>
              {['select', 'multiselect'].includes(addFieldType) && (
                <input
                  value={addFieldOptions} onChange={e => setAddFieldOptions(e.target.value)}
                  placeholder="Options (comma-separated)"
                  style={{ marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: '0.8rem', boxSizing: 'border-box' }}
                />
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button onClick={handleAddField} style={{ padding: '4px 12px', borderRadius: 4, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>
                  Add Field
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowCreate(false); setNewFields([]) }} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleCreateForm} disabled={!newTitle || newFields.length === 0} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: !newTitle || newFields.length === 0 ? 'rgba(124,58,237,0.3)' : 'var(--accent)', color: '#fff', cursor: !newTitle || newFields.length === 0 ? 'default' : 'pointer', fontWeight: 600 }}>
              Create Form
            </button>
          </div>
        </div>
      )}

      {/* Form List */}
      {view === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {forms.length === 0 && !showCreate && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
              No forms yet. Create your first form above.
            </div>
          )}
          {forms.map(form => (
            <div
              key={form.form_id}
              style={{
                padding: '14px 16px', borderRadius: 8, background: 'var(--bg-elevated)',
                border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', cursor: 'pointer',
              }}
              onClick={() => fetchDetail(form)}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>{form.title}</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 600,
                    background: form.published ? 'rgba(0,200,83,0.15)' : 'rgba(255,255,255,0.05)',
                    color: form.published ? '#00c853' : 'var(--text-muted)',
                  }}>
                    {form.published ? 'Published' : 'Draft'}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {form.fields.length} field{form.fields.length !== 1 ? 's' : ''}
                  {form.submission_count != null && ` | ${form.submission_count} submission${form.submission_count !== 1 ? 's' : ''}`}
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); handleDeleteForm(form.form_id) }}
                style={{
                  padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '0.7rem',
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Submissions Table */}
      {view === 'detail' && selectedForm && (
        <div>
          {/* Form field summary */}
          <div style={{
            padding: '10px 14px', borderRadius: 6, background: 'var(--bg-elevated)',
            marginBottom: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)',
            display: 'flex', gap: 8, flexWrap: 'wrap',
          }}>
            {selectedForm.fields.map((f, i) => (
              <span key={i} style={{
                padding: '2px 8px', borderRadius: 4,
                background: 'rgba(124,58,237,0.1)', color: 'var(--accent)',
              }}>
                {f.label} ({f.field_type})
              </span>
            ))}
          </div>

          {submissions.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
              No submissions yet.
            </div>
          )}

          {submissions.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>Date</th>
                    {selectedForm.fields.map((f, i) => (
                      <th key={i} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>
                        {f.label}
                      </th>
                    ))}
                    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem' }}>Submitter</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map(sub => (
                    <tr key={sub.submission_id}>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {formatDate(sub.submitted_at)}
                      </td>
                      {selectedForm.fields.map((f, i) => (
                        <td key={i} style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sub.responses[f.label] != null ? String(sub.responses[f.label]) : '-'}
                        </td>
                      ))}
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                        {sub.submitter_name || sub.submitter_email || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Analytics View */}
      {view === 'analytics' && selectedForm && analytics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          <div style={{
            padding: '16px', borderRadius: 8, background: 'var(--bg-elevated)',
            border: '1px solid var(--border)', textAlign: 'center',
          }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent)' }}>
              {analytics.total_submissions}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Submissions</div>
          </div>
          {analytics.completion_rate != null && (
            <div style={{
              padding: '16px', borderRadius: 8, background: 'var(--bg-elevated)',
              border: '1px solid var(--border)', textAlign: 'center',
            }}>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent)' }}>
                {(analytics.completion_rate * 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Completion Rate</div>
            </div>
          )}
          {analytics.field_stats && Object.entries(analytics.field_stats).map(([field, stats]: [string, any]) => (
            <div
              key={field}
              style={{
                padding: '16px', borderRadius: 8, background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>{field}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {typeof stats === 'object' ? (
                  Object.entries(stats).map(([k, v]) => (
                    <div key={k}>{k}: {String(v)}</div>
                  ))
                ) : (
                  String(stats)
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'analytics' && selectedForm && !analytics && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 0' }}>
          No analytics data available.
        </div>
      )}
    </div>
  )
}
