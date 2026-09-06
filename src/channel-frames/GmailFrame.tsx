/**
 * GmailFrame — an email opened in Gmail's reading pane.
 *
 * Renders a faithful mockup of how the artifact would appear in Gmail,
 * with the platform's actual light palette and typography.
 */

import type { ChannelFrameProps } from './types'
import { brandMonogram, brandAccent } from './types'

export default function GmailFrame({
  brand,
  content,
  width = 600,
  className = '',
}: ChannelFrameProps) {
  const accentColor = brandAccent(brand)
  const bodyParagraphs = content.body.split('\n').filter(p => p.trim())

  const fromEmail = content.meta?.fromEmail || (brand.handle ? `${brand.handle}@${brand.website || 'brand.com'}` : `hello@${brand.name.toLowerCase().replace(/\s+/g, '')}.com`)
  const timestamp = content.meta?.timestamp || '10:42 AM'
  const preheader = content.meta?.preheader

  return (
    <div style={{ width: `${width}px`, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Channel label */}
      <div style={{
        fontSize: '0.7rem',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-muted, #4A6A8A)',
      }}>
        Email — Gmail
      </div>

      {/* Outer wrapper */}
      <div
        className={className}
        style={{
          background: 'var(--bg-elevated, #1A2A40)',
          border: '1px solid var(--glass-border, rgba(26,42,64,0.8))',
          borderRadius: 'var(--radius-lg, 12px)',
          padding: '10px',
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        {/* Inner Gmail mockup */}
        <div style={{
          background: '#fff',
          borderRadius: '8px',
          overflow: 'hidden',
          fontFamily: "'Roboto', 'Helvetica Neue', Arial, sans-serif",
          fontSize: '0.875rem',
          lineHeight: 1.6,
          color: '#5f6368',
        }}>
          {/* Subject row */}
          <div style={{
            padding: '16px 16px 12px',
            borderBottom: '1px solid #e8eaed',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: '1.375rem',
                fontWeight: 500,
                color: '#202124',
                marginBottom: 4,
              }}>
                {content.headline || '(No subject)'}
              </div>
              <div style={{
                display: 'inline-block',
                background: '#f1f3f4',
                color: '#5f6368',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontWeight: 500,
              }}>
                Inbox
              </div>
            </div>
          </div>

          {/* Sender row */}
          <div style={{
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            borderBottom: '1px solid #e8eaed',
          }}>
            {/* Avatar */}
            <div style={{
              width: 40,
              height: 40,
              minWidth: 40,
              borderRadius: '50%',
              background: brand.logoUrl ? 'transparent' : accentColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
              fontWeight: 600,
              color: '#fff',
              backgroundImage: brand.logoUrl ? `url(${brand.logoUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}>
              {!brand.logoUrl && brandMonogram(brand)}
            </div>

            {/* Sender info */}
            <div style={{ flex: 1 }}>
              <div>
                <span style={{ color: '#202124', fontWeight: 500 }}>{brand.name}</span>
                <span style={{ color: '#5f6368', marginLeft: 4 }}>&lt;{fromEmail}&gt;</span>
              </div>
              <div style={{
                fontSize: '0.75rem',
                color: '#5f6368',
                marginTop: 2,
              }}>
                to me ▾
              </div>
            </div>

            {/* Time and icons */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              color: '#5f6368',
            }}>
              <div style={{ fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                {timestamp}
              </div>
              {/* Star icon */}
              <svg style={{ width: 20, height: 20, cursor: 'pointer' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 10.26 24 10.35 17.77 16.88 20.16 25.59 12 20.12 3.84 25.59 6.23 16.88 0 10.35 8.91 10.26 12 2" />
              </svg>
              {/* Reply icon */}
              <svg style={{ width: 20, height: 20, cursor: 'pointer' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
          </div>

          {/* Preheader (optional) */}
          {preheader && (
            <div style={{
              padding: '8px 16px',
              fontSize: '0.875rem',
              color: '#80868b',
              borderBottom: '1px solid #e8eaed',
              fontStyle: 'italic',
            }}>
              {preheader}
            </div>
          )}

          {/* Body paragraphs */}
          <div style={{
            padding: '16px 16px',
            color: '#5f6368',
          }}>
            {bodyParagraphs.map((paragraph, idx) => (
              <p
                key={idx}
                style={{
                  margin: idx === 0 ? '0 0 12px 0' : '0 0 12px 0',
                  lineHeight: 1.6,
                }}
              >
                {paragraph}
              </p>
            ))}
          </div>

          {/* Creative image or placeholder */}
          {(content.imageUrl || brand.accentColor) && (
            <div style={{
              margin: '0 16px 16px',
              borderRadius: '8px',
              overflow: 'hidden',
              background: content.imageUrl
                ? undefined
                : `linear-gradient(135deg, ${accentColor}33 0%, ${accentColor}11 50%, #00000033 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 180,
              color: '#80868b',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}>
              {content.imageUrl ? (
                <img
                  src={content.imageUrl}
                  alt="Creative"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <div style={{ textAlign: 'center', opacity: 0.6 }}>
                  {brand.name}
                </div>
              )}
            </div>
          )}

          {/* CTA Button */}
          {content.cta && (
            <div style={{
              padding: '0 16px 16px',
            }}>
              <button
                style={{
                  background: accentColor,
                  color: '#fff',
                  border: 'none',
                  padding: '10px 24px',
                  borderRadius: '24px',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'opacity 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                {content.cta}
              </button>
            </div>
          )}

          {/* Footer */}
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid #e8eaed',
            fontSize: '0.75rem',
            color: '#80868b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              {brand.name}
              {brand.website && ` · ${brand.website}`}
            </div>
            <a href="#" style={{
              color: '#80868b',
              textDecoration: 'none',
              cursor: 'pointer',
            }}>
              Unsubscribe
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
