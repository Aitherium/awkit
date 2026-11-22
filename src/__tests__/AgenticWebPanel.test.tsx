// @vitest-environment jsdom
/**
 * AgenticWebPanel -- the "make my site agent-ready" flow, rendered for real (react-dom
 * in jsdom) over a stubbed fetch that answers /api/agentic-web/<action>.
 *
 * Pinned both ways: the scan grid and the preview diff render; Apply stays DISABLED for
 * an open or rejected card and enables only for answered/approve; DNSSEC and payment
 * items are shown as "needs owner decision" and never as an apply option.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import AgenticWebPanel, { cardApproved, scanRows } from '../panels/AgenticWebPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function waitFor<T>(fn: () => T, ms = 3000): Promise<T> {
  const t0 = Date.now()
  for (;;) {
    try {
      return fn()
    } catch (e) {
      if (Date.now() - t0 > ms) throw e
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10))
      })
    }
  }
}

const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
function get(id: string): HTMLElement {
  const el = q(id)
  if (!el) throw new Error(`no [data-testid=${id}]`)
  return el
}
async function click(id: string) {
  await act(async () => {
    get(id).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const PLAN = {
  plan_id: 'p1',
  changes: [
    { target: 'cf_worker', path_or_record: '/.well-known/agent-card.json', before: null, after: '{"name":"Acme"}',
      diff: '+{"name":"Acme"}' },
    { target: 'cf_dns', path_or_record: '_a2a._agents.acme.test SVCB', diff: '+1 agent.acme.test. alpn="a2a"' },
    { target: 'cf_worker', path_or_record: '/.well-known/x402', diff: '+wallet', gate: 'live_payment' },
  ],
  gates: [
    { kind: 'customer_domain_publish', summary: 'publish to acme.test' },
    { kind: 'dnssec_enable', summary: 'turn on DNSSEC for acme.test' },
  ],
}

function stub(cardStatus: { status: string; answer?: string }) {
  const calls: string[] = []
  const fetchImpl = (async (url: string) => {
    const action = String(url).split('/').pop() as string
    calls.push(action)
    const body: Record<string, unknown> = {
      scan: { remote: { 'discovery.a2aAgentCard': 'fail', 'discovery.mcpServerCard': 'pass' },
        local: { 'discovery.a2aAgentCard': 'fail', 'commerce.acp': 'neutral' } },
      plan: PLAN,
      approve: { card: { id: 'dec-7', status: 'open' } },
      decision: { card: { id: 'dec-7', ...cardStatus } },
      apply: { applied: 2 },
      verify: { 'discovery.a2aAgentCard': 'pass' },
      report: { markdown: '# acme.test agent-readiness' },
    }[action] as Record<string, unknown>
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

async function toPlan(fetchImpl: typeof fetch) {
  await act(async () => {
    root.render(<AgenticWebPanel fetchImpl={fetchImpl} pollMs={0} initialDomain="acme.test" />)
  })
  await click('aw-scan')
  await waitFor(() => get('aw-scan-grid'))
  await click('aw-plan')
  await waitFor(() => get('aw-plan-preview'))
}

describe('AgenticWebPanel', () => {
  it('renders the scan results grid and the preview diff', async () => {
    const { fetchImpl } = stub({ status: 'open' })
    await toPlan(fetchImpl)
    expect(get('aw-check-discovery.a2aAgentCard').textContent).toContain('fail')
    expect(get('aw-check-discovery.mcpServerCard').textContent).toContain('pass')
    expect(get('aw-check-commerce.acp').textContent).toContain('neutral')
    const diffs = container.querySelectorAll('[data-testid="aw-diff"]')
    expect(diffs.length).toBe(2)
    expect(diffs[0].textContent).toContain('/.well-known/agent-card.json')
    expect(diffs[0].textContent).toContain('+{"name":"Acme"}')
  })

  it('shows DNSSEC and payment items as needs owner decision, never as an apply option', async () => {
    const { fetchImpl } = stub({ status: 'open' })
    await toPlan(fetchImpl)
    expect(get('aw-owner-dnssec_enable').textContent).toContain('needs owner decision')
    expect(get('aw-owner-live_payment').textContent).toContain('needs owner decision')
    const diffText = [...container.querySelectorAll('[data-testid="aw-diff"]')].map((d) => d.textContent).join('\n')
    expect(diffText).not.toContain('x402')
    expect(q('aw-owner-customer_domain_publish')).toBeNull()
  })

  it('keeps Apply disabled while the card is open', async () => {
    const { calls, fetchImpl } = stub({ status: 'open' })
    await toPlan(fetchImpl)
    expect((get('aw-apply') as HTMLButtonElement).disabled).toBe(true)
    await click('aw-request-approval')
    await waitFor(() => get('aw-card'))
    expect(get('aw-card').textContent).toContain('dec-7')
    expect((get('aw-apply') as HTMLButtonElement).disabled).toBe(true)
    await click('aw-apply')
    expect(calls).not.toContain('apply')
  })

  it('keeps Apply disabled for a rejected card', async () => {
    const { fetchImpl } = stub({ status: 'answered', answer: 'reject' })
    await toPlan(fetchImpl)
    await click('aw-request-approval')
    await waitFor(() => get('aw-card'))
    await act(async () => {
      get('aw-card').querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await waitFor(() => expect(get('aw-card-status').textContent).toContain('reject'))
    expect((get('aw-apply') as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables Apply only for an approved card, then verifies and offers the report', async () => {
    const { calls, fetchImpl } = stub({ status: 'answered', answer: 'approve' })
    await toPlan(fetchImpl)
    await click('aw-request-approval')
    await waitFor(() => get('aw-card'))
    await act(async () => {
      get('aw-card').querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await waitFor(() => expect((get('aw-apply') as HTMLButtonElement).disabled).toBe(false))
    await click('aw-apply')
    await waitFor(() => get('aw-report'))
    expect(calls.filter((c) => c === 'apply').length).toBe(1)
    expect(calls).toEqual(expect.arrayContaining(['verify', 'report']))
    expect(get('aw-report-download').getAttribute('href')).toContain('data:text/markdown')
  })
})

describe('helpers', () => {
  it('cardApproved is true only for answered/approve', () => {
    expect(cardApproved(null)).toBe(false)
    expect(cardApproved({ decision_id: 'd', status: 'open' })).toBe(false)
    expect(cardApproved({ decision_id: 'd', status: 'answered', answer: 'reject' })).toBe(false)
    expect(cardApproved({ decision_id: 'd', status: 'answered', answer: 'approve' })).toBe(true)
  })
  it('scanRows reads a flat map and a {checks} wrapper', () => {
    expect(scanRows({ 'a.b': 'pass', raw: {} })).toEqual([{ check: 'a.b', remote: 'pass' }])
    expect(scanRows({ checks: { 'a.b': 'fail' } })).toEqual([{ check: 'a.b', remote: 'fail' }])
  })
})
