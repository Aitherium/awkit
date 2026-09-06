'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Palette, Type, Sun, Moon, Sparkles, Save, Loader2 } from 'lucide-react'

export interface BrandDesignerPanelProps {
  apiBase?: string
}

interface ThemeState {
  mode: string
  palette: Record<string, string>
  typography: Record<string, string>
}

const COLOR_FIELDS = [
  { key: 'accent_primary', label: 'Primary Accent' },
  { key: 'accent_secondary', label: 'Secondary Accent' },
  { key: 'bg_deep', label: 'Background Deep' },
  { key: 'bg_base', label: 'Background Base' },
  { key: 'bg_surface', label: 'Surface' },
  { key: 'bg_elevated', label: 'Elevated' },
  { key: 'text_primary', label: 'Text Primary' },
  { key: 'text_secondary', label: 'Text Secondary' },
  { key: 'text_muted', label: 'Text Muted' },
]

const FONT_OPTIONS = [
  'Inter', 'Geist', 'DM Sans', 'Space Grotesk', 'Outfit', 'Plus Jakarta Sans',
  'Source Sans Pro', 'Poppins', 'Nunito', 'Rubik',
]

export default function BrandDesignerPanel({ apiBase = '' }: BrandDesignerPanelProps) {
  const [theme, setTheme] = useState<ThemeState>({ mode: 'dark', palette: {}, typography: {} })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<string>('')

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${apiBase}/api/brand`)
        if (res.ok) {
          const data = await res.json()
          setTheme({
            mode: data.theme?.mode || 'dark',
            palette: data.theme?.palette || {},
            typography: data.theme?.typography || {},
          })
        }
      } catch { /* non-fatal */ }
      setLoading(false)
    }
    load()
  }, [apiBase])

  const updatePalette = useCallback((key: string, value: string) => {
    setTheme(prev => ({ ...prev, palette: { ...prev.palette, [key]: value } }))
    setDirty(true)
  }, [])

  const toggleMode = useCallback(() => {
    setTheme(prev => ({ ...prev, mode: prev.mode === 'dark' ? 'light' : 'dark' }))
    setDirty(true)
  }, [])

  const updateFont = useCallback((value: string) => {
    setTheme(prev => ({ ...prev, typography: { ...prev.typography, font_family: value } }))
    setDirty(true)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setStatus('')
    try {
      const res = await fetch(`${apiBase}/api/brand/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ palette: theme.palette, typography: theme.typography, mode: theme.mode }),
      })
      if (res.ok) {
        const data = await res.json()
        setDirty(false)
        setStatus('Saved! CSS variables updated.')
        if (data.css_vars) {
          for (const [varName, value] of Object.entries(data.css_vars)) {
            document.documentElement.style.setProperty(varName, value as string)
          }
        }
      } else { setStatus('Save failed.') }
    } catch { setStatus('Cannot connect to backend.') }
    setSaving(false)
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setStatus('')
    try {
      const res = await fetch(`${apiBase}/api/brand/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'palette', prompt: 'Refresh the brand palette' }),
      })
      if (res.ok) setStatus('Iris dispatched. Refresh in a few seconds.')
      else setStatus('Iris unavailable.')
    } catch { setStatus('Cannot connect to Iris.') }
    setGenerating(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-purple-400" />
          <h2 className="text-lg font-semibold text-zinc-200">Brand Designer</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleGenerate} disabled={generating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 transition-colors disabled:opacity-50">
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Generate with Iris
          </button>
          <button onClick={handleSave} disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </button>
        </div>
      </div>

      {status && <div className="px-3 py-2 rounded-lg bg-white/[0.04] text-xs text-zinc-300">{status}</div>}

      {/* Theme Mode */}
      <div>
        <div className="text-xs text-zinc-500 mb-2 font-medium uppercase tracking-wider">Theme Mode</div>
        <button onClick={toggleMode} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.06] transition-colors">
          {theme.mode === 'dark' ? <Moon className="h-4 w-4 text-indigo-400" /> : <Sun className="h-4 w-4 text-amber-400" />}
          <span className="text-sm text-zinc-300 capitalize">{theme.mode}</span>
        </button>
      </div>

      {/* Colors */}
      <div>
        <div className="text-xs text-zinc-500 mb-3 font-medium uppercase tracking-wider flex items-center gap-1.5"><Palette className="h-3 w-3" /> Colors</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {COLOR_FIELDS.map(field => (
            <div key={field.key} className="flex items-center gap-3">
              <label className="text-xs text-zinc-400 w-32 shrink-0">{field.label}</label>
              <div className="flex items-center gap-2 flex-1">
                <input type="color" value={theme.palette[field.key] || '#6366f1'} onChange={e => updatePalette(field.key, e.target.value)}
                  className="h-8 w-8 rounded border border-white/10 cursor-pointer bg-transparent" />
                <input type="text" value={theme.palette[field.key] || ''} onChange={e => updatePalette(field.key, e.target.value)} placeholder="#hex"
                  className="flex-1 px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Typography */}
      <div>
        <div className="text-xs text-zinc-500 mb-3 font-medium uppercase tracking-wider flex items-center gap-1.5"><Type className="h-3 w-3" /> Typography</div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-zinc-400 w-32 shrink-0">Font Family</label>
          <select value={theme.typography.font_family || 'Inter'} onChange={e => updateFont(e.target.value)}
            className="flex-1 px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/50">
            {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      {/* Live Preview */}
      <div>
        <div className="text-xs text-zinc-500 mb-3 font-medium uppercase tracking-wider">Live Preview</div>
        <div className="rounded-xl border border-white/[0.06] overflow-hidden" style={{
          background: theme.palette.bg_base || '#111118',
          color: theme.palette.text_primary || '#ffffff',
          fontFamily: theme.typography.font_family || 'Inter',
        }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: (theme.palette.bg_elevated || '#222230') + '80' }}>
            <div className="text-sm font-semibold">Workspace Preview</div>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                style={{ background: theme.palette.accent_primary || '#6366f1' }}>W</div>
              <div>
                <div className="text-sm font-medium" style={{ color: theme.palette.text_primary }}>Workspace Name</div>
                <div className="text-xs" style={{ color: theme.palette.text_muted || '#666680' }}>Your AI assistant</div>
              </div>
            </div>
            <button className="px-3 py-1.5 rounded-lg text-xs font-medium text-white"
              style={{ background: theme.palette.accent_primary || '#6366f1' }}>Primary Action</button>
          </div>
        </div>
      </div>
    </div>
  )
}
