/**
 * Instagram post frame — displays content as it would appear in an Instagram feed.
 * Shows avatar with gradient ring, username, action buttons, image, likes, and caption with metadata.
 */

import type { ChannelFrameProps } from './types'
import { brandMonogram, brandAccent } from './types'

export default function InstagramFrame({
  brand,
  content,
  width = 400,
  className = '',
}: ChannelFrameProps) {
  const username = brand.handle || brand.name?.toLowerCase() || 'user'
  const likes = content.meta?.likes || '2,847'
  const comments = content.meta?.comments || '96'
  const timestamp = content.meta?.timestamp || '2 HOURS AGO'
  const accentColor = brandAccent(brand)
  const monogram = brandMonogram(brand)

  return (
    <div
      style={{
        background: 'var(--bg-elevated, #1A2A40)',
        border: '1px solid var(--glass-border, rgba(26,42,64,0.8))',
        borderRadius: 'var(--radius-lg, 12px)',
        padding: 10,
        width: `${width}px`,
        maxWidth: '100%',
      }}
      className={className}
    >
      {/* Channel label */}
      <div style={{
        color: 'var(--text-muted, #4A6A8A)',
        fontSize: '0.7rem',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginBottom: 8,
      }}>
        Social — Instagram
      </div>

      {/* Instagram feed card */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #dbdbdb',
        borderRadius: 3,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
        overflow: 'hidden',
      }}>
        {/* Header: avatar, username, follow, menu */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid #efefef',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Avatar with gradient ring */}
            <div style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              padding: 2,
              background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {brand.logoUrl ? (
                <img
                  src={brand.logoUrl}
                  alt={brand.name}
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    objectFit: 'cover',
                  }}
                />
              ) : (
                <div style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: '50%',
                  background: accentColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  fontWeight: 'bold',
                  fontSize: '0.875rem',
                }}>
                  {monogram}
                </div>
              )}
            </div>
            <div>
              <div style={{
                fontWeight: 'bold',
                fontSize: '0.875rem',
                color: '#262626',
              }}>
                {username}
              </div>
            </div>
          </div>
          <div style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
          }}>
            <span style={{ color: '#0095f6', fontSize: '0.8125rem', fontWeight: 500 }}>
              Follow
            </span>
            {/* Menu dots */}
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#262626" strokeWidth={2} strokeLinecap="round">
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="19" r="1" />
            </svg>
          </div>
        </div>

        {/* Creative: square image or gradient placeholder */}
        <div style={{
          aspectRatio: '1 / 1',
          background: content.imageUrl
            ? 'transparent'
            : `linear-gradient(135deg, ${accentColor}, rgba(0, 0, 0, 0.2))`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}>
          {content.imageUrl ? (
            <img
              src={content.imageUrl}
              alt={content.headline || 'Post'}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : (
            <div style={{
              color: 'rgba(255, 255, 255, 0.4)',
              fontSize: '0.875rem',
              textAlign: 'center',
              fontWeight: 500,
              padding: '0 16px',
            }}>
              {brand.name}
            </div>
          )}
        </div>

        {/* Action row: heart, comment, send, bookmark */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid #efefef',
        }}>
          <div style={{ display: 'flex', gap: 12 }}>
            {/* Heart outline */}
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#262626" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            {/* Comment bubble */}
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#262626" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {/* Paper plane */}
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#262626" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 3 20 3 3 20.29 3.29 20 20 3" />
              <line x1="11" y1="13" x2="23" y2="3" />
            </svg>
          </div>
          {/* Bookmark outline */}
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#262626" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </div>

        {/* Likes count */}
        <div style={{
          padding: '4px 12px 8px',
          fontSize: '0.875rem',
          fontWeight: 'bold',
          color: '#262626',
        }}>
          {likes} likes
        </div>

        {/* Caption: username + headline + body */}
        <div style={{
          padding: '0 12px 8px',
          fontSize: '0.875rem',
          color: '#262626',
          lineHeight: 1.4,
          maxHeight: '5.6em',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 4,
          WebkitBoxOrient: 'vertical',
        }}>
          <span style={{ fontWeight: 'bold' }}>{username}</span>
          {content.headline && (
            <>
              {' '}
              <span style={{ fontWeight: 'bold' }}>{content.headline}</span>
            </>
          )}
          {content.body && (
            <>
              {' '}
              {content.body}
            </>
          )}
          {(content.headline || content.body) && (
            <>
              {' '}
              <span style={{ color: '#8e8e8e' }}>
                <span style={{ fontWeight: 500 }}>more</span>
              </span>
            </>
          )}
        </div>

        {/* Comments link and timestamp */}
        <div style={{
          padding: '4px 12px 8px',
          fontSize: '0.65rem',
          color: '#8e8e8e',
          textTransform: 'uppercase',
          letterSpacing: 0.3,
          lineHeight: 1.6,
        }}>
          <div>View all {comments} comments</div>
          <div>{timestamp}</div>
        </div>
      </div>
    </div>
  )
}
