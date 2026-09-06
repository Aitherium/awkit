'use client'

import { useState, useCallback, useEffect } from 'react'

// ── Types ────────────────────────────────────────────────────────────────

interface DocType {
  id: string
  label: string
  extract: boolean
}

interface WizardSpec {
  company_name: string
  name: string
  app_id: string
  industry: string
  description: string
  features: string[]
  agent: {
    mode: 'none' | 'marketplace' | 'builder'
    pack_id: string
  }
  branding: {
    primary_color: string
    logo_prompt: string
    tone: string
  }
  doc_types: DocType[]
}

type DeployPhase = 'intake' | 'design' | 'build' | 'deploy' | 'live'

const STEPS = ['Identity', 'Features', 'Agent', 'Branding', 'Documents', 'Review'] as const
type Step = 0 | 1 | 2 | 3 | 4 | 5

const INDUSTRIES = [
  'technology', 'consulting', 'photography', 'legal',
  'healthcare', 'finance', 'retail', 'education', 'other',
]

const FEATURES: { id: string; label: string; description: string }[] = [
  { id: 'chat', label: 'Chat', description: 'AI chat assistant powered by your documents and knowledge base' },
  { id: 'documents', label: 'Documents', description: 'Upload, search, and manage business documents' },
  { id: 'approvals', label: 'Approvals', description: 'Review queue for agent actions that need human sign-off' },
  { id: 'agents', label: 'Agents', description: 'Dispatch specialized AI agents for tasks' },
  { id: 'dashboard', label: 'Dashboard', description: 'Reliability metrics, usage stats, and system health' },
  { id: 'comms', label: 'Comms', description: 'Channels, DMs, and group messaging for your team' },
  { id: 'email', label: 'Email', description: 'Send and receive email through the workspace' },
]

const DEFAULT_FEATURES = ['chat', 'documents', 'approvals', 'agents', 'dashboard', 'comms']

const TONES = ['Professional', 'Friendly', 'Technical', 'Creative'] as const

const DEPLOY_PHASES: { id: DeployPhase; label: string }[] = [
  { id: 'intake', label: 'Intake' },
  { id: 'design', label: 'Design' },
  { id: 'build', label: 'Build' },
  { id: 'deploy', label: 'Deploy' },
  { id: 'live', label: 'Live' },
]

// ── Helpers ──────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function deriveAppName(company: string): string {
  const suffixes = ['inc', 'llc', 'ltd', 'co', 'corp', 'group', 'labs', 'studio', 'agency']
  const words = company.trim().split(/\s+/)
  const filtered = words.filter(w => !suffixes.includes(w.toLowerCase().replace(/[.,]/, '')))
  const base = filtered.length > 0 ? filtered.join(' ') : company.trim()
  return base ? `${base} Hub` : ''
}

// ── Styles ───────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: '0.55rem 0.75rem',
  background: 'var(--bg-deep)',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text-primary)',
  fontSize: '0.82rem',
  width: '100%',
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--text-muted)',
  marginBottom: '0.3rem',
  display: 'block',
  fontWeight: 500,
}

const sectionCard: React.CSSProperties = {
  padding: '1.5rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius)',
}

// ── Component ────────────────────────────────────────────────────────────

