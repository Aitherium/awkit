'use client'

import { useState, useCallback } from 'react'
import { useCart } from './CartProvider'

interface UseStripeCheckoutOptions {
  apiBase?: string
}

export function useStripeCheckout({ apiBase = '/api' }: UseStripeCheckoutOptions = {}) {
  const { items, clearCart } = useCart()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkout = useCallback(async () => {
    if (items.length === 0) return
    setLoading(true)
    setError(null)

    try {
      const resp = await fetch(`${apiBase}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line_items: items.map(item => ({
            price: item.priceId,
            quantity: item.quantity,
          })),
        }),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error(data.error || `Checkout failed (${resp.status})`)
      }

      const { url } = await resp.json()
      if (url) {
        clearCart()
        window.location.href = url
      } else {
        throw new Error('No checkout URL returned')
      }
    } catch (e: any) {
      setError(e.message || 'Checkout failed')
    } finally {
      setLoading(false)
    }
  }, [items, apiBase, clearCart])

  return { checkout, loading, error }
}
