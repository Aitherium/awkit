'use client'

import ProductCard from './ProductCard'
import type { ProductCardProduct } from './ProductCard'

interface ProductGridProps {
  products: ProductCardProduct[]
  columns?: 2 | 3 | 4
  renderLink?: (props: { href: string; children: React.ReactNode; className?: string }) => React.ReactNode
}

export default function ProductGrid({ products, columns = 4, renderLink }: ProductGridProps) {
  const gridClass = columns === 2
    ? 'grid-cols-1 sm:grid-cols-2'
    : columns === 3
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'

  return (
    <div>
      <div className={`grid gap-8 ${gridClass}`}>
        {products.map((product, i) => (
          <ProductCard key={product.id} product={product} index={i} renderLink={renderLink} />
        ))}
      </div>
      {products.length === 0 && (
        <div className="py-16 text-center text-[var(--sf-text-muted)]">
          <p className="text-lg">No products found</p>
        </div>
      )}
    </div>
  )
}
