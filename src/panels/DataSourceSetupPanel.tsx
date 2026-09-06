'use client'

/**
 * DataSourceSetupPanel — Guided wizard for connecting email, calendar,
 * file storage, and employee directory to a workspace.
 *
 * Used in onboarding flow and as a standalone "Connections" settings panel.
 */

import { useState, useEffect, useCallback } from 'react'

export interface DataSourceSetupPanelProps {
  apiBase?: string
  /** If true, show as full onboarding wizard with progress. Otherwise compact settings view. */
  wizardMode?: boolean
  onComplete?: () => void
}

type Step = 'overview' | 'email' | 'calendar' | 'storage' | 'employees' | 'done'
const STEPS: Step[] = ['overview', 'email', 'calendar', 'storage', 'employees', 'done']

interface OnboardingState {
  email_connected: boolean
  calendar_connected: boolean
  storage_connected: boolean
  employees_imported: boolean
  completed: boolean
  steps_completed: string[]
  email_provider?: string
  email_address?: string
  calendar_provider?: string
  employees_count?: number
  storage_providers?: string[]
}

const EMPTY_STATE: OnboardingState = {
  email_connected: false,
  calendar_connected: false,
  storage_connected: false,
  employees_imported: false,
  completed: false,
  steps_completed: [],
}

const EMAIL_PROVIDERS = [
  { id: 'gmail', name: 'Gmail', icon: 'G' },
  { id: 'outlook', name: 'Outlook / Office 365', icon: 'O' },
  { id: 'protonmail', name: 'ProtonMail', icon: 'P' },
  { id: 'fastmail', name: 'Fastmail', icon: 'F' },
  { id: 'imap', name: 'Other (IMAP)', icon: '@' },
]

const CALENDAR_PROVIDERS = [
  { id: 'google', name: 'Google Calendar' },
  { id: 'microsoft', name: 'Outlook / Microsoft 365' },
  { id: 'proton', name: 'Proton Calendar' },
  { id: 'caldav', name: 'CalDAV (Other)' },
]

const STORAGE_PROVIDERS = [
  { id: 'google_drive', name: 'Google Drive', icon: 'GD' },
  { id: 's3', name: 'Amazon S3', icon: 'S3' },
  { id: 'smb', name: 'File Server (SMB)', icon: 'SM' },
  { id: 'sftp', name: 'SFTP', icon: 'SF' },
  { id: 'onedrive', name: 'OneDrive', icon: 'OD' },
  { id: 'dropbox', name: 'Dropbox', icon: 'DB' },
]

const EMPLOYEE_SOURCES = [
  { id: 'google_workspace', name: 'Google Workspace' },
  { id: 'microsoft_graph', name: 'Microsoft 365 / Azure AD' },
  { id: 'csv', name: 'Upload CSV' },
]

