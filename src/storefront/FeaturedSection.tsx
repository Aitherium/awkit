'use client'

import React from 'react'

export interface FeaturedItem {
  title: string
  description: string
  image?: string
  href?: string
  badge?: string
}

export interface FeaturedSectionProps {
  heading?: string
  subheading?: string
  items: FeaturedItem[]
  columns?: 2 | 3 | 4
  className?: string
}

/**
 * Product/feature showcase grid for storefront landing pages.
 * Themed via --sf-* CSS custom properties.
 */
export default function FeaturedSection({
  heading = 'Featured',
  subheading,
  items,
  columns = 3,
  className = '',
}: FeaturedSectionProps) {
  const gridCols =
    columns === 2 ? 'sm:grid-cols-2' :
    columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' :
    'sm:grid-cols-2 lg:grid-cols-3'

  return (
    <section
      className={`py-16 px-6 ${className}`}
      style={{ backgroundColor: 'var(--sf-background)' }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 text-center">
          <h2
            className="text-3xl font-bold"
            style={{
              color: 'var(--sf-text)',
              fontFamily: 'var(--sf-font-display, inherit)',
            }}
          >
            {heading}
          </h2>
          {subheading && (
            <p
              className="mt-2 text-base"
              style={{ color: 'var(--sf-text-secondary)' }}
            >
              {subheading}
            </p>
          )}
        </div>
        <div className={`grid grid-cols-1 gap-6 ${gridCols}`}>
          {items.map((item, i) => (
            <FeaturedCard key={i} item={item} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FeaturedCard({ item }: { item: FeaturedItem }) {
  const Wrapper = item.href ? 'a' : 'div'
  const wrapperProps = item.href ? { href: item.href } : {}

  return (
    <Wrapper
      {...wrapperProps}
      className="group relative overflow-hidden rounded-xl border transition-shadow hover:shadow-lg"
      style={{
        backgroundColor: 'var(--sf-surface)',
        borderColor: 'var(--sf-border)',
      }}
    >
      {item.image && (
        <div className="aspect-[4/3] overflow-hidden">
          <img
            src={item.image}
            alt={item.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        </div>
      )}
      <div className="p-5">
        {item.badge && (
          <span
            className="mb-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: 'var(--sf-primary)',
              color: '#fff',
            }}
          >
            {item.badge}
          </span>
        )}
        <h3
          className="text-lg font-semibold"
          style={{ color: 'var(--sf-text)' }}
        >
          {item.title}
        </h3>
        <p
          className="mt-1 text-sm"
          style={{ color: 'var(--sf-text-secondary)' }}
        >
          {item.description}
        </p>
      </div>
    </Wrapper>
  )
}
