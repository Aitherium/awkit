/**
 * X (Twitter) post frame — renders an artifact in a faithful dark-mode X feed mockup.
 * Shows avatar, name, handle, timestamp, post text, optional creative, and engagement metrics.
 */

import type { ChannelFrameProps } from './types'
import { brandMonogram, brandAccent } from './types'

export default function XPostFrame({
  brand,
  content,
  width = 520,
  className,
}: ChannelFrameProps) {
  const accent = brandAccent(brand)
  const handle = brand.handle || 'account'
  const timestamp = content.meta?.timestamp || '2h'
  const comments = content.meta?.comments || '48'
  const shares = content.meta?.shares || '112'
  const likes = content.meta?.likes || '1.2K'

  return (
    <div
      style={{
        background: 'var(--bg-elevated, #1A2A40)',
        border: '1px solid var(--glass-border, rgba(26,42,64,0.8))',
        borderRadius: 'var(--radius-lg, 12px)',
        padding: '10px',
      }}
      className={className}
    >
      {/* Channel label */}
      <div
        style={{
          fontSize: '0.7rem',
          letterSpacing: '0.06em',
          color: 'var(--text-muted, #4A6A8A)',
          textTransform: 'uppercase',
          marginBottom: '8px',
          fontWeight: 500,
        }}
      >
        Social — X
      </div>

      {/* X post mockup */}
      <div
        style={{
          width: '100%',
          maxWidth: `${width}px`,
          background: '#000',
          border: '1px solid #2f3336',
          borderRadius: '16px',
          padding: '12px 16px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
          fontSize: '15px',
          color: '#e7e9ea',
          lineHeight: 1.5,
        }}
      >
        {/* Header: Avatar, name, handle, timestamp, more */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
          {/* Avatar */}
          <div
            style={{
              width: '40px',
              height: '40px',
              minWidth: '40px',
              borderRadius: '50%',
              background: accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: '18px',
            }}
          >
            {brandMonogram(brand)}
          </div>

          {/* Right side of header */}
          <div style={{ flex: 1 }}>
            {/* Name, verified badge, handle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginBottom: '2px',
              }}
            >
              <span style={{ fontWeight: 700, color: '#e7e9ea' }}>
                {brand.name}
              </span>
              {/* Verified badge SVG */}
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="#1d9bf0"
                style={{ flexShrink: 0 }}
              >
                <path d="M22.5 12c0-5.799-4.701-10.5-10.5-10.5S1.5 6.201 1.5 12s4.701 10.5 10.5 10.5S22.5 17.799 22.5 12zm-15.5-1.5l3 3 6.5-6.5" />
                <polyline
                  points="9,12 11.5,15 18,7.5"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span style={{ color: '#71767b', fontSize: '15px' }}>
                @{handle}
              </span>
            </div>

            {/* Timestamp and more menu */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: '13px', color: '#71767b' }}>
                {timestamp}
              </span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="5" cy="12" r="2" fill="#71767b" />
                <circle cx="12" cy="12" r="2" fill="#71767b" />
                <circle cx="19" cy="12" r="2" fill="#71767b" />
              </svg>
            </div>
          </div>
        </div>

        {/* Post text */}
        <div style={{ marginBottom: '12px', marginLeft: '52px' }}>
          {content.headline && (
            <div style={{ marginBottom: '8px', fontWeight: 700 }}>
              {content.headline}
            </div>
          )}
          {content.body.split('\n').map((para, idx) => (
            <p
              key={idx}
              style={{
                margin: '0 0 8px 0',
                fontSize: '0.9375rem',
              }}
            >
              {para}
            </p>
          ))}
        </div>

        {/* Creative or placeholder */}
        {(content.imageUrl || true) && (
          <div
            style={{
              marginBottom: '12px',
              marginLeft: '52px',
              borderRadius: '16px',
              border: '1px solid #2f3336',
              overflow: 'hidden',
              minHeight: content.imageUrl ? 'auto' : '200px',
              background: content.imageUrl
                ? undefined
                : `linear-gradient(135deg, ${accent}40, #00000033)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {content.imageUrl ? (
              <img
                src={content.imageUrl}
                alt="Post creative"
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            ) : (
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 300,
                  color: `${accent}55`,
                  textAlign: 'center',
                }}
              >
                {brand.name}
              </div>
            )}
          </div>
        )}

        {/* Action row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginLeft: '52px',
            marginTop: '12px',
            fontSize: '13px',
            color: '#71767b',
          }}
        >
          {/* Reply */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#71767b" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>{comments}</span>
          </div>

          {/* Repost */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#71767b" strokeWidth="2">
              <polyline points="17 2 21 6 17 10" />
              <path d="M21 6H9a4 4 0 0 0-4 4v4" />
              <polyline points="7 22 3 18 7 14" />
              <path d="M3 18h12a4 4 0 0 0 4-4v-4" />
            </svg>
            <span>{shares}</span>
          </div>

          {/* Like */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#71767b" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            <span>{likes}</span>
          </div>

          {/* View count */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#71767b" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>48K</span>
          </div>

          {/* Bookmark */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#71767b" strokeWidth="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>

          {/* Share */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#71767b" strokeWidth="2">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="M8.59 13.51l6.83 3.98M15.41 10.49L8.59 6.51" />
          </svg>
        </div>
      </div>
    </div>
  )
}
