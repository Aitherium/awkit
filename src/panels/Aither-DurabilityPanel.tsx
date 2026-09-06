'use client'

import { useState } from 'react'

/**
 * Aither Durability panel — per-user encrypted GitHub backup + DR restore.
 * Thin UI over the SecurityCore /recover/user-backup/* and /recover/user-restore/*
 * routes. Backend lives in services/security/AitherRecover.py; this is the
 * discoverable product surface (10-layer layer 5).
 *
 * NOTE: This is a DEMO shell. There is NO Veil proxy to SecurityCore /recover
 * yet, so the default apiBase points nowhere usable. The registry marks this
 * panel state:'demo' until a /api/v1/durability proxy route is wired.
 */
export default function AitherDurabilityPanel({ apiBase = '/recover' }: { apiBase?: string }) {
  const [userId, setUserId] = useState('me')
  const [status, setStatus] = useState<string>('')
  const [busy, setBusy] = useState(false)

  async function trigger(action: 'backup' | 'backup-all' | 'restore') {
    setBusy(true)
    setStatus('Working…')
    try {
      const url =
        action === 'backup-all'
          ? `${apiBase}/user-backup/all`
          : action === 'backup'
            ? `${apiBase}/user-backup/${userId}`
            : `${apiBase}/user-restore/${userId}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes: undefined, write_back: false }),
      })
      const data = await res.json()
      setStatus(JSON.stringify(data, null, 2))
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <h2>Aither Durability</h2>
      <p>
        Per-user encrypted, scope-diffed GitHub backup and DR restore. Each
        user&apos;s data (identity, tenant, workspace, saga, lockbox, chronicle,
        artifacts, persona) is Fernet-encrypted and pushed to a private
        Aitherium/backup-user-{'{username}'} repo.
      </p>
      <div style={{ display: 'flex', gap: 8, margin: '12px 0', alignItems: 'center' }}>
        <label>
          User:{' '}
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            style={{ padding: 4 }}
          />
        </label>
        <button disabled={busy} onClick={() => trigger('backup')}>
          Backup
        </button>
        <button disabled={busy} onClick={() => trigger('backup-all')}>
          Backup All
        </button>
        <button disabled={busy} onClick={() => trigger('restore')}>
          Restore
        </button>
      </div>
      {status && (
        <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
          {status}
        </pre>
      )}
    </div>
  )
}