export default function CreateWorkspaceWizard() {
  const [step, setStep] = useState<Step>(0)
  const [errors, setErrors] = useState<string[]>([])

  // Identity
  const [companyName, setCompanyName] = useState('')
  const [appName, setAppName] = useState('')
  const [appId, setAppId] = useState('')
  const [industry, setIndustry] = useState('technology')
  const [description, setDescription] = useState('')
  const [appNameTouched, setAppNameTouched] = useState(false)
  const [appIdTouched, setAppIdTouched] = useState(false)

  // Features
  const [features, setFeatures] = useState<string[]>([...DEFAULT_FEATURES])

  // Agent
  const [agentMode, setAgentMode] = useState<'none' | 'marketplace' | 'builder'>('none')
  const [selectedAgentPack, setSelectedAgentPack] = useState('')
  const [agentPacks, setAgentPacks] = useState<{ id: string; name: string; description: string; pricing_onetime: number }[]>([])

  // Branding
  const [primaryColor, setPrimaryColor] = useState('#6366f1')
  const [logoPrompt, setLogoPrompt] = useState('')
  const [tone, setTone] = useState<string>('Professional')

  // Documents
  const [docTypes, setDocTypes] = useState<DocType[]>([
    { id: 'document', label: 'Document', extract: true },
  ])

  // Deploy
  const [deploying, setDeploying] = useState(false)
  const [deployPhase, setDeployPhase] = useState<DeployPhase | null>(null)
  const [deployDone, setDeployDone] = useState(false)
  const [deployError, setDeployError] = useState('')
  const [deployUrl, setDeployUrl] = useState('')

  // Auto-derive app name and app ID from company name
  useEffect(() => {
    if (!appNameTouched && companyName) {
      setAppName(deriveAppName(companyName))
    }
  }, [companyName, appNameTouched])

  useEffect(() => {
    if (!appIdTouched) {
      setAppId(slugify(appName || companyName))
    }
  }, [appName, companyName, appIdTouched])

  const toggleFeature = (id: string) => {
    setFeatures(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    )
  }

  const addDocType = () => {
    setDocTypes(prev => [...prev, { id: '', label: '', extract: false }])
  }

  const updateDocType = (index: number, field: keyof DocType, value: string | boolean) => {
    setDocTypes(prev => {
      const next = [...prev]
      const item = { ...next[index] }
      if (field === 'label' && typeof value === 'string') {
        item.label = value
        // Auto-slugify ID from label if the user hasn't manually edited the ID
        if (!item.id || item.id === slugify(prev[index].label)) {
          item.id = slugify(value)
        }
      } else if (field === 'id' && typeof value === 'string') {
        item.id = value
      } else if (field === 'extract' && typeof value === 'boolean') {
        item.extract = value
      }
      next[index] = item
      return next
    })
  }

  const removeDocType = (index: number) => {
    setDocTypes(prev => prev.filter((_, i) => i !== index))
  }

  const validate = useCallback((): string[] => {
    const errs: string[] = []
    if (step === 0) {
      if (!companyName.trim()) errs.push('Company name is required')
      if (!appName.trim()) errs.push('App name is required')
      if (!appId.trim()) errs.push('App ID is required')
      if (appId && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(appId) && appId.length > 1) {
        errs.push('App ID must be lowercase letters, numbers, and hyphens')
      }
    }
    if (step === 1) {
      if (features.length === 0) errs.push('Select at least one feature')
    }
    if (step === 4) {
      for (const dt of docTypes) {
        if (!dt.id.trim() || !dt.label.trim()) {
          errs.push('All document types need an ID and label')
          break
        }
      }
    }
    return errs
  }, [step, companyName, appName, appId, features, docTypes])

  const goNext = () => {
    const errs = validate()
    setErrors(errs)
    if (errs.length === 0 && step < 5) {
      setStep((step + 1) as Step)
    }
  }

  const goBack = () => {
    setErrors([])
    if (step > 0) setStep((step - 1) as Step)
  }

  const buildSpec = (): WizardSpec => ({
    company_name: companyName.trim(),
    name: appName.trim(),
    app_id: appId.trim(),
    industry,
    description: description.trim(),
    features,
    agent: {
      mode: agentMode,
      pack_id: selectedAgentPack,
    },
    branding: {
      primary_color: primaryColor,
      logo_prompt: logoPrompt.trim(),
      tone: tone.toLowerCase(),
    },
    doc_types: docTypes.filter(d => d.id && d.label),
  })

  const deploy = async () => {
    setDeploying(true)
    setDeployError('')
    setDeployDone(false)
    setDeployPhase('intake')

    const spec = {
      ...buildSpec(),
      subdomain: appId,
      template: 'default',
    }

    try {
      const res = await fetch('/api/platform/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || data.error || `HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        // Streaming response: read phase updates
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // Parse newline-delimited JSON events
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const event = JSON.parse(line)
              if (event.phase) setDeployPhase(event.phase as DeployPhase)
              if (event.url) setDeployUrl(event.url)
              if (event.status === 'complete') {
                setDeployDone(true)
                setDeployUrl(event.url || `https://${appId}.aitherium.com`)
              }
              if (event.error) throw new Error(event.error)
            } catch (e) {
              if (e instanceof SyntaxError) continue
              throw e
            }
          }
        }
      }

      // Non-streaming fallback
      if (!deployDone) {
        // Simulate phase progression for non-streaming backends
        const phases: DeployPhase[] = ['intake', 'design', 'build', 'deploy', 'live']
        for (const p of phases) {
          setDeployPhase(p)
          await new Promise(r => setTimeout(r, 800))
        }
        setDeployUrl(`https://${appId}.aitherium.com`)
        setDeployDone(true)
      }
    } catch (e: any) {
      setDeployError(e.message || 'Deployment failed')
    } finally {
      setDeploying(false)
    }
  }

  // ── Render helpers ───────────────────────────────────────────────────

  const phaseIndex = DEPLOY_PHASES.findIndex(p => p.id === deployPhase)

  const renderStepIndicator = () => (
    <div style={{ marginBottom: '1.5rem' }}>
      {/* Step labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        {STEPS.map((label, i) => (
          <span key={label} style={{
            fontSize: '0.7rem',
            fontWeight: i === step ? 600 : 400,
            color: i === step ? 'var(--accent-primary)' : i < step ? 'var(--text-secondary)' : 'var(--text-muted)',
            flex: 1,
            textAlign: 'center',
          }}>{label}</span>
        ))}
      </div>
      {/* Progress bar */}
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{
          width: `${((step + 1) / STEPS.length) * 100}%`,
          background: 'var(--accent-primary)',
        }} />
      </div>
    </div>
  )

  const renderIdentityStep = () => (
    <div className="animate-in" style={{ display: 'grid', gap: '1rem' }}>
      <div>
        <label style={labelStyle}>Company Name *</label>
        <input value={companyName} onChange={e => setCompanyName(e.target.value)}
          placeholder="Acme Corp" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>App Name</label>
        <input value={appName}
          onChange={e => { setAppName(e.target.value); setAppNameTouched(true) }}
          placeholder="Acme Hub" style={inputStyle} />
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
          Auto-derived from company name. Edit to customize.
        </span>
      </div>
      <div>
        <label style={labelStyle}>App ID / Subdomain</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input value={appId}
            onChange={e => { setAppId(slugify(e.target.value)); setAppIdTouched(true) }}
            placeholder="acme-hub" style={{ ...inputStyle, flex: 1 }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            .aitherium.com
          </span>
        </div>
      </div>
      <div>
        <label style={labelStyle}>Industry</label>
        <select value={industry} onChange={e => setIndustry(e.target.value)} style={{
          ...inputStyle, cursor: 'pointer', appearance: 'auto',
        }}>
          {INDUSTRIES.map(i => (
            <option key={i} value={i}>
              {i.charAt(0).toUpperCase() + i.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label style={labelStyle}>What should this assistant help with?</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Answer customer questions about our products, help employees find internal documents..."
          rows={3} style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }} />
      </div>
    </div>
  )

  const renderFeaturesStep = () => (
    <div className="animate-in" style={{ display: 'grid', gap: '0.5rem' }}>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
        Select the capabilities for your workspace. You can enable or disable these later.
      </p>
      {FEATURES.map(f => {
        const checked = features.includes(f.id)
        return (
          <label key={f.id} className="card" style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.75rem 1rem', cursor: 'pointer',
            borderColor: checked ? 'var(--accent-primary)' : undefined,
            background: checked ? 'var(--bg-elevated)' : 'var(--bg-surface)',
          }}>
            <input type="checkbox" checked={checked} onChange={() => toggleFeature(f.id)}
              style={{ width: 16, height: 16, accentColor: 'var(--accent-primary)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{f.label}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                {f.description}
              </div>
            </div>
          </label>
        )
      })}
    </div>
  )

  const renderAgentStep = () => {
    // Lazy-load packs on first render of this step
    if (agentPacks.length === 0) {
      fetch('/api/marketplace/packs?type=agent&per_page=6')
        .then(r => r.ok ? r.json() : { packs: [] })
        .then(d => setAgentPacks(d.packs || []))
        .catch(() => {})
    }
    return (
      <div className="animate-in" style={{ display: 'grid', gap: '1.25rem', maxWidth: 600 }}>
        <div style={sectionCard}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Agent Configuration</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Choose how to power your workspace&rsquo;s AI capabilities.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            {([
              { mode: 'none' as const, icon: '\uD83D\uDCAC', label: 'Basic Chat', desc: 'Standard AI chat \u2014 no custom agent' },
              { mode: 'marketplace' as const, icon: '\uD83D\uDED2', label: 'From Marketplace', desc: 'Pick a pre-built agent pack \u2014 $20' },
              { mode: 'builder' as const, icon: '\uD83D\uDD27', label: 'Agent Builder', desc: 'Build a custom agent with skills & tools' },
            ] as const).map(opt => (
              <div key={opt.mode} onClick={() => setAgentMode(opt.mode)} style={{
                padding: '1rem', borderRadius: 'var(--radius)', textAlign: 'center', cursor: 'pointer',
                border: `1px solid ${agentMode === opt.mode ? 'var(--accent, #6366f1)' : 'var(--glass-border)'}`,
                background: agentMode === opt.mode ? 'var(--bg-active, #1a2a4a)' : 'var(--bg-surface)',
              }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{opt.icon}</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{opt.label}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{opt.desc}</div>
              </div>
            ))}
          </div>

          {agentMode === 'marketplace' && (
            <div style={{ marginTop: '1rem' }}>
              {agentPacks.length === 0 ? (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Loading agent packs...</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem' }}>
                  {agentPacks.map(p => (
                    <div key={p.id} onClick={() => setSelectedAgentPack(p.id)} style={{
                      padding: '0.75rem', borderRadius: 'var(--radius)', cursor: 'pointer',
                      border: `1px solid ${selectedAgentPack === p.id ? 'var(--accent)' : 'var(--glass-border)'}`,
                      background: selectedAgentPack === p.id ? 'var(--bg-active)' : 'transparent',
                    }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{p.description}</div>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, marginTop: '0.3rem', color: p.pricing_onetime ? '#fbbf24' : '#4ade80' }}>
                        {p.pricing_onetime ? `$${p.pricing_onetime}` : 'Free'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {agentMode === 'builder' && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--bg-deep)', borderRadius: 'var(--radius)', fontSize: '0.82rem' }}>
              The Agent Builder will open after workspace creation. Your custom agent will be deployed automatically.
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderBrandingStep = () => (
    <div className="animate-in" style={{ display: 'grid', gap: '1.25rem', maxWidth: 480 }}>
      <div>
        <label style={labelStyle}>Primary Color</label>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
            style={{ width: 44, height: 36, border: 'none', borderRadius: 6, cursor: 'pointer',
              background: 'transparent', padding: 0 }} />
          <input value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
            style={{ ...inputStyle, width: 120, fontFamily: 'monospace', fontSize: '0.8rem' }} />
          <div style={{ width: 24, height: 24, borderRadius: 6, background: primaryColor, flexShrink: 0,
            border: '1px solid var(--glass-border)' }} />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Logo Prompt</label>
        <textarea value={logoPrompt} onChange={e => setLogoPrompt(e.target.value)}
          placeholder="Minimal gear icon in blue, modern sans-serif wordmark"
          rows={2} style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} />
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
          Describe your logo and it will be generated during build.
        </span>
      </div>
      <div>
        <label style={labelStyle}>Tone</label>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {TONES.map(t => (
            <label key={t} style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.5rem 0.85rem', borderRadius: 'var(--radius)',
              background: tone === t ? 'var(--accent-primary)' : 'var(--bg-elevated)',
              color: tone === t ? 'var(--bg-deep)' : 'var(--text-secondary)',
              cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
              border: '1px solid',
              borderColor: tone === t ? 'var(--accent-primary)' : 'var(--glass-border)',
              transition: 'all 0.15s',
            }}>
              <input type="radio" name="tone" value={t} checked={tone === t}
                onChange={() => setTone(t)} style={{ display: 'none' }} />
              {t}
            </label>
          ))}
        </div>
      </div>
    </div>
  )

  const renderDocumentsStep = () => (
    <div className="animate-in" style={{ display: 'grid', gap: '0.75rem' }}>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
        Define the types of documents your workspace will handle. The Extract option enables
        automatic field extraction during upload.
      </p>
      {docTypes.map((dt, i) => (
        <div key={i} className="card" style={{
          display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.65rem 0.85rem',
        }}>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1.5fr auto', gap: '0.5rem',
            alignItems: 'center' }}>
            <input value={dt.id} onChange={e => updateDocType(i, 'id', e.target.value)}
              placeholder="invoice" style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.78rem' }} />
            <input value={dt.label} onChange={e => updateDocType(i, 'label', e.target.value)}
              placeholder="Invoice" style={inputStyle} />
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer',
              fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={dt.extract}
                onChange={e => updateDocType(i, 'extract', e.target.checked)}
                style={{ width: 14, height: 14, accentColor: 'var(--accent-primary)' }} />
              Extract
            </label>
          </div>
          {docTypes.length > 1 && (
            <button onClick={() => removeDocType(i)} style={{
              padding: '0.25rem 0.5rem', background: 'transparent', color: 'var(--accent-coral)',
              fontSize: '0.75rem', borderRadius: 4, border: '1px solid var(--accent-coral)',
              flexShrink: 0, opacity: 0.7,
            }}>Remove</button>
          )}
        </div>
      ))}
      <button onClick={addDocType} className="btn btn-secondary" style={{
        justifySelf: 'start', fontSize: '0.8rem', padding: '0.5rem 1rem',
      }}>+ Add document type</button>
    </div>
  )

  const renderReviewStep = () => {
    const spec = buildSpec()

    if (deploying || deployDone) {
      return (
        <div className="animate-in" style={{ display: 'grid', gap: '1.25rem' }}>
          {/* Deploy progress */}
          <div style={sectionCard}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '1rem' }}>
              {deployDone ? 'Workspace Deployed' : 'Deploying Workspace...'}
            </h3>
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              {DEPLOY_PHASES.map((p, i) => {
                const current = DEPLOY_PHASES.findIndex(dp => dp.id === deployPhase)
                const isDone = deployDone || i < current
                const isActive = !deployDone && i === current
                return (
                  <div key={p.id} style={{ flex: 1, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: '0.4rem' }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.7rem', fontWeight: 600,
                      background: isDone ? 'var(--accent-green)' : isActive ? 'var(--accent-primary)' : 'var(--bg-elevated)',
                      color: isDone || isActive ? 'var(--bg-deep)' : 'var(--text-muted)',
                      transition: 'all 0.3s',
                    }}>
                      {isDone ? (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M3 7l3 3 5-6" stroke="currentColor" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : isActive ? (
                        <div className="loading-spinner" style={{ width: 14, height: 14,
                          borderWidth: 2, borderColor: 'var(--bg-deep)',
                          borderTopColor: 'transparent' }} />
                      ) : (
                        i + 1
                      )}
                    </div>
                    <span style={{ fontSize: '0.65rem', fontWeight: 500,
                      color: isDone ? 'var(--accent-green)' : isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                    }}>{p.label}</span>
                    {i < DEPLOY_PHASES.length - 1 && (
                      <div style={{ position: 'absolute' }} />
                    )}
                  </div>
                )
              })}
            </div>
            {/* Connector lines */}
            <div style={{ display: 'flex', marginTop: '-2.2rem', marginBottom: '1.5rem',
              padding: '0 2.5rem' }}>
              {DEPLOY_PHASES.slice(0, -1).map((_, i) => {
                const current = DEPLOY_PHASES.findIndex(dp => dp.id === deployPhase)
                const filled = deployDone || i < current
                return (
                  <div key={i} style={{ flex: 1, height: 2, margin: '0 0.25rem',
                    background: filled ? 'var(--accent-green)' : 'var(--bg-elevated)',
                    transition: 'background 0.3s',
                  }} />
                )
              })}
            </div>
          </div>

          {deployError && (
            <div className="error-banner">{deployError}</div>
          )}

          {deployDone && deployUrl && (
            <div className="card animate-in" style={{ padding: '1.25rem', textAlign: 'center',
              borderColor: 'var(--accent-green)' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--accent-green)', fontWeight: 600,
                marginBottom: '0.5rem' }}>
                Your workspace is live
              </p>
              <p style={{ fontSize: '0.95rem', fontFamily: 'monospace', color: 'var(--text-primary)',
                marginBottom: '1rem' }}>
                {deployUrl}
              </p>
              <a href={deployUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary"
                style={{ display: 'inline-block', textDecoration: 'none' }}>
                Open Workspace
              </a>
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="animate-in" style={{ display: 'grid', gap: '1rem' }}>
        {/* Identity summary */}
        <div style={sectionCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600 }}>Identity</h3>
            <button onClick={() => setStep(0)} className="btn-ghost" style={{
              fontSize: '0.7rem', padding: '0.2rem 0.5rem', color: 'var(--accent-primary)',
            }}>Edit</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem',
            fontSize: '0.8rem' }}>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Company</span>
              <div>{spec.company_name}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>App Name</span>
              <div>{spec.name}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Subdomain</span>
              <div style={{ fontFamily: 'monospace' }}>{spec.app_id}.aitherium.com</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Industry</span>
              <div>{spec.industry.charAt(0).toUpperCase() + spec.industry.slice(1)}</div>
            </div>
          </div>
          {spec.description && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {spec.description}
            </div>
          )}
        </div>

        {/* Features summary */}
        <div style={sectionCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600 }}>Features</h3>
            <button onClick={() => setStep(1)} className="btn-ghost" style={{
              fontSize: '0.7rem', padding: '0.2rem 0.5rem', color: 'var(--accent-primary)',
            }}>Edit</button>
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {spec.features.map(f => (
              <span key={f} className="badge badge-info" style={{ fontSize: '0.72rem' }}>
                {FEATURES.find(feat => feat.id === f)?.label || f}
              </span>
            ))}
          </div>
        </div>

        {/* Branding summary */}
        <div style={sectionCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600 }}>Branding</h3>
            <button onClick={() => setStep(2)} className="btn-ghost" style={{
              fontSize: '0.7rem', padding: '0.2rem 0.5rem', color: 'var(--accent-primary)',
            }}>Edit</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, background: spec.branding.primary_color,
                border: '1px solid var(--glass-border)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{spec.branding.primary_color}</span>
            </div>
            <span className="badge">{spec.branding.tone}</span>
          </div>
          {spec.branding.logo_prompt && (
            <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Logo: {spec.branding.logo_prompt}
            </div>
          )}
        </div>

        {/* Documents summary */}
        <div style={sectionCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600 }}>Document Types</h3>
            <button onClick={() => setStep(3)} className="btn-ghost" style={{
              fontSize: '0.7rem', padding: '0.2rem 0.5rem', color: 'var(--accent-primary)',
            }}>Edit</button>
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {spec.doc_types.map(dt => (
              <span key={dt.id} className="badge" style={{ fontSize: '0.72rem' }}>
                {dt.label}{dt.extract ? ' (extract)' : ''}
              </span>
            ))}
          </div>
        </div>

        {/* Deploy button */}
        <button onClick={deploy} className="btn btn-primary" style={{
          padding: '0.75rem 2rem', fontSize: '0.9rem', justifySelf: 'center', marginTop: '0.5rem',
        }}>
          Deploy Workspace
        </button>
      </div>
    )
  }

  // ── Main render ────────────────────────────────────────────────────

  return (
    <div style={{ padding: '1.5rem', maxWidth: 720 }}>
      <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.25rem' }}>
        Create Workspace
      </h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        Set up a new customer workspace with a guided walkthrough.
      </p>

      {renderStepIndicator()}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="error-banner" style={{ marginBottom: '1rem' }}>
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* Step content */}
      {step === 0 && renderIdentityStep()}
      {step === 1 && renderFeaturesStep()}
      {step === 2 && renderAgentStep()}
      {step === 3 && renderBrandingStep()}
      {step === 4 && renderDocumentsStep()}
      {step === 5 && renderReviewStep()}

      {/* Navigation */}
      {!(step === 5 && (deploying || deployDone)) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
          <button onClick={goBack} className="btn btn-ghost" style={{
            visibility: step === 0 ? 'hidden' : 'visible',
          }}>Back</button>
          {step < 5 ? (
            <button onClick={goNext} className="btn btn-primary">Next</button>
          ) : (
            <div />
          )}
        </div>
      )}
    </div>
  )
}
