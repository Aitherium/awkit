/**
 * A plan refusal must read as a plan refusal.
 *
 * Genesis answers `403 {detail: {error: 'feature_not_in_plan', required_tiers}}` when
 * a workspace's plan lacks managed agents. Rendered as a generic failure, that looks
 * like a broken panel rather than an unbought feature, and the admin has nothing to
 * act on. The panel must say it is the PLAN, and the deploy must not read as done.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }))

import ManagedAgentsPanel, { explainManagedError } from '../ManagedAgentsPanel'

const PLAN_REFUSAL = {
  detail: {
    error: 'feature_not_in_plan',
    feature: 'managed_agent_deploy',
    tier: 'free',
    required_tiers: ['starter'],
  },
}

function mockFetch(deployStatus: number, deployBody: unknown) {
  const calls: string[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    calls.push(`${method} ${url}`)
    if (String(url).endsWith('/api/managed-agents/status')) {
      return { ok: true, status: 200, json: async () => ({ deployed: false }) }
    }
    if (String(url).endsWith('/api/managed-agents/byok')) {
      return { ok: true, status: 200, json: async () => ({ has_key: true }) }
    }
    if (method === 'POST' && String(url).endsWith('/api/managed-agents/deploy')) {
      return { ok: deployStatus < 300, status: deployStatus, json: async () => deployBody }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  return calls
}

describe('ManagedAgentsPanel', () => {
  it('says the plan does not include managed agents when Genesis refuses on plan', async () => {
    const calls = mockFetch(403, PLAN_REFUSAL)
    render(<ManagedAgentsPanel />)
    fireEvent.click(await screen.findByText('Deploy agent'))
    const alert = await screen.findByTestId('managed-agents-error')
    expect(alert.textContent).toMatch(/not included in this workspace's plan/)
    expect(alert.textContent).toMatch(/starter/)
    expect(screen.queryByText(/Deployed\. Your agent is live/)).toBeNull()
    expect(calls).toContain('POST /api/managed-agents/deploy')
  })

  it('says it deployed when Genesis accepts', async () => {
    mockFetch(200, { ok: true, deployed: true })
    render(<ManagedAgentsPanel />)
    fireEvent.click(await screen.findByText('Deploy agent'))
    await waitFor(() => expect(screen.getByText(/Deployed\. Your agent is live/)).toBeTruthy())
    expect(screen.queryByTestId('managed-agents-error')).toBeNull()
  })

  it('explains a missing key and a non-admin refusal in words', () => {
    expect(explainManagedError(409, { detail: { error: 'tenant_anthropic_key_required' } }))
      .toMatch(/No Anthropic key/)
    expect(explainManagedError(403, { error: 'forbidden', detail: 'x' }))
      .toMatch(/owner or admin/)
  })

  it('reads error_type when Genesis sends a boolean error flag', () => {
    // Genesis chat refusal shape: `error` is `true`, the reason is `error_type`.
    expect(explainManagedError(409, { error: true, error_type: 'deployment_needed' }))
      .toMatch(/not deployed yet/)
    expect(explainManagedError(409, { detail: { error: true, error_type: 'deployment_needed' } }))
      .toMatch(/not deployed yet/)
  })
})
