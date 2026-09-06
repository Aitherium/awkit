/**
 * LinkedIn feed post frame — a faithful mockup of a social-first branded post.
 * Shows header with avatar and engagement metadata, hero creative, body copy,
 * social proof (reactions, comments, shares), and action buttons (Like, Comment, Repost, Send).
 * Renders a monogram avatar and accent-gradient placeholder when images are absent.
 */

import type { ChannelFrameProps } from './types'
import { brandMonogram, brandAccent } from './types'

export default function LinkedInFrame({
  brand,
  content,
  width = 552,
  className = '',
}: ChannelFrameProps) {
  const accent = brandAccent(brand)
  const timestamp = content.meta?.timestamp || '3d'
  const likes = content.meta?.likes || '284'
  const comments = content.meta?.comments || '32'
  const shares = content.meta?.shares || '18'

  const outerWrapperStyle: React.CSSProperties = {
    background: 'var(--bg-elevated, #1A2A40)',
    border: '1px solid var(--glass-border, rgba(26,42,64,0.8))',
    borderRadius: 'var(--radius-lg, 12px)',
    padding: 10,
    width: `${width}px`,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  }

  const labelStyle: React.CSSProperties = {
    color: 'var(--text-muted, #4A6A8A)',
    fontSize: '0.7rem',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginBottom: 8,
    fontWeight: 500,
  }

  const cardStyle: React.CSSProperties = {
    background: '#ffffff',
    border: '1px solid rgba(140, 140, 140, 0.2)',
    borderRadius: 8,
    overflow: 'hidden',
    color: '#000000e6',
  }

  const headerStyle: React.CSSProperties = {
    padding: '12px 16px',
    display: 'flex',
    gap: 12,
    position: 'relative',
  }

  const avatarStyle: React.CSSProperties = {
    width: 48,
    height: 48,
    minWidth: 48,
    minHeight: 48,
    borderRadius: '50%',
    background: accent,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
    fontSize: '1.25rem',
    fontWeight: 700,
  }

  const logoStyle: React.CSSProperties = {
    width: 48,
    height: 48,
    minWidth: 48,
    minHeight: 48,
    borderRadius: '50%',
    background: `url(${brand.logoUrl}) center / cover no-repeat`,
  }

  const headerContentStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 2,
  }

  const nameLineStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    fontWeight: 700,
    color: '#000000e6',
  }

  const followingStyle: React.CSSProperties = {
    color: '#0a66c2',
    fontWeight: 600,
    marginLeft: 4,
  }

  const taglineStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    color: '#00000099',
  }

  const metaStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    color: '#00000099',
  }

  const moreMenuStyle: React.CSSProperties = {
    fontSize: '1.5rem',
    color: '#00000099',
    cursor: 'pointer',
    lineHeight: 1,
    userSelect: 'none',
  }

  const bodyContainerStyle: React.CSSProperties = {
    padding: '0 16px 12px 16px',
  }

  const headlineStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    fontWeight: 700,
    color: '#000000e6',
    margin: '0 0 8px 0',
  }

  const bodyStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    color: '#000000e6',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
  }

  const seeMoreStyle: React.CSSProperties = {
    color: '#00000099',
    marginLeft: 4,
  }

  const creativeStyle: React.CSSProperties = {
    width: '100%',
    height: 320,
    background: brand.logoUrl ? undefined : `linear-gradient(135deg, ${accent}, rgba(0,0,0,0.2))`,
    backgroundImage: content.imageUrl
      ? `url(${content.imageUrl})`
      : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  }

  const placeholderTextStyle: React.CSSProperties = {
    fontSize: '1.5rem',
    fontWeight: 600,
    color: 'rgba(255, 255, 255, 0.3)',
    textAlign: 'center',
  }

  const socialProofStyle: React.CSSProperties = {
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTop: '1px solid rgba(140, 140, 140, 0.15)',
    borderBottom: '1px solid rgba(140, 140, 140, 0.15)',
    fontSize: '0.75rem',
    color: '#00000099',
  }

  const reactionsStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  }

  const reactionCircleBaseStyle: React.CSSProperties = {
    width: 16,
    height: 16,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.65rem',
    color: '#ffffff',
    fontWeight: 700,
    marginLeft: -8,
    border: '2px solid #ffffff',
  }

  const engagementTextStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    color: '#00000099',
  }

  const actionRowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 0,
    padding: '8px 0',
  }

  const actionButtonStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '8px 0',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#00000099',
    fontSize: '0.8125rem',
    fontWeight: 600,
    transition: 'background 0.15s',
  }

  const iconStyle: React.CSSProperties = {
    width: 16,
    height: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  const likeSvg = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )

  const commentSvg = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )

  const repostSvg = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="17 2 21 6 17 10" />
      <path d="M21 6H7a4 4 0 0 0-4 4v8" />
      <polyline points="7 22 3 18 7 14" />
      <path d="M3 18h14a4 4 0 0 0 4-4v-8" />
    </svg>
  )

  const sendSvg = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )

  const bodyParagraphs = content.body.split('\n').filter(line => line.trim())

  return (
    <div style={outerWrapperStyle} className={className}>
      <div style={labelStyle}>Social — LinkedIn</div>
      <div style={cardStyle}>
        {/* Header */}
        <div style={headerStyle}>
          {brand.logoUrl ? (
            <div style={logoStyle} />
          ) : (
            <div style={avatarStyle}>{brandMonogram(brand)}</div>
          )}
          <div style={headerContentStyle}>
            <div style={nameLineStyle}>
              {brand.name}
              <span style={followingStyle}>· Following</span>
            </div>
            <div style={taglineStyle}>
              {brand.tagline || brand.website}
            </div>
            <div style={metaStyle}>
              {timestamp} · 🌐
            </div>
          </div>
          <div style={moreMenuStyle}>···</div>
        </div>

        {/* Creative */}
        {content.imageUrl || true && (
          <div style={creativeStyle}>
            {!content.imageUrl && (
              <div style={placeholderTextStyle}>{brand.name}</div>
            )}
          </div>
        )}

        {/* Body */}
        <div style={bodyContainerStyle}>
          {content.headline && (
            <div style={headlineStyle}>{content.headline}</div>
          )}
          <div style={bodyStyle}>
            {bodyParagraphs.map((para, idx) => (
              <div key={idx} style={{ marginBottom: idx < bodyParagraphs.length - 1 ? 8 : 0 }}>
                {para}
              </div>
            ))}
            <span style={seeMoreStyle}>...see more</span>
          </div>
        </div>

        {/* Social Proof */}
        <div style={socialProofStyle}>
          <div style={reactionsStyle}>
            <div
              style={{
                ...reactionCircleBaseStyle,
                background: '#378fe9',
              }}
            >
              👍
            </div>
            <div
              style={{
                ...reactionCircleBaseStyle,
                background: '#df704d',
              }}
            >
              ❤
            </div>
            <div
              style={{
                ...reactionCircleBaseStyle,
                background: '#31a24c',
              }}
            >
              💡
            </div>
            <span style={engagementTextStyle}>{likes}</span>
          </div>
          <div style={engagementTextStyle}>
            {comments} comments · {shares} reposts
          </div>
        </div>

        {/* Action Row */}
        <div style={actionRowStyle}>
          <button style={actionButtonStyle}>
            <div style={iconStyle}>{likeSvg}</div>
            Like
          </button>
          <button style={actionButtonStyle}>
            <div style={iconStyle}>{commentSvg}</div>
            Comment
          </button>
          <button style={actionButtonStyle}>
            <div style={iconStyle}>{repostSvg}</div>
            Repost
          </button>
          <button style={actionButtonStyle}>
            <div style={iconStyle}>{sendSvg}</div>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