export default function DataSourceSetupPanel({
  apiBase = '/api',
  wizardMode = true,
  onComplete,
}: DataSourceSetupPanelProps) {
  const [step, setStep] = useState<Step>('overview')
  const [state, setState] = useState<OnboardingState>(EMPTY_STATE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Form state
  const [emailProvider, setEmailProvider] = useState('gmail')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [calProvider, setCalProvider] = useState('google')
  const [calCredentials, setCalCredentials] = useState('')
  const [calEmail, setCalEmail] = useState('')
  const [storageProvider, setStorageProvider] = useState('google_drive')
  const [storageName, setStorageName] = useState('')
  const [storageConfig, setStorageConfig] = useState('')
  const [empSource, setEmpSource] = useState('csv')
  const [empCredentials, setEmpCredentials] = useState('')
  const [csvData, setCsvData] = useState('')

  // Deploy bundle state
  const [deployService, setDeployService] = useState<string | null>(null)
  const [deployBundle, setDeployBundle] = useState<any>(null)
  const [deployLoading, setDeployLoading] = useState(false)

  const fetchDeployBundle = async (serviceId: string) => {
    setDeployLoading(true)
    setDeployService(serviceId)
    try {
      const res = await fetch(`${apiBase}/deploy/bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: serviceId }),
      })
      if (res.ok) setDeployBundle(await res.json())
    } catch { /* ignore */ }
    finally { setDeployLoading(false) }
  }

  const downloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const idx = STEPS.indexOf(step)

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/onboarding/status`)
      if (res.ok) {
        const d = await res.json()
        setState(d.data || EMPTY_STATE)
      }
    } catch { /* ignore */ }
  }, [apiBase])

  useEffect(() => { fetchState() }, [fetchState])

  const goNext = () => {
    if (idx < STEPS.length - 1) {
      setStep(STEPS[idx + 1])
      setError(null)
      setSuccess(null)
    }
  }
  const goBack = () => {
    if (idx > 0) {
      setStep(STEPS[idx - 1])
      setError(null)
      setSuccess(null)
    }
  }

  const connectEmail = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/onboarding/connect-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: emailProvider, email, password }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Failed')
      setSuccess(`Connected ${email}`)
      await fetchState()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const connectCalendar = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/onboarding/connect-calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: calProvider,
          credentials_json: calCredentials,
          user_email: calEmail || undefined,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Failed')
      setSuccess('Calendar connected')
      await fetchState()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const connectStorage = async () => {
    setLoading(true)
    setError(null)
    try {
      let config = {}
      try { config = JSON.parse(storageConfig) } catch { /* use empty */ }
      const res = await fetch(`${apiBase}/onboarding/connect-storage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: storageProvider,
          name: storageName || `${storageProvider}-source`,
          config,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Failed')
      setSuccess('Storage connected')
      await fetchState()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const importEmployees = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/onboarding/import-employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: empSource,
          credentials_json: empCredentials || undefined,
          csv_data: empSource === 'csv' ? csvData : undefined,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Failed')
      setSuccess(`Imported ${d.imported} employees`)
      await fetchState()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const finishOnboarding = async () => {
    try {
      await fetch(`${apiBase}/onboarding/complete`, { method: 'POST' })
      await fetchState()
      onComplete?.()
    } catch { /* ignore */ }
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--glass-border)',
    borderRadius: 'var(--radius-md, 8px)',
    padding: '1.5rem',
    marginBottom: '1rem',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--glass-border)',
    borderRadius: 'var(--radius-sm, 4px)',
    color: 'var(--text)',
    fontSize: '0.85rem',
    marginTop: 4,
  }

  const btnPrimary: React.CSSProperties = {
    padding: '0.5rem 1.25rem',
    background: 'var(--accent-primary)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm, 4px)',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
    opacity: loading ? 0.6 : 1,
  }

  const btnSecondary: React.CSSProperties = {
    ...btnPrimary,
    background: 'transparent',
    border: '1px solid var(--glass-border)',
    color: 'var(--text-secondary)',
  }

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    appearance: 'auto' as any,
  }

  const statusDot = (connected: boolean) => (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: connected ? '#22c55e' : 'var(--text-muted)',
      marginRight: 8,
    }} />
  )

  return (
    <div style={{ padding: '2rem', maxWidth: 640, margin: '0 auto' }}>
      {/* Progress bar */}
      {wizardMode && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: i <= idx ? 'var(--accent-primary)' : 'var(--bg-elevated)',
            }} />
          ))}
        </div>
      )}

      {/* Error / Success banners */}
      {error && (
        <div style={{ ...cardStyle, borderColor: '#ef4444', background: 'rgba(239,68,68,0.1)', marginBottom: 16 }}>
          <span style={{ color: '#ef4444', fontSize: '0.85rem' }}>{error}</span>
        </div>
      )}
      {success && (
        <div style={{ ...cardStyle, borderColor: '#22c55e', background: 'rgba(34,197,94,0.1)', marginBottom: 16 }}>
          <span style={{ color: '#22c55e', fontSize: '0.85rem' }}>{success}</span>
        </div>
      )}

      {/* ── Overview ──────────────────────────────── */}
      {step === 'overview' && (
        <div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: 8 }}>
            Connect Your Workspace
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.6 }}>
            Connect your business tools so your AI assistant has full awareness of your
            day-to-day: emails, calendar, documents, and team directory.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'Email', done: state.email_connected, detail: state.email_address },
              { label: 'Calendar', done: state.calendar_connected, detail: state.calendar_provider },
              { label: 'File Storage', done: state.storage_connected },
              { label: 'Employee Directory', done: state.employees_imported, detail: state.employees_count ? `${state.employees_count} imported` : undefined },
            ].map(s => (
              <div key={s.label} style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {statusDot(s.done)}
                  <span style={{ fontWeight: 500 }}>{s.label}</span>
                  {s.detail && <span style={{ marginLeft: 12, fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.detail}</span>}
                </div>
                <span style={{ fontSize: '0.75rem', color: s.done ? '#22c55e' : 'var(--text-muted)' }}>
                  {s.done ? 'Connected' : 'Not connected'}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
            <button style={btnPrimary} onClick={goNext}>Get Started</button>
            {state.completed && <button style={btnSecondary} onClick={onComplete}>Done</button>}
          </div>
        </div>
      )}

      {/* ── Email ─────────────────────────────────── */}
      {step === 'email' && (
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 8 }}>Connect Email</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16 }}>
            Connect your email so the AI can read incoming messages, send replies, and stay
            aware of your communications.
          </p>

          {/* Deploy Proton Bridge helper */}
          {emailProvider === 'protonmail' && !state.email_connected && (
            <div style={{ ...cardStyle, borderColor: 'var(--accent-primary)', background: 'rgba(99,102,241,0.05)', marginBottom: 12 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Need Proton Mail Bridge?</div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 8px' }}>
                Proton Mail Bridge runs on your computer and exposes your Proton email via IMAP/SMTP.
              </p>
              {deployService === 'proton-bridge' && deployBundle ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {deployBundle.files?.map((f: any) => (
                    <button key={f.filename}
                      style={{ ...btnSecondary, fontSize: '0.75rem', padding: '4px 10px' }}
                      onClick={() => downloadFile(f.filename, f.content)}>
                      {f.filename}
                    </button>
                  ))}
                </div>
              ) : (
                <button style={{ ...btnSecondary, fontSize: '0.75rem' }}
                  onClick={() => fetchDeployBundle('proton-bridge')}
                  disabled={deployLoading}>
                  {deployLoading ? 'Generating...' : 'Get Setup Package'}
                </button>
              )}
              {deployBundle?.instructions && (
                <ol style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 8, paddingLeft: 16 }}>
                  {deployBundle.instructions.map((s: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
                </ol>
              )}
            </div>
          )}

          {state.email_connected ? (
            <div style={cardStyle}>
              {statusDot(true)}
              <strong>{state.email_address}</strong> connected via {state.email_provider}
            </div>
          ) : (
            <div style={cardStyle}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Provider</label>
              <select style={selectStyle} value={emailProvider} onChange={e => setEmailProvider(e.target.value)}>
                {EMAIL_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>

              <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: 12 }}>Email Address</label>
              <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />

              <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: 12 }}>App Password</label>
              <input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="App-specific password" />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Use an app-specific password, not your main account password.
              </div>

              <button style={{ ...btnPrimary, marginTop: 16 }} onClick={connectEmail} disabled={loading || !email || !password}>
                {loading ? 'Connecting...' : 'Connect Email'}
              </button>
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
            <button style={btnSecondary} onClick={goBack}>Back</button>
            <button style={btnPrimary} onClick={goNext}>{state.email_connected ? 'Next' : 'Skip'}</button>
          </div>
        </div>
      )}

      {/* ── Calendar ──────────────────────────────── */}
      {step === 'calendar' && (
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 8 }}>Connect Calendar</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16 }}>
            Sync your calendar so the AI knows your schedule, can find free slots,
            and schedule meetings on your behalf.
          </p>

          {/* Deploy helper for Proton Calendar */}
          {calProvider === 'proton' && !state.calendar_connected && (
            <div style={{ ...cardStyle, borderColor: 'var(--accent-primary)', background: 'rgba(99,102,241,0.05)', marginBottom: 12 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Proton Calendar uses the same Bridge</div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                If you already set up Proton Mail Bridge in the email step, your calendar is
                automatically available via CalDAV. Just enter your Bridge password below.
              </p>
              {!deployBundle && (
                <button style={{ ...btnSecondary, fontSize: '0.75rem', marginTop: 8 }}
                  onClick={() => fetchDeployBundle('proton-bridge')}
                  disabled={deployLoading}>
                  {deployLoading ? 'Generating...' : "Don't have Bridge yet? Get Setup Package"}
                </button>
              )}
            </div>
          )}

          {state.calendar_connected ? (
            <div style={cardStyle}>
              {statusDot(true)}
              Calendar connected via <strong>{state.calendar_provider}</strong>
            </div>
          ) : (
            <div style={cardStyle}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Provider</label>
              <select style={selectStyle} value={calProvider} onChange={e => setCalProvider(e.target.value)}>
                {CALENDAR_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>

              {calProvider === 'proton' ? (
                <>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: 12 }}>
                    Proton Bridge Password
                  </label>
                  <input
                    style={inputStyle} type="password"
                    value={calCredentials}
                    onChange={e => setCalCredentials(e.target.value)}
                    placeholder="Bridge-generated password"
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    Proton Mail Bridge must be running. Calendar syncs via CalDAV on localhost.
                  </div>
                </>
              ) : (
                <>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: 12 }}>
                    {calProvider === 'caldav' ? 'CalDAV Config (JSON)' : 'Service Account / OAuth Credentials (JSON)'}
                  </label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 80, fontFamily: 'monospace', fontSize: '0.75rem' }}
                    value={calCredentials}
                    onChange={e => setCalCredentials(e.target.value)}
                    placeholder={calProvider === 'caldav'
                      ? '{"caldav_url": "https://...", "username": "...", "password": "..."}'
                      : '{"type": "service_account", ...}'}
                  />
                </>
              )}

              <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: 12 }}>
                {calProvider === 'proton' ? 'Proton Email' : 'User Email (for domain-wide delegation)'}
              </label>
              <input style={inputStyle} type="email" value={calEmail} onChange={e => setCalEmail(e.target.value)}
                placeholder={calProvider === 'proton' ? 'you@proton.me' : 'boss@company.com'} />

              <button style={{ ...btnPrimary, marginTop: 16 }} onClick={connectCalendar} disabled={loading || !calCredentials}>
                {loading ? 'Connecting...' : 'Connect Calendar'}
              </button>
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
            <button style={btnSecondary} onClick={goBack}>Back</button>
            <button style={btnPrimary} onClick={goNext}>{state.calendar_connected ? 'Next' : 'Skip'}</button>
          </div>
        </div>
      )}

      {/* ── Storage ───────────────────────────────── */}
      {step === 'storage' && (
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 8 }}>Connect File Storage</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16 }}>
            Give your AI access to documents in Google Drive, S3, file servers, or other storage.
          </p>

          {/* Deploy helper for local storage services */}
          {!state.storage_connected && (
            <div style={{ ...cardStyle, borderColor: 'var(--glass-border)', marginBottom: 12 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Need local storage?</div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 8px' }}>
                Deploy S3-compatible storage or a vector database locally with one click.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['minio', 'qdrant'].map(svc => (
                  <button key={svc}
                    style={{ ...btnSecondary, fontSize: '0.75rem', padding: '4px 10px' }}
                    onClick={() => fetchDeployBundle(svc)}>
                    Deploy {svc === 'minio' ? 'MinIO (S3)' : 'Qdrant'}
                  </button>
                ))}
              </div>
              {deployService && ['minio', 'qdrant'].includes(deployService) && deployBundle && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>{deployBundle.service_name}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {deployBundle.files?.map((f: any) => (
                      <button key={f.filename}
                        style={{ ...btnSecondary, fontSize: '0.7rem', padding: '3px 8px' }}
                        onClick={() => downloadFile(f.filename, f.content)}>
                        {f.filename}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {state.storage_connected ? (
            <div style={cardStyle}>
              {statusDot(true)}
              Storage connected: {(state.storage_providers || []).join(', ')}
            </div>
          ) : (
            <div style={cardStyle}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Provider</label>
              <select style={selectStyle} value={storageProvider} onChange={e => setStorageProvider(e.target.value)}>
                {STORAGE_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>

              <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: 12 }}>Display Name</label>
              <input style={inputStyle} value={storageName} onChange={e => setStorageName(e.target.value)} placeholder="Company Docs" />

              <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: 12 }}>
                Connection Config (JSON)
              </label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, fontFamily: 'monospace', fontSize: '0.75rem' }}
                value={storageConfig}
                onChange={e => setStorageConfig(e.target.value)}
                placeholder={storageProvider === 's3'
                  ? '{"bucket": "my-bucket", "region": "us-east-1", "access_key_id": "...", "secret_access_key": "..."}'
                  : storageProvider === 'smb'
                  ? '{"server": "fileserver.local", "share": "documents", "username": "...", "password": "..."}'
                  : '{"credentials_json": "..."}'}
              />

              <button style={{ ...btnPrimary, marginTop: 16 }} onClick={connectStorage} disabled={loading}>
                {loading ? 'Connecting...' : 'Connect Storage'}
              </button>
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
            <button style={btnSecondary} onClick={goBack}>Back</button>
            <button style={btnPrimary} onClick={goNext}>{state.storage_connected ? 'Next' : 'Skip'}</button>
          </div>
        </div>
      )}

      {/* ── Employees ─────────────────────────────── */}
      {step === 'employees' && (
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 8 }}>Import Team Directory</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16 }}>
            Import your team members so the AI knows who&apos;s who, can route questions
            to the right person, and manage schedules.
          </p>

          {state.employees_imported ? (
            <div style={cardStyle}>
              {statusDot(true)}
              <strong>{state.employees_count}</strong> employees imported
            </div>
          ) : (
            <div style={cardStyle}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600 }}>Source</label>
              <select style={selectStyle} value={empSource} onChange={e => setEmpSource(e.target.value)}>
                {EMPLOYEE_SOURCES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>

              {empSource === 'csv' ? (
                <>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: 12 }}>
                    CSV Data (name, email, title, department, phone)
                  </label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 120, fontFamily: 'monospace', fontSize: '0.75rem' }}
                    value={csvData}
                    onChange={e => setCsvData(e.target.value)}
                    placeholder={`name,email,title,department,phone\nJohn Smith,john@company.com,CEO,,555-0100\nJane Doe,jane@company.com,CTO,Engineering,555-0101`}
                  />
                </>
              ) : (
                <>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginTop: 12 }}>
                    Service Account / OAuth Credentials (JSON)
                  </label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 80, fontFamily: 'monospace', fontSize: '0.75rem' }}
                    value={empCredentials}
                    onChange={e => setEmpCredentials(e.target.value)}
                    placeholder='{"type": "service_account", ...}'
                  />
                </>
              )}

              <button style={{ ...btnPrimary, marginTop: 16 }} onClick={importEmployees} disabled={loading}>
                {loading ? 'Importing...' : 'Import Employees'}
              </button>
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
            <button style={btnSecondary} onClick={goBack}>Back</button>
            <button style={btnPrimary} onClick={goNext}>{state.employees_imported ? 'Next' : 'Skip'}</button>
          </div>
        </div>
      )}

      {/* ── Done ──────────────────────────────────── */}
      {step === 'done' && (
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: 8 }}>
            Workspace Connected
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.6 }}>
            Your AI assistant now has access to your business data. You can always
            update connections from Settings.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 300, margin: '0 auto', textAlign: 'left' }}>
            {[
              { label: 'Email', done: state.email_connected },
              { label: 'Calendar', done: state.calendar_connected },
              { label: 'File Storage', done: state.storage_connected },
              { label: 'Employee Directory', done: state.employees_imported },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem' }}>
                {statusDot(s.done)}
                <span>{s.label}</span>
              </div>
            ))}
          </div>

          <button style={{ ...btnPrimary, marginTop: 24 }} onClick={finishOnboarding}>
            Finish Setup
          </button>
        </div>
      )}
    </div>
  )
}
