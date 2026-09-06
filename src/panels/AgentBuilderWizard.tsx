'use client'

import React, { useState, useCallback, useMemo } from 'react'
import PackCatalog from './PackCatalog'
import AgentPreviewChat from './AgentPreviewChat'
import ModelBrowser from './ModelBrowser'
import LLMProviderConfig, { LLMProviderSettings } from './LLMProviderConfig'
import CheckoutSummary, { LineItem } from './CheckoutSummary'
import { PackCardPack } from './PackCard'

// ── Types ────────────────────────────────────────────────────────────────

export interface AgentBuilderWizardProps {
  apiBase?: string
  elysiumBase?: string
  onComplete?: (result: BuildResult) => void
}

interface BuildResult {
  build_id: string
  download_url?: string
  app_url?: string
  status: string
}

interface Template {
  id: string
  name: string
  description: string
  icon: string
  default_features: string[]
}

const STEPS = ['Template', 'Agent Pack', 'Skills', 'Tools', 'Configure', 'Review'] as const
type Step = 0 | 1 | 2 | 3 | 4 | 5

const TEMPLATES: Template[] = [
  { id: 'assistant', name: 'Assistant', description: 'Conversational AI assistant for general tasks, Q&A, and chat', icon: '\uD83D\uDCAC', default_features: ['chat', 'documents'] },
  { id: 'knowledge-agent', name: 'Knowledge Agent', description: 'RAG-powered agent that answers from your documents and data sources', icon: '\uD83D\uDCDA', default_features: ['chat', 'documents', 'knowledge-rag'] },
  { id: 'creative-agent', name: 'Creative Agent', description: 'Content creation specialist — writing, images, social media', icon: '\uD83C\uDFA8', default_features: ['chat', 'content-studio', 'social'] },
  { id: 'custom', name: 'Custom', description: 'Start from scratch and build exactly what you need', icon: '\uD83D\uDD27', default_features: ['chat'] },
]

const HARDWARE_PROFILES = [
  { id: 'none', label: 'Cloud Only', desc: 'No local GPU — use cloud providers' },
  { id: 'low', label: 'Low (4-8 GB)', desc: '4B-8B parameter models' },
  { id: 'mid', label: 'Mid (12-16 GB)', desc: 'Up to 14B parameter models' },
  { id: 'high', label: 'High (24 GB)', desc: 'Up to 32B parameter models' },
  { id: 'ultra', label: 'Ultra (48+ GB)', desc: '70B+ parameter models' },
]

// ── Styles ───────────────────────────────────────────────────────────────

