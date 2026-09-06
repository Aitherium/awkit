'use client'

import React, { useState, useEffect, useCallback } from 'react'
import SoundLibrary from '../storefront/SoundLibrary'
import type { AudioAsset } from '../storefront/AudioTypes'

interface SoundLibraryPanelProps {
  apiBaseUrl?: string
}

export default function SoundLibraryPanel({ apiBaseUrl = '/api/assets' }: SoundLibraryPanelProps) {
  const [assets, setAssets] = useState<AudioAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAssets = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(apiBaseUrl)
      if (!res.ok) throw new Error(`Failed to load assets: ${res.status}`)
      const data = await res.json()
      setAssets(data.assets ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load assets')
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  const handleUpload = useCallback(async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    form.append('name', file.name.replace(/\.[^.]+$/, ''))
    try {
      const res = await fetch(`${apiBaseUrl}/upload`, { method: 'POST', body: form })
      if (!res.ok) throw new Error('Upload failed')
      await fetchAssets()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    }
  }, [apiBaseUrl, fetchAssets])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" style={{ color: 'var(--sf-text-muted)' }}>
        Loading audio assets...
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm mb-2" style={{ color: 'var(--sf-text-muted)' }}>{error}</p>
        <button
          onClick={fetchAssets}
          className="text-xs px-3 py-1 rounded-lg border"
          style={{ borderColor: 'var(--sf-primary)', color: 'var(--sf-primary)' }}
        >
          Retry
        </button>
      </div>
    )
  }

  return <SoundLibrary assets={assets} onUpload={handleUpload} />
}
