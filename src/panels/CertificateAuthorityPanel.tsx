'use client'

import { useState, useEffect, useCallback } from 'react'

/* ── Types ─────────────────────────────────────────────────────────── */

interface CA {
  ca_id: string
  owner: string
  name: string
  created_at: string
  root_fingerprint?: string
  has_intermediate?: boolean
}

interface Certificate {
  serial: string
  common_name: string
  sans?: string[]
  expires_at: string
  revoked?: boolean
  fingerprint?: string
  ca_id?: string
  days_remaining?: number
}

interface IssuedResult {
  cert_pem: string
  key_pem: string
  chain_pem: string
  serial: string
  fingerprint?: string
  expires_at?: string
}

export interface CertificateAuthorityPanelProps {
  apiBase?: string
}

/* ── Styles ────────────────────────────────────────────────────────── */

const sBtn = (primary = false): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 6,
  border: primary ? 'none' : '1px solid var(--border)',
  background: primary ? 'var(--accent)' : 'transparent',
  color: primary ? '#fff' : 'var(--text-muted)',
  cursor: 'pointer', fontSize: '0.8rem', fontWeight: primary ? 600 : 400,
})

const sBtnDanger: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, border: 'none',
  background: '#dc2626', color: '#fff', cursor: 'pointer',
  fontSize: '0.8rem', fontWeight: 600,
}

const sInput: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-deep)',
  color: 'var(--text)', width: '100%', boxSizing: 'border-box',
}

const sCard: React.CSSProperties = {
  padding: '12px 16px', borderRadius: 8,
  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
}

const sTab = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px', cursor: 'pointer', fontSize: '0.85rem',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  color: active ? 'var(--text)' : 'var(--text-muted)',
  fontWeight: active ? 600 : 400, background: 'none', border: 'none',
  borderBottomWidth: 2, borderBottomStyle: 'solid',
  borderBottomColor: active ? 'var(--accent)' : 'transparent',
})

const sBadge = (color: string): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 10,
  fontSize: '0.7rem', fontWeight: 600, background: color, color: '#fff',
})

/* ── Component ─────────────────────────────────────────────────────── */

type Tab = 'authorities' | 'certificates' | 'issue'