const sectionCard: React.CSSProperties = {
  padding: '1.25rem',
  background: 'var(--bg-surface, #16162a)',
  border: '1px solid var(--glass-border, #2a2a4a)',
  borderRadius: 'var(--radius, 10px)',
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem', color: 'var(--text-muted, #888)',
  marginBottom: '0.3rem', display: 'block', fontWeight: 500,
}

const inputStyle: React.CSSProperties = {
  padding: '0.55rem 0.75rem', background: 'var(--bg-deep, #111)',
  border: '1px solid var(--glass-border, #333)', borderRadius: 'var(--radius, 8px)',
  color: 'var(--text-primary, #e0e0e0)', fontSize: '0.82rem', width: '100%',
  outline: 'none',
}

// ── Component ────────────────────────────────────────────────────────────

export default function AgentBuilderWizard({
  apiBase = '',
  elysiumBase = '',
  onComplete,
}: AgentBuilderWizardProps) {
  const [step, setStep] = useState<Step>(0)
  const [errors, setErrors] = useState<string[]>([])

  // Step 1: Template
  const [template, setTemplate] = useState('')

  // Step 2: Agent Pack
  const [agentPackId, setAgentPackId] = useState('')
  const [agentPack, setAgentPack] = useState<PackCardPack | null>(null)

  // Step 3: Skills
  const [skillPackIds, setSkillPackIds] = useState<string[]>([])
  const [skillPacks, setSkillPacks] = useState<PackCardPack[]>([])

  // Step 4: Tools
  const [toolPackIds, setToolPackIds] = useState<string[]>([])
  const [toolPacks, setToolPacks] = useState<PackCardPack[]>([])
  const [mcpMode, setMcpMode] = useState<'local' | 'cloud'>('local')

  // Step 5: Configure
  const [systemPrompt, setSystemPrompt] = useState('')
  const [agentName, setAgentName] = useState('')
  const [model, setModel] = useState('')
  const [hwProfile, setHwProfile] = useState('mid')
  const [llmConfig, setLlmConfig] = useState<LLMProviderSettings>({
    provider: 'local', api_key: '', base_url: '', model: '',
  })

  // Step 6: Build
  const [building, setBuilding] = useState(false)
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null)
  const [buildError, setBuildError] = useState('')

  // Pack tracking (for checkout)
  const [purchasedPacks, setPurchasedPacks] = useState<Set<string>>(new Set())

  // ── Validation ──────────────────────────────────────────────────────

  const validate = useCallback((): string[] => {
    const errs: string[] = []
    if (step === 0 && !template) errs.push('Select a template')
    if (step === 4 && !agentName.trim()) errs.push('Agent name is required')
    return errs
  }, [step, template, agentName])

  const goNext = () => {
    const errs = validate()
    setErrors(errs)
    if (errs.length === 0 && step < 5) setStep((step + 1) as Step)
  }

  const goBack = () => {
    setErrors([])
    if (step > 0) setStep((step - 1) as Step)
  }

  // ── Checkout line items ─────────────────────────────────────────────

  const lineItems = useMemo((): LineItem[] => {
    const items: LineItem[] = []
    if (agentPack) {
      items.push({
        name: agentPack.name,
        type: agentPack.pricing_onetime ? 'one-time' : agentPack.pricing_monthly ? 'monthly' : 'one-time',
        amount: agentPack.pricing_onetime || agentPack.pricing_monthly || 0,
        description: `Agent Pack — ${agentPack.type}`,
        packId: agentPack.id,
      })
    }
    for (const sp of skillPacks) {
      items.push({
        name: sp.name,
        type: sp.pricing_onetime ? 'one-time' : sp.pricing_monthly ? 'monthly' : 'one-time',
        amount: sp.pricing_onetime || sp.pricing_monthly || 0,
        description: 'Skill Pack',
        packId: sp.id,
      })
    }
    for (const tp of toolPacks) {
      items.push({
        name: tp.name,
        type: mcpMode === 'cloud' ? 'monthly' : tp.pricing_onetime ? 'one-time' : 'one-time',
        amount: mcpMode === 'cloud' ? (tp.pricing_monthly || 5) : (tp.pricing_onetime || 0),
        description: mcpMode === 'cloud' ? 'Tool Pack (Cloud MCP)' : 'Tool Pack (Local)',
        packId: tp.id,
      })
    }
    return items
  }, [agentPack, skillPacks, toolPacks, mcpMode])

  // ── Build ───────────────────────────────────────────────────────────

  const handleBuild = async () => {
    setBuilding(true)
    setBuildError('')
    try {
      const res = await fetch(`${apiBase}/api/agent-builder/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template,
          agent_pack_id: agentPackId,
          skill_pack_ids: skillPackIds,
          tool_pack_ids: toolPackIds,
          system_prompt: systemPrompt,
          agent_name: agentName,
          model: model || llmConfig.model,
          llm_backend: llmConfig,
          hardware_profile: hwProfile,
          mcp_mode: mcpMode,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || `Build failed: ${res.status}`)
      }
      const result = await res.json()
      setBuildResult(result)
      onComplete?.(result)
    } catch (e: any) {
      setBuildError(e.message || 'Build failed')
    } finally {
      setBuilding(false)
    }
  }

  // ── Step renderers ──────────────────────────────────────────────────

  const renderTemplate = () => (
    <div>
      <h3 style={{ fontSize: 15, marginBottom: 12 }}>Choose a Template</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {TEMPLATES.map(t => (
          <div
            key={t.id}
            onClick={() => setTemplate(t.id)}
            style={{
              ...sectionCard,
              cursor: 'pointer',
              borderColor: template === t.id ? 'var(--accent, #6366f1)' : 'var(--glass-border, #2a2a4a)',
              background: template === t.id ? 'var(--bg-active, #1a2a4a)' : 'var(--bg-surface, #16162a)',
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>{t.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted, #888)' }}>{t.description}</div>
          </div>
        ))}
      </div>
    </div>
  )

  const renderAgentPack = () => (
    <div>
      <h3 style={{ fontSize: 15, marginBottom: 4 }}>Select Agent Pack</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', margin: '0 0 12px' }}>
        Agent packs define your agent's personality, knowledge, and behavior.
      </p>
      <PackCatalog
        apiBase={elysiumBase || apiBase}
        type="agent"
        selectable
        selected={agentPackId ? [agentPackId] : []}
        owned={Array.from(purchasedPacks)}
        onSelectionChange={ids => {
          setAgentPackId(ids[0] || '')
        }}
        onPurchase={pack => {
          // Track for checkout — actual purchase happens at Review step
          setAgentPackId(pack.id)
          setAgentPack(pack)
        }}
      />
    </div>
  )

  const renderSkills = () => (
    <div>
      <h3 style={{ fontSize: 15, marginBottom: 4 }}>Add Skill Packs</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', margin: '0 0 12px' }}>
        Skills add capabilities like CRM, scheduling, content creation, and more. Select multiple.
      </p>
      <PackCatalog
        apiBase={elysiumBase || apiBase}
        type="skill"
        selectable
        multiSelect
        selected={skillPackIds}
        owned={Array.from(purchasedPacks)}
        onSelectionChange={setSkillPackIds}
        onPurchase={pack => {
          if (!skillPackIds.includes(pack.id)) {
            setSkillPackIds([...skillPackIds, pack.id])
            setSkillPacks([...skillPacks, pack])
          }
        }}
      />
    </div>
  )

  const renderTools = () => (
    <div>
      <h3 style={{ fontSize: 15, marginBottom: 4 }}>Select Tool Packs</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', margin: '0 0 12px' }}>
        Tools give your agent abilities like code analysis, web search, file management, and more.
      </p>

      {/* MCP mode toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {(['local', 'cloud'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => setMcpMode(mode)}
            style={{
              padding: '6px 14px', borderRadius: 'var(--radius, 8px)',
              border: `1px solid ${mcpMode === mode ? 'var(--accent, #6366f1)' : 'var(--glass-border, #2a2a4a)'}`,
              background: mcpMode === mode ? 'var(--bg-active, #1a2a4a)' : 'transparent',
              color: 'var(--text-primary, #e0e0e0)', cursor: 'pointer', fontSize: 12,
            }}
          >
            {mode === 'local' ? 'Local Tools ($15 one-time)' : 'Cloud MCP ($5/mo)'}
          </button>
        ))}
      </div>

      <PackCatalog
        apiBase={elysiumBase || apiBase}
        type="tool"
        selectable
        multiSelect
        selected={toolPackIds}
        owned={Array.from(purchasedPacks)}
        onSelectionChange={setToolPackIds}
        onPurchase={pack => {
          if (!toolPackIds.includes(pack.id)) {
            setToolPackIds([...toolPackIds, pack.id])
            setToolPacks([...toolPacks, pack])
          }
        }}
      />
    </div>
  )

  const renderConfigure = () => (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {/* Left: config */}
      <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={sectionCard}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>Agent Identity</h3>
          <label style={labelStyle}>Agent Name *</label>
          <input
            type="text"
            placeholder="My Agent"
            value={agentName}
            onChange={e => setAgentName(e.target.value)}
            style={{ ...inputStyle, marginBottom: 12 }}
          />
          <label style={labelStyle}>System Prompt</label>
          <textarea
            placeholder="You are a helpful assistant that..."
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        <div style={sectionCard}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>Hardware Profile</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {HARDWARE_PROFILES.map(hp => (
              <button
                key={hp.id}
                onClick={() => setHwProfile(hp.id)}
                style={{
                  padding: '6px 12px', borderRadius: 'var(--radius, 8px)', fontSize: 12,
                  border: `1px solid ${hwProfile === hp.id ? 'var(--accent, #6366f1)' : 'var(--glass-border, #2a2a4a)'}`,
                  background: hwProfile === hp.id ? 'var(--bg-active, #1a2a4a)' : 'transparent',
                  color: 'var(--text-primary, #e0e0e0)', cursor: 'pointer',
                }}
              >
                {hp.label}
              </button>
            ))}
          </div>
        </div>

        <div style={sectionCard}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>LLM Backend</h3>
          <LLMProviderConfig
            initialConfig={llmConfig}
            onConfigChange={setLlmConfig}
          />
        </div>

        <div style={sectionCard}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>Model Selection</h3>
          <ModelBrowser
            apiBase={elysiumBase || apiBase}
            selectedModel={model}
            onModelSelect={setModel}
            hardwareProfile={hwProfile}
          />
        </div>
      </div>

      {/* Right: live preview */}
      <div style={{ flex: '1 1 320px', minHeight: 400 }}>
        <div style={{ ...sectionCard, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>Live Preview</h3>
          <div style={{ flex: 1 }}>
            <AgentPreviewChat
              apiBase={elysiumBase || apiBase}
              agentName={agentName || 'Agent'}
              systemPrompt={systemPrompt}
            />
          </div>
        </div>
      </div>
    </div>
  )

  const renderReview = () => (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {/* Left: summary */}
      <div style={{ flex: '1 1 400px' }}>
        <div style={{ ...sectionCard, marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>Build Summary</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted, #888)' }}>Template</span>
              <span>{TEMPLATES.find(t => t.id === template)?.name || 'None'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted, #888)' }}>Agent Name</span>
              <span>{agentName || 'Not set'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted, #888)' }}>Agent Pack</span>
              <span>{agentPack?.name || 'None'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted, #888)' }}>Skill Packs</span>
              <span>{skillPacks.length > 0 ? skillPacks.map(s => s.name).join(', ') : 'None'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted, #888)' }}>Tool Packs</span>
              <span>{toolPacks.length > 0 ? toolPacks.map(t => t.name).join(', ') : 'None'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted, #888)' }}>LLM Provider</span>
              <span>{llmConfig.provider} / {model || llmConfig.model || 'default'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted, #888)' }}>Hardware</span>
              <span>{HARDWARE_PROFILES.find(h => h.id === hwProfile)?.label}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted, #888)' }}>Tools Mode</span>
              <span>{mcpMode === 'cloud' ? 'Cloud MCP (mcp.aitherium.com)' : 'Local'}</span>
            </div>
          </div>
        </div>

        {/* Build output */}
        {buildResult && (
          <div style={{ ...sectionCard, borderColor: '#1a3a1a' }}>
            <h3 style={{ fontSize: 14, marginBottom: 8, color: '#4ade80' }}>Build Complete</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', margin: '0 0 10px' }}>
              Your agent package is ready to download.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {buildResult.download_url && (
                <a
                  href={buildResult.download_url}
                  style={{
                    padding: '8px 16px', borderRadius: 'var(--radius, 8px)', border: 'none',
                    background: 'var(--accent, #6366f1)', color: '#fff', textDecoration: 'none',
                    fontSize: 13, fontWeight: 600,
                  }}
                >
                  Download Package
                </a>
              )}
              {buildResult.app_url && (
                <a
                  href={buildResult.app_url}
                  target="_blank"
                  rel="noopener"
                  style={{
                    padding: '8px 16px', borderRadius: 'var(--radius, 8px)',
                    border: '1px solid var(--glass-border, #2a2a4a)', background: 'transparent',
                    color: 'var(--text-primary, #e0e0e0)', textDecoration: 'none',
                    fontSize: 13, fontWeight: 600,
                  }}
                >
                  Open App
                </a>
              )}
            </div>
          </div>
        )}

        {buildError && (
          <div style={{ ...sectionCard, borderColor: '#3a1a1a', marginTop: 12 }}>
            <div style={{ fontSize: 13, color: '#f87171' }}>{buildError}</div>
          </div>
        )}
      </div>

      {/* Right: checkout */}
      <div style={{ flex: '1 1 320px' }}>
        <CheckoutSummary
          items={lineItems}
          apiBase={elysiumBase || apiBase}
          onCheckoutComplete={() => handleBuild()}
          onBack={goBack}
        />
      </div>
    </div>
  )

  // ── Main render ─────────────────────────────────────────────────────

  const stepContent = [renderTemplate, renderAgentPack, renderSkills, renderTools, renderConfigure, renderReview]

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700 }}>Agent Builder</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted, #888)' }}>
          Build your agent in the cloud, run it on your hardware.
        </p>
      </div>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
        {STEPS.map((label, i) => (
          <div
            key={label}
            onClick={() => i < step ? setStep(i as Step) : undefined}
            style={{
              flex: 1, padding: '8px 0', textAlign: 'center',
              fontSize: 11, fontWeight: step === i ? 700 : 400,
              color: i <= step ? 'var(--text-primary, #e0e0e0)' : 'var(--text-muted, #555)',
              borderBottom: `2px solid ${i === step ? 'var(--accent, #6366f1)' : i < step ? '#4ade80' : 'var(--glass-border, #2a2a4a)'}`,
              cursor: i < step ? 'pointer' : 'default',
              transition: 'all 0.2s',
            }}
          >
            {i < step ? '\u2713 ' : ''}{label}
          </div>
        ))}
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div style={{
          padding: '8px 14px', marginBottom: 16, borderRadius: 'var(--radius, 8px)',
          background: '#1a0a0a', border: '1px solid #3a1a1a', fontSize: 12, color: '#f87171',
        }}>
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* Step content */}
      <div style={{ marginBottom: 24 }}>
        {stepContent[step]()}
      </div>

      {/* Navigation */}
      {step < 5 && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button
            onClick={goBack}
            disabled={step === 0}
            style={{
              padding: '9px 20px', borderRadius: 'var(--radius, 8px)',
              background: 'transparent', border: '1px solid var(--glass-border, #2a2a4a)',
              color: 'var(--text-primary, #e0e0e0)', cursor: step === 0 ? 'default' : 'pointer',
              fontSize: 13, opacity: step === 0 ? 0.3 : 1,
            }}
          >
            Back
          </button>
          <button
            onClick={goNext}
            style={{
              padding: '9px 24px', borderRadius: 'var(--radius, 8px)', border: 'none',
              background: 'var(--accent, #6366f1)', color: '#fff',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            {step === 4 ? 'Review & Build' : 'Next'}
          </button>
        </div>
      )}
    </div>
  )
}
