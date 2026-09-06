/**
 * AppStoreFrame — iOS App Store product listing mockup.
 * Renders the artifact as it appears in the official App Store listing page.
 */

import type { ChannelFrameProps } from './types'
import { brandMonogram, brandAccent } from './types'

export default function AppStoreFrame({
  brand,
  content,
  width = 390,
  className = '',
}: ChannelFrameProps) {
  const rating = content.meta?.rating || '4.8'
  const ratingCount = content.meta?.ratingCount || '12.4K'
  const category = content.meta?.category || 'Lifestyle'
  const price = content.meta?.price
  const subtitle = content.meta?.subtitle || brand.tagline
  const accentColor = brandAccent(brand)

  return (
    <div
      style={{
        background: 'var(--bg-elevated, #1A2A40)',
        border: '1px solid var(--glass-border, rgba(26,42,64,0.8))',
        borderRadius: 'var(--radius-lg, 12px)',
        padding: '10px',
        width,
        boxSizing: 'border-box',
      }}
      className={className}
    >
      {/* Channel label */}
      <div
        style={{
          fontSize: '0.7rem',
          color: 'var(--text-muted, #4A6A8A)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: '8px',
          fontWeight: 500,
        }}
      >
        App Store — iOS
      </div>

      {/* Mockup container */}
      <div
        style={{
          background: '#fff',
          color: '#1c1c1e',
          fontFamily:
            "'-apple-system', 'SF Pro Text', 'Helvetica Neue', sans-serif",
          borderRadius: '12px',
          overflow: 'hidden',
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        {/* Header: Icon + Title/Subtitle/Button */}
        <div style={{ padding: '16px', display: 'flex', gap: '12px' }}>
          {/* App Icon */}
          <div
            style={{
              width: '96px',
              height: '96px',
              flexShrink: 0,
              borderRadius: '22px',
              overflow: 'hidden',
              background: brand.logoUrl
                ? 'none'
                : `linear-gradient(135deg, ${accentColor}, rgba(0,0,0,0.2))`,
              backgroundImage: brand.logoUrl
                ? `url(${brand.logoUrl})`
                : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: '2rem',
              fontWeight: '700',
            }}
          >
            {!brand.logoUrl && brandMonogram(brand)}
          </div>

          {/* Title, Subtitle, Button Column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {/* App Name */}
            <div
              style={{
                fontSize: '1.25rem',
                fontWeight: '600',
                marginBottom: '4px',
                color: '#1c1c1e',
              }}
            >
              {content.headline || brand.name}
            </div>

            {/* Subtitle/Tagline */}
            {subtitle && (
              <div
                style={{
                  fontSize: '0.8125rem',
                  color: '#8e8e93',
                  marginBottom: '12px',
                }}
              >
                {subtitle}
              </div>
            )}

            {/* GET Button or Price */}
            <button
              style={{
                alignSelf: 'flex-start',
                background: '#007aff',
                color: '#fff',
                border: 'none',
                borderRadius: '22px',
                padding: '6px 24px',
                fontSize: '0.9375rem',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              {price || 'GET'}
            </button>

            {/* In-App Purchases label */}
            <div
              style={{
                fontSize: '0.5625rem',
                color: '#8e8e93',
                marginTop: '6px',
              }}
            >
              In-App Purchases
            </div>
          </div>
        </div>

        {/* Stats Strip */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            borderTop: '1px solid #e5e5ea',
            borderBottom: '1px solid #e5e5ea',
          }}
        >
          {/* Ratings */}
          <div
            style={{
              padding: '12px 8px',
              textAlign: 'center',
              borderRight: '1px solid #e5e5ea',
            }}
          >
            <div
              style={{
                fontSize: '0.6875rem',
                color: '#8e8e93',
                marginBottom: '4px',
              }}
            >
              RATINGS
            </div>
            <div style={{ fontSize: '1.125rem', fontWeight: '600' }}>
              {ratingCount}
            </div>
            <div
              style={{
                fontSize: '1.125rem',
                fontWeight: '600',
                marginTop: '2px',
              }}
            >
              {rating} ★
            </div>
          </div>

          {/* Age */}
          <div
            style={{
              padding: '12px 8px',
              textAlign: 'center',
              borderRight: '1px solid #e5e5ea',
            }}
          >
            <div
              style={{
                fontSize: '0.6875rem',
                color: '#8e8e93',
                marginBottom: '4px',
              }}
            >
              AGE
            </div>
            <div style={{ fontSize: '1.125rem', fontWeight: '600' }}>
              4+
            </div>
          </div>

          {/* Category */}
          <div
            style={{
              padding: '12px 8px',
              textAlign: 'center',
              borderRight: '1px solid #e5e5ea',
            }}
          >
            <div
              style={{
                fontSize: '0.6875rem',
                color: '#8e8e93',
                marginBottom: '4px',
              }}
            >
              CATEGORY
            </div>
            <div
              style={{
                fontSize: '1.125rem',
                fontWeight: '600',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {category}
            </div>
          </div>

          {/* Developer */}
          <div style={{ padding: '12px 8px', textAlign: 'center' }}>
            <div
              style={{
                fontSize: '0.6875rem',
                color: '#8e8e93',
                marginBottom: '4px',
              }}
            >
              DEVELOPER
            </div>
            <div
              style={{
                fontSize: '1.5rem',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '24px',
              }}
            >
              {/* Person silhouette SVG */}
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ color: '#8e8e93' }}
              >
                <circle
                  cx="10"
                  cy="6"
                  r="3"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <path
                  d="M 10 10 C 13.314 10 15.5 11.791 15.5 14 L 15.5 16.5 C 15.5 17.327 14.827 18 14 18 L 6 18 C 5.173 18 4.5 17.327 4.5 16.5 L 4.5 14 C 4.5 11.791 6.686 10 10 10 Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                />
              </svg>
            </div>
          </div>
        </div>

        {/* Screenshots Row */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            padding: '12px',
            overflow: 'hidden',
          }}
        >
          {/* First screenshot - uses imageUrl if available */}
          <div
            style={{
              flex: '1',
              aspectRatio: '9 / 19.5',
              borderRadius: '12px',
              overflow: 'hidden',
              background: content.imageUrl
                ? 'none'
                : `linear-gradient(135deg, ${accentColor}, rgba(0,0,0,0.2))`,
              backgroundImage: content.imageUrl
                ? `url(${content.imageUrl})`
                : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.2)',
              fontSize: '0.75rem',
            }}
          >
            {!content.imageUrl && <span>Screenshot</span>}
          </div>

          {/* Second screenshot - always accent gradient placeholder */}
          <div
            style={{
              flex: '1',
              aspectRatio: '9 / 19.5',
              borderRadius: '12px',
              overflow: 'hidden',
              background: `linear-gradient(135deg, ${accentColor}, rgba(0,0,0,0.2))`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.15)',
              fontSize: '0.65rem',
              fontWeight: '500',
            }}
          >
            <span style={{ textAlign: 'center', maxWidth: '80%' }}>
              {brand.name}
            </span>
          </div>
        </div>

        {/* Description */}
        <div
          style={{
            padding: '0 16px 16px',
            fontSize: '0.9375rem',
            color: '#1c1c1e',
            lineHeight: '1.5',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {content.body}
          {' '}
          <span style={{ color: '#007aff', fontWeight: '500' }}>more</span>
        </div>
      </div>
    </div>
  )
}
