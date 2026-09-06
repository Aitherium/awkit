/**
 * IMessageFrame — an SMS/iMessage thread mockup showing an incoming message
 * from the brand, with optional reply bubbles from the user.
 *
 * Renders a faithful iOS Messages UI with grey incoming bubbles from the brand,
 * blue outgoing reply bubbles, header with avatar and contact info, and a
 * message input bar at the bottom.
 */

import type { ChannelFrameProps } from './types'
import { brandMonogram, brandAccent } from './types'

export default function IMessageFrame({
  brand,
  content,
  width = 390,
  className,
}: ChannelFrameProps) {
  const accent = brandAccent(brand)
  const timestamp = content.meta?.timestamp || 'Today 9:41 AM'
  const contactName = content.meta?.contactName || brand.name
  const replies = content.meta?.replies?.split('\n').filter(Boolean) || []
  const bodyLines = content.body.split('\n').filter(Boolean)

  // Outer wrapper using portal-kit theme variables
  const outerStyle: React.CSSProperties = {
    background: 'var(--bg-elevated, #1A2A40)',
    border: '1px solid var(--glass-border, rgba(26,42,64,0.8))',
    borderRadius: 'var(--radius-lg, 12px)',
    padding: 10,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  }

  const labelStyle: React.CSSProperties = {
    color: 'var(--text-muted, #4A6A8A)',
    fontSize: '0.7rem',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginBottom: 8,
  }

  // Light iOS chrome (#fff background)
  const mockupStyle: React.CSSProperties = {
    width: width,
    maxWidth: '100%',
    background: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  }

  const headerStyle: React.CSSProperties = {
    background: '#f6f6f6fa',
    padding: '10px 16px',
    display: 'flex',
    alignItems: 'center',
    borderBottom: '1px solid #e5e5ea',
    gap: 8,
  }

  const headerCenterStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  }

  const avatarStyle: React.CSSProperties = {
    width: 50,
    height: 50,
    borderRadius: '50%',
    background: accent,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '20px',
    fontWeight: 600,
    flexShrink: 0,
  }

  const contactNameStyle: React.CSSProperties = {
    fontSize: '0.6875rem',
    color: '#1c1c1e',
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  }

  const timestampStyle: React.CSSProperties = {
    textAlign: 'center',
    fontSize: '0.6875rem',
    color: '#8e8e93',
    padding: '8px 16px',
    borderBottom: '1px solid #e5e5ea',
  }

  const messagesAreaStyle: React.CSSProperties = {
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minHeight: 200,
  }

  const incomingBubbleStyle: React.CSSProperties = {
    background: '#e9e9eb',
    color: '#000',
    padding: '8px 12px',
    borderRadius: '18px',
    maxWidth: '78%',
    wordWrap: 'break-word',
    alignSelf: 'flex-start',
    fontSize: '15px',
    lineHeight: '1.4',
  }

  const imageBubbleStyle: React.CSSProperties = {
    maxWidth: '78%',
    borderRadius: 14,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  }

  const outgoingBubbleStyle: React.CSSProperties = {
    background: '#007aff',
    color: '#fff',
    padding: '8px 12px',
    borderRadius: '18px',
    maxWidth: '78%',
    wordWrap: 'break-word',
    alignSelf: 'flex-end',
    fontSize: '15px',
    lineHeight: '1.4',
  }

  const ctaLinkStyle: React.CSSProperties = {
    color: '#007aff',
    marginLeft: 4,
  }

  const inputBarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    gap: 8,
    borderTop: '1px solid #e5e5ea',
    background: '#fff',
  }

  const inputFieldStyle: React.CSSProperties = {
    flex: 1,
    border: '1px solid #c7c7cc',
    borderRadius: 20,
    padding: '8px 12px',
    fontSize: '15px',
    color: '#000',
    background: '#fff',
    fontFamily: 'inherit',
  }

  const sendButtonStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: '#e5e5ea',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    color: '#999',
  }

  return (
    <div style={outerStyle} className={className}>
      <div style={labelStyle}>Messages — iMessage</div>
      <div style={mockupStyle}>
        {/* Header with back button, avatar, and contact info */}
        <div style={headerStyle}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#007aff" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          <div style={headerCenterStyle}>
            <div style={avatarStyle}>
              {brand.logoUrl ? (
                <img
                  src={brand.logoUrl}
                  alt={brand.name}
                  style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                />
              ) : (
                brandMonogram(brand)
              )}
            </div>
            <div style={contactNameStyle}>
              {contactName}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
          </div>
        </div>

        {/* Timestamp line */}
        <div style={timestampStyle}>
          Text Message · {timestamp}
        </div>

        {/* Messages area — incoming from brand, replies from user */}
        <div style={messagesAreaStyle}>
          {/* Headline as first bubble if present */}
          {content.headline && (
            <div style={incomingBubbleStyle}>{content.headline}</div>
          )}

          {/* Body paragraphs, each as its own bubble */}
          {bodyLines.map((line, idx) => {
            const isLast = idx === bodyLines.length - 1
            const hasCTA = content.cta && isLast
            return (
              <div key={idx}>
                <div style={incomingBubbleStyle}>
                  {line}
                  {hasCTA && (
                    <>
                      <br />
                      <span style={ctaLinkStyle}>
                        {content.cta} → {brand.website || 'link'}
                      </span>
                    </>
                  )}
                </div>
                {/* Image bubble after first text bubble */}
                {idx === 0 && content.imageUrl && (
                  <div style={imageBubbleStyle}>
                    <img
                      src={content.imageUrl}
                      alt="Message attachment"
                      style={{ width: '100%', display: 'block' }}
                    />
                  </div>
                )}
              </div>
            )
          })}

          {/* Image if no body paragraphs but imageUrl present */}
          {bodyLines.length === 0 && content.imageUrl && (
            <div style={imageBubbleStyle}>
              <img
                src={content.imageUrl}
                alt="Message attachment"
                style={{ width: '100%', display: 'block' }}
              />
            </div>
          )}

          {/* Outgoing reply bubbles from user */}
          {replies.map((reply, idx) => (
            <div key={`reply-${idx}`} style={outgoingBubbleStyle}>
              {reply}
            </div>
          ))}
        </div>

        {/* Input bar mockup at bottom */}
        <div style={inputBarStyle}>
          <input
            type="text"
            placeholder="Text Message · SMS"
            style={inputFieldStyle}
            readOnly
            disabled
          />
          <div style={sendButtonStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="12 19 12 5"></polyline>
              <polyline points="5 12 12 5 19 12"></polyline>
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}
