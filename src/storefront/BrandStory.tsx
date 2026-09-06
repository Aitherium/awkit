'use client'

import React from 'react'

export interface BrandStoryProps {
  heading: string
  body: string
  image?: string
  imagePosition?: 'left' | 'right'
  ctaText?: string
  ctaHref?: string
  className?: string
}

/**
 * Narrative brand story section for storefront landing pages.
 * Themed via --sf-* CSS custom properties.
 */
export default function BrandStory({
  heading,
  body,
  image,
  imagePosition = 'right',
  ctaText,
  ctaHref,
  className = '',
}: BrandStoryProps) {
  return (
    <section
      className={`py-16 px-6 ${className}`}
      style={{ backgroundColor: 'var(--sf-surface)' }}
    >
      <div
        className={`mx-auto flex max-w-6xl flex-col items-center gap-10 ${
          image ? (imagePosition === 'left' ? 'md:flex-row-reverse' : 'md:flex-row') : ''
        }`}
      >
        <div className={image ? 'flex-1' : 'max-w-2xl text-center'}>
          <h2
            className="text-3xl font-bold"
            style={{
              color: 'var(--sf-text)',
              fontFamily: 'var(--sf-font-display, inherit)',
            }}
          >
            {heading}
          </h2>
          <div
            className="mt-4 text-base leading-relaxed whitespace-pre-line"
            style={{
              color: 'var(--sf-text-secondary)',
              fontFamily: 'var(--sf-font-body, inherit)',
            }}
          >
            {body}
          </div>
          {ctaText && ctaHref && (
            <a
              href={ctaHref}
              className="mt-6 inline-flex items-center rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{
                backgroundColor: 'var(--sf-primary)',
                color: '#fff',
              }}
            >
              {ctaText}
            </a>
          )}
        </div>
        {image && (
          <div className="flex-1">
            <img
              src={image}
              alt={heading}
              className="w-full rounded-xl object-cover shadow-lg"
            />
          </div>
        )}
      </div>
    </section>
  )
}
