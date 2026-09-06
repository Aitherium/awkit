'use client'

import React from 'react'

export interface LandingHeroProps {
  headline: string
  subheadline?: string
  ctaText?: string
  ctaHref?: string
  secondaryCtaText?: string
  secondaryCtaHref?: string
  backgroundImage?: string
  className?: string
}

/**
 * Full-width hero section for storefront landing pages.
 * Styled via --sf-* CSS custom properties from StorefrontThemeProvider.
 */
export default function LandingHero({
  headline,
  subheadline,
  ctaText = 'Shop Now',
  ctaHref = '/shop',
  secondaryCtaText,
  secondaryCtaHref,
  backgroundImage,
  className = '',
}: LandingHeroProps) {
  return (
    <section
      className={`relative flex min-h-[70vh] items-center justify-center overflow-hidden ${className}`}
      style={{
        background: backgroundImage
          ? `url(${backgroundImage}) center/cover no-repeat`
          : 'var(--sf-background)',
      }}
    >
      {backgroundImage && (
        <div className="absolute inset-0 bg-black/40" />
      )}
      <div className="relative z-10 mx-auto max-w-3xl px-6 text-center">
        <h1
          className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl"
          style={{
            color: backgroundImage ? '#fff' : 'var(--sf-text)',
            fontFamily: 'var(--sf-font-display, inherit)',
          }}
        >
          {headline}
        </h1>
        {subheadline && (
          <p
            className="mt-4 text-lg sm:text-xl"
            style={{
              color: backgroundImage ? 'rgba(255,255,255,0.85)' : 'var(--sf-text-secondary)',
              fontFamily: 'var(--sf-font-body, inherit)',
            }}
          >
            {subheadline}
          </p>
        )}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <a
            href={ctaHref}
            className="inline-flex items-center rounded-lg px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{
              backgroundColor: 'var(--sf-primary)',
              color: '#fff',
            }}
          >
            {ctaText}
          </a>
          {secondaryCtaText && secondaryCtaHref && (
            <a
              href={secondaryCtaHref}
              className="inline-flex items-center rounded-lg border px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-80"
              style={{
                borderColor: 'var(--sf-border)',
                color: backgroundImage ? '#fff' : 'var(--sf-text)',
              }}
            >
              {secondaryCtaText}
            </a>
          )}
        </div>
      </div>
    </section>
  )
}