export default function CertificateAuthorityPanel({
  apiBase = '/api/ca',
}: CertificateAuthorityPanelProps) {
  const [tab, setTab] = useState<Tab>('authorities')
  const [cas, setCas] = useState<CA[]>([])
  const [selectedCA, setSelectedCA] = useState<string | null>(null)
  const [certs, setCerts] = useState<Certificate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create CA form
  const [showCreate, setShowCreate] = useState(false)
  const [caName, setCaName] = useState('')
  const [caOwner, setCaOwner] = useState('')
  const [caPassphrase, setCaPassphrase] = useState('')

  // Issue form
  const [issueCN, setIssueCN] = useState('')
  const [issueSANs, setIssueSANs] = useState('')
  const [issueValidity, setIssueValidity] = useState('365')
  const [issuePassphrase, setIssuePassphrase] = useState('')
  const [issuedResult, setIssuedResult] = useState<IssuedResult | null>(null)

  // Revoke confirmation
  const [revokeSerial, setRevokeSerial] = useState<string | null>(null)
  const [revokePassphrase, setRevokePassphrase] = useState('')

  // ── Data Fetching ─────────────────────────────────────────────────

  const fetchCAs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(apiBase)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setCas(data.cas || [])
    } catch (e: any) {
      setError(e.message || 'Failed to load CAs')
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  const fetchCerts = useCallback(async (caId: string) => {
    try {
      const res = await fetch(`${apiBase}/${caId}/certs`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setCerts(data.certificates || [])
    } catch {
      setCerts([])
    }
  }, [apiBase])

  useEffect(() => { fetchCAs() }, [fetchCAs])
  useEffect(() => {
    if (selectedCA) fetchCerts(selectedCA)
    else setCerts([])
  }, [selectedCA, fetchCerts])

  // ── Actions ───────────────────────────────────────────────────────

  const handleCreateCA = async () => {
    if (!caName || !caOwner || caPassphrase.length < 12) {
      setError('Name, owner required; passphrase must be 12+ characters')
      return
    }
    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: caName, owner: caOwner, passphrase: caPassphrase,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      setShowCreate(false)
      setCaName(''); setCaOwner(''); setCaPassphrase('')
      fetchCAs()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleIssueCert = async () => {
    if (!selectedCA || !issueCN || issuePassphrase.length < 1) {
      setError('Select a CA, enter CN, and provide passphrase')
      return
    }
    try {
      const sans = issueSANs ? issueSANs.split(',').map(s => s.trim()).filter(Boolean) : undefined
      const res = await fetch(`${apiBase}/${selectedCA}/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          common_name: issueCN, sans,
          validity_days: parseInt(issueValidity) || 365,
          passphrase: issuePassphrase,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setIssuedResult(data)
      if (selectedCA) fetchCerts(selectedCA)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleRevoke = async () => {
    if (!selectedCA || !revokeSerial) return
    try {
      const res = await fetch(`${apiBase}/${selectedCA}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: revokeSerial, passphrase: revokePassphrase }),
      })
      if (!res.ok) throw new Error(await res.text())
      setRevokeSerial(null)
      setRevokePassphrase('')
      if (selectedCA) fetchCerts(selectedCA)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleDownloadChain = (caId: string) => {
    window.open(`${apiBase}/${caId}/chain`, '_blank')
  }

  const downloadPEM = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'application/x-pem-file' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const daysUntilExpiry = (expiresAt: string): number | null => {
    try {
      const exp = new Date(expiresAt)
      return Math.floor((exp.getTime() - Date.now()) / 86400000)
    } catch { return null }
  }

  const expiryBadge = (expiresAt: string) => {
    const days = daysUntilExpiry(expiresAt)
    if (days === null) return null
    if (days < 0) return <span style={sBadge('#dc2626')}>Expired</span>
    if (days <= 30) return <span style={sBadge('#d97706')}>{days}d left</span>
    return <span style={sBadge('#059669')}>{days}d</span>
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Certificate Authority</h2>
      </div>

      {error && (
        <div style={{ ...sCard, background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b' }}>
          {error}
          <button style={{ ...sBtn(), marginLeft: 8, fontSize: '0.7rem' }} onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
        <button style={sTab(tab === 'authorities')} onClick={() => setTab('authorities')}>Authorities</button>
        <button style={sTab(tab === 'certificates')} onClick={() => setTab('certificates')}>Certificates</button>
        <button style={sTab(tab === 'issue')} onClick={() => setTab('issue')}>Issue</button>
      </div>

      {/* ── Authorities Tab ─────────────────────────────────────── */}
      {tab === 'authorities' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button style={sBtn(true)} onClick={() => setShowCreate(!showCreate)}>
              {showCreate ? 'Cancel' : 'Create CA'}
            </button>
          </div>

          {showCreate && (
            <div style={{ ...sCard, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input style={sInput} placeholder="CA Name" value={caName} onChange={e => setCaName(e.target.value)} />
              <input style={sInput} placeholder="Owner" value={caOwner} onChange={e => setCaOwner(e.target.value)} />
              <input style={sInput} type="password" placeholder="Passphrase (min 12 chars)" value={caPassphrase} onChange={e => setCaPassphrase(e.target.value)} />
              <button style={sBtn(true)} onClick={handleCreateCA}>Create</button>
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Loading...</div>
          ) : cas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No CAs created yet</div>
          ) : (
            cas.map(ca => (
              <div
                key={ca.ca_id}
                style={{
                  ...sCard,
                  cursor: 'pointer',
                  border: selectedCA === ca.ca_id ? '1px solid var(--accent)' : '1px solid var(--border)',
                }}
                onClick={() => { setSelectedCA(ca.ca_id); setTab('certificates') }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{ca.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {ca.ca_id} &middot; {ca.owner} &middot; {ca.created_at?.split('T')[0]}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {ca.has_intermediate && <span style={sBadge('#6366f1')}>Intermediate</span>}
                    <button style={sBtn()} onClick={e => { e.stopPropagation(); handleDownloadChain(ca.ca_id) }}>Chain</button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Certificates Tab ────────────────────────────────────── */}
      {tab === 'certificates' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!selectedCA ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
              Select a CA from the Authorities tab first
            </div>
          ) : (
            <>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Certificates for <strong>{selectedCA}</strong>
              </div>
              {certs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>No certificates issued yet</div>
              ) : (
                certs.map(cert => (
                  <div key={cert.serial} style={sCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{cert.common_name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Serial: {cert.serial}
                          {cert.sans?.length ? ` | SANs: ${cert.sans.join(', ')}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {cert.revoked
                          ? <span style={sBadge('#dc2626')}>Revoked</span>
                          : expiryBadge(cert.expires_at)}
                        {!cert.revoked && (
                          <button
                            style={sBtnDanger}
                            onClick={() => { setRevokeSerial(cert.serial); setRevokePassphrase('') }}
                          >Revoke</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}

              {/* Revoke confirmation dialog */}
              {revokeSerial && (
                <div style={{ ...sCard, border: '1px solid #fca5a5' }}>
                  <div style={{ marginBottom: 8, fontWeight: 600, color: '#dc2626' }}>
                    Revoke certificate {revokeSerial}?
                  </div>
                  <input
                    style={sInput}
                    type="password"
                    placeholder="CA passphrase to confirm"
                    value={revokePassphrase}
                    onChange={e => setRevokePassphrase(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button style={sBtnDanger} onClick={handleRevoke}>Confirm Revoke</button>
                    <button style={sBtn()} onClick={() => setRevokeSerial(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Issue Tab ───────────────────────────────────────────── */}
      {tab === 'issue' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {!selectedCA ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
              Select a CA from the Authorities tab first
            </div>
          ) : (
            <>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Issuing from <strong>{selectedCA}</strong>
              </div>
              <div style={{ ...sCard, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input style={sInput} placeholder="Common Name (e.g. myserver.local)" value={issueCN} onChange={e => setIssueCN(e.target.value)} />
                <input style={sInput} placeholder="SANs (comma-separated, optional)" value={issueSANs} onChange={e => setIssueSANs(e.target.value)} />
                <input style={sInput} type="number" placeholder="Validity (days)" value={issueValidity} onChange={e => setIssueValidity(e.target.value)} />
                <input style={sInput} type="password" placeholder="CA Passphrase" value={issuePassphrase} onChange={e => setIssuePassphrase(e.target.value)} />
                <button style={sBtn(true)} onClick={handleIssueCert}>Issue Certificate</button>
              </div>

              {issuedResult && (
                <div style={{ ...sCard, border: '1px solid #059669' }}>
                  <div style={{ fontWeight: 600, color: '#059669', marginBottom: 8 }}>Certificate Issued</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                    Serial: {issuedResult.serial}
                    {issuedResult.expires_at && ` | Expires: ${issuedResult.expires_at.split('T')[0]}`}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button style={sBtn(true)} onClick={() => downloadPEM('cert.pem', issuedResult.cert_pem)}>Download Cert</button>
                    <button style={sBtn(true)} onClick={() => downloadPEM('key.pem', issuedResult.key_pem)}>Download Key</button>
                    <button style={sBtn()} onClick={() => downloadPEM('chain.pem', issuedResult.chain_pem)}>Download Chain</button>
                  </div>
                  <div style={{ marginTop: 8, fontSize: '0.7rem', color: '#d97706' }}>
                    Save the private key now — it will NOT be shown again.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
