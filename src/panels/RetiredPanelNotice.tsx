'use client'

/**
 * RetiredPanelNotice — what a host shows in place of a panel id that was retired
 * into another surface (registry.ts RETIRED_PANELS).
 *
 * A host whose stored config still names a retired id used to lose the panel in
 * silence: a console warning nobody reads, and a teacher whose "Lesson Studio"
 * tab was simply gone. The id now keeps a place in the nav under its successor's
 * name, and that place says what moved and LINKS to where it went.
 *
 * Not a panel: no registry entry, no barrel export. DynamicPanelRenderer renders it.
 */

import { type RetiredPanel, retiredPanelHref } from './registry'

export interface RetiredPanelNoticeProps {
  /** The retired panel id, for the test hook only. */
  id: string
  gone: RetiredPanel
  /** Where this host serves the successor, when it does (else the public door). */
  hostUrl?: string | null
}

export default function RetiredPanelNotice({ id, gone, hostUrl }: RetiredPanelNoticeProps) {
  const href = retiredPanelHref(gone, hostUrl)
  return (
    <section
      data-testid="retired-panel-notice"
      data-retired-id={id}
      style={{ maxWidth: 560, margin: '0 auto', padding: 24, display: 'grid', gap: 12 }}
    >
      <p style={{
        margin: 0, fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12,
        letterSpacing: '0.08em', textTransform: 'lowercase', color: 'var(--text-muted, currentColor)', opacity: 0.8,
      }}>
        {'moved'}
      </p>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
        {`${gone.was} is now part of ${gone.successor}`}
      </h2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{`${gone.note}.`}</p>
      <p style={{ margin: 0 }}>
        <a
          href={href}
          style={{
            display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 16px',
            border: '1px solid var(--border, currentColor)', borderRadius: 8, fontSize: 14, fontWeight: 600,
            color: 'inherit', textDecoration: 'none',
          }}
        >
          {`Open ${gone.successor}`}
        </a>
      </p>
    </section>
  )
}
