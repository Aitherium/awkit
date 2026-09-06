'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import LLMConfigPanel from './LLMConfigPanel'

interface ProviderInfo {
  provider: string
  fallback: string | null
  available_providers: string[]
  pii_scrubbing?: boolean
  pii_categories?: string
}

interface PlatformStatus {
  [key: string]: { status: string; url?: string }
}

interface EmbedConfig {
  app_name?: string
  app_url?: string
  [key: string]: any
}

export default function SettingsPanel() {
  const { user } = useAuth()
  const isAdmin = (user as any)?.role === 'admin'
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const [platform, setPlatform] = useState<PlatformStatus | null>(null)
  const [stats, setStats] = useState<any>(null)
  const [embedConfig, setEmbedConfig] = useState<EmbedConfig | null>(null)

  useEffect(() => {
    fetch('/api/config/provider').then(r => r.json()).then(setProvider).catch(() => {})
    fetch('/api/platform/status').then(r => r.json()).then(setPlatform).catch(() => {})
    fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {})
    fetch('/api/config/embed').then(r => r.json()).then(setEmbedConfig).catch(() => {})
  }, [])

  const appUrl = embedConfig?.app_url || window.location.hostname

  const StatusDot = ({ ok }: { ok: boolean }) => (
    <span style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
      background: ok ? 'var(--accent-green)' : 'var(--accent-coral)' }} />
  )

  return (
    <div style={{ padding: '1.5rem', maxWidth: 800 }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1.5rem' }}>Settings</h2>

      {/* LLM Provider — admins get the full editable config (primary/fallback
          providers, keys, test-connection); members see the read-only summary. */}
      {isAdmin ? (
        <section style={{ marginBottom: '2rem' }}>
          <LLMConfigPanel />
        </section>
      ) : (
        <>
          <section style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
              LLM Provider
            </h3>
            <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: 'var(--radius)',
              border: '1px solid var(--glass-border)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Active:</span>
                <span style={{ fontWeight: 600 }}>{provider?.provider || 'loading...'}</span>
                <span style={{ color: 'var(--text-muted)' }}>Fallback:</span>
                <span>{provider?.fallback || 'none'}</span>
              </div>
            </div>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
              Embedding Model
            </h3>
            <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: 'var(--radius)',
              border: '1px solid var(--glass-border)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Primary:</span>
                <span>{provider?.provider ? `${provider.provider} embeddings` : 'loading...'}</span>
                <span style={{ color: 'var(--text-muted)' }}>Fallback:</span>
                <span>{provider?.fallback ? `${provider.fallback} embeddings` : 'none'}</span>
                <span style={{ color: 'var(--text-muted)' }}>Service:</span>
                <span>{provider?.provider || 'loading...'}</span>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Platform Services */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
          Platform Services
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem' }}>
          {platform && Object.entries(platform).filter(([k]) => !['deployment_mode', 'portal'].includes(k)).map(([name, svc]) => (
            <div key={name} style={{ padding: '0.75rem', background: 'var(--bg-surface)',
              borderRadius: 'var(--radius)', border: '1px solid var(--glass-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <StatusDot ok={typeof svc === 'object' && svc?.status === 'ok'} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'capitalize' }}>{name}</span>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {typeof svc === 'object' ? svc?.status || 'unknown' : svc}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Knowledge Base Stats */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
          Knowledge Base
        </h3>
        <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: 'var(--radius)',
          border: '1px solid var(--glass-border)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
          {[
            { label: 'Documents', value: stats?.documents ?? 0 },
            { label: 'Staff', value: stats?.staff ?? 0 },
            { label: 'Projects', value: stats?.projects ?? 0 },
            { label: 'Feedback', value: stats?.feedback_entries ?? 0 },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{s.value}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* PII Scrubbing */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
          Privacy & Security
        </h3>
        <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: 'var(--radius)',
          border: '1px solid var(--glass-border)', fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>PII Scrubbing</span>
            <span style={{
              color: provider?.pii_scrubbing === false ? 'var(--accent-coral)' : 'var(--accent-green)',
              fontWeight: 500,
            }}>
              {provider ? (provider.pii_scrubbing === false ? 'Disabled' : 'Enabled') : 'loading...'}
            </span>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
            {provider?.pii_categories
              ? `Automatically scrubs ${provider.pii_categories.split(',').join(', ')} from uploaded documents.`
              : 'Automatically scrubs emails, phone numbers, SSNs, and addresses from uploaded documents.'}
          </p>
        </div>
      </section>

      {/* Deployment Info */}
      <section>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
          Deployment
        </h3>
        <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: 'var(--radius)',
          border: '1px solid var(--glass-border)', display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>Mode:</span>
          <span>{String((platform as any)?.deployment_mode || 'standalone')}</span>
          <span style={{ color: 'var(--text-muted)' }}>Portal:</span>
          <a href={typeof platform?.portal === 'string' ? platform.portal : `https://${appUrl}`}
            target="_blank" rel="noopener" style={{ color: 'var(--accent-primary)' }}>
            {appUrl}
          </a>
          <span style={{ color: 'var(--text-muted)' }}>App URL:</span>
          <span>{appUrl}</span>
        </div>
      </section>
    </div>
  )
}
