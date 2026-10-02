/**
 * SurfacesPanel -- where everything else lives: the product UI on this box, awsh, and
 * the hosted Aitherium surfaces. Reads GET /api/appliance/surfaces, which the console
 * derives from awnix-surfaces.yaml for this image's variant.
 *
 * Delivery is stated, not implied: a hosted link opens in a new tab, an
 * 'image-private' surface says it arrives after activation, and a BUSL surface
 * carries the personal-use note.
 */
import { useState } from 'react'
import { Badge, StateNotice, useApplianceCall } from './ApplianceConsole'
import type { AppliancePanelProps, Surface } from './types'

const DELIVERY_COPY: Record<string, { label: string; tone: string }> = {
  baked: { label: 'On this machine', tone: 'ok' },
  'image-private': { label: 'After activation', tone: 'warn' },
  link: { label: 'Hosted', tone: 'muted' },
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="awx-command">
      <code>{command}</code>
      <button type="button" className="awx-btn awx-btn-quiet" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function SurfaceCard({ s }: { s: Surface }) {
  const d = DELIVERY_COPY[s.delivery] ?? { label: s.delivery, tone: 'muted' }
  const busl = s.licence === 'BUSL-1.1'
  return (
    <article className="awx-card" data-surface={s.id}>
      <header className="awx-card-head">
        <h2>{s.label}</h2>
        <Badge tone={d.tone}>{d.label}</Badge>
      </header>
      {s.description ? <p className="awx-muted">{s.description}</p> : null}
      {s.url && s.delivery !== 'image-private' ? (
        <p>
          <a className="awx-link" href={s.url} target="_blank" rel="noopener noreferrer">
            Open {s.label}
          </a>
        </p>
      ) : null}
      {s.command ? <CopyCommand command={s.command} /> : null}
      {s.delivery === 'image-private' ? (
        <p className="awx-muted">
          Installed from a private registry once this machine’s license is active.
        </p>
      ) : null}
      <p className="awx-licence">
        Licence: {s.licence}
        {busl ? ' — free for personal and non-commercial use; a company needs a license.' : ''}
      </p>
    </article>
  )
}

export function SurfacesPanel({ client }: AppliancePanelProps) {
  const { result, reload } = useApplianceCall(() => client.surfaces())
  if (!result) return <p className="awx-muted" aria-busy="true">Loading…</p>
  if (result.state !== 'ok' || !result.data) {
    return <StateNotice result={result} onRetry={() => void reload()} />
  }
  const items = result.data.surfaces.filter((s) => s.id !== 'console')
  if (!items.length) {
    return (
      <StateNotice
        result={{ state: 'unavailable', status: 200, detail: 'This image offers no other surfaces.' }}
      />
    )
  }
  return (
    <section className="awx-grid">
      {items.map((s) => (
        <SurfaceCard key={s.id} s={s} />
      ))}
    </section>
  )
}

export default SurfacesPanel
