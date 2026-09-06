'use client'

import React, { useState } from 'react'

export interface LineItem {
  name: string
  type: 'one-time' | 'monthly' | 'metered'
  amount: number  // dollars
  description?: string
  packId?: string
}

export interface CheckoutSummaryProps {
  items: LineItem[]
  apiBase?: string
  onCheckoutComplete?: (sessionId: string) => void
  onBack?: () => void
}

function formatAmount(amount: number, type: string): string {
  if (amount === 0) return 'Free'
  const fmt = `$${amount.toFixed(2)}`
  if (type === 'monthly') return `${fmt}/mo`
  if (type === 'metered') return `${fmt}/1M calls`
  return fmt
}

export default function CheckoutSummary({
  items,
  apiBase = '',
  onCheckoutComplete,
  onBack,
}: CheckoutSummaryProps) {
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  const oneTimeTotal = items
    .filter(i => i.type === 'one-time')
    .reduce((sum, i) => sum + i.amount, 0)

  const monthlyTotal = items
    .filter(i => i.type === 'monthly')
    .reduce((sum, i) => sum + i.amount, 0)

  const freeItems = items.filter(i => i.amount === 0)
  const paidItems = items.filter(i => i.amount > 0)

  const handleCheckout = async () => {
    if (paidItems.length === 0) {
      // All free — skip checkout
      onCheckoutComplete?.('free')
      return
    }

    setProcessing(true)
    setError('')

    try {
      // Create checkout session for each paid pack
      for (const item of paidItems) {
        if (!item.packId) continue
        const res = await fetch(`${apiBase}/api/marketplace/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pack_id: item.packId,
            success_url: window.location.href + '?claim={CHECKOUT_SESSION_ID}',
            cancel_url: window.location.href,
          }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.detail || `Checkout failed: ${res.status}`)
        }

        const data = await res.json()
        if (data.checkout_url) {
          // Redirect to Stripe
          window.location.href = data.checkout_url
          return
        }
        // Demo mode — auto-fulfilled
        onCheckoutComplete?.(data.session_id)
      }

      // If no redirects happened (all demo)
      onCheckoutComplete?.('demo')
    } catch (e: any) {
      setError(e.message || 'Checkout failed')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div style={{
      background: 'var(--bg-surface, #16162a)', borderRadius: 'var(--radius, 10px)',
      border: '1px solid var(--glass-border, #2a2a4a)', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--glass-border, #2a2a4a)',
      }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Order Summary</h3>
      </div>

      {/* Line items */}
      <div style={{ padding: '12px 18px' }}>
        {items.map((item, i) => (
          <div key={i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 0', borderBottom: i < items.length - 1 ? '1px solid var(--glass-border, #1a1a2e)' : 'none',
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</div>
              {item.description && (
                <div style={{ fontSize: 11, color: 'var(--text-muted, #888)', marginTop: 2 }}>
                  {item.description}
                </div>
              )}
            </div>
            <span style={{
              fontSize: 13, fontWeight: 600,
              color: item.amount === 0 ? '#4ade80' : 'var(--text-primary, #e0e0e0)',
            }}>
              {formatAmount(item.amount, item.type)}
            </span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div style={{
        padding: '14px 18px',
        borderTop: '1px solid var(--glass-border, #2a2a4a)',
        background: 'var(--bg-deep, #0e0e1e)',
      }}>
        {oneTimeTotal > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted, #aaa)' }}>One-time total</span>
            <span style={{ fontSize: 14, fontWeight: 700 }}>${oneTimeTotal.toFixed(2)}</span>
          </div>
        )}
        {monthlyTotal > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted, #aaa)' }}>Monthly recurring</span>
            <span style={{ fontSize: 14, fontWeight: 700 }}>${monthlyTotal.toFixed(2)}/mo</span>
          </div>
        )}
        {oneTimeTotal === 0 && monthlyTotal === 0 && (
          <div style={{ textAlign: 'center', fontSize: 13, color: '#4ade80', fontWeight: 600 }}>
            All items are free
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '8px 18px', fontSize: 12, color: '#f87171', background: '#1a0a0a' }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{
        padding: '14px 18px', display: 'flex', gap: 10, justifyContent: 'flex-end',
        borderTop: '1px solid var(--glass-border, #2a2a4a)',
      }}>
        {onBack && (
          <button
            onClick={onBack}
            disabled={processing}
            style={{
              padding: '9px 18px', borderRadius: 'var(--radius, 8px)',
              background: 'transparent', border: '1px solid var(--glass-border, #2a2a4a)',
              color: 'var(--text-primary, #e0e0e0)', cursor: 'pointer', fontSize: 13,
            }}
          >
            Back
          </button>
        )}
        <button
          onClick={handleCheckout}
          disabled={processing}
          style={{
            padding: '9px 24px', borderRadius: 'var(--radius, 8px)', border: 'none',
            background: 'var(--accent, #6366f1)', color: '#fff',
            cursor: processing ? 'wait' : 'pointer', fontSize: 13, fontWeight: 600,
            opacity: processing ? 0.6 : 1,
          }}
        >
          {processing
            ? 'Processing...'
            : paidItems.length > 0
              ? `Checkout — $${(oneTimeTotal + monthlyTotal).toFixed(2)}`
              : 'Continue (Free)'}
        </button>
      </div>
    </div>
  )
}
