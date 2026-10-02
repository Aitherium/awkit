/**
 * UpdatesPanel: apply and rollback need confirmation, the channel select can only ever
 * send stable|beta, an unsigned image reads as refused, a license refusal shows its
 * reason, and the rendered panel carries the digests and the signer.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import UpdatesPanel, {
  CONFIRM_TEXT,
  describeUpdate,
  runUpdateAction,
  shortDigest,
  signatureLabel,
  type ApiResult,
  type UpdateStatus,
  type UpdateVerb,
  type UpdatesPanelClient,
} from '../appliance/UpdatesPanel'

const D1 = 'sha256:' + 'a'.repeat(64)
const D2 = 'sha256:' + 'b'.repeat(64)

function status(over: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    checked_at: '2026-09-27T10:00:00Z', state: 'current', channel: 'stable',
    booted_digest: D1, available_digest: D1, staged_digest: null,
    signer_identity: null, rollback_available: true, auto_apply: false, detail: '',
    ...over,
  }
}

/** awnix-update's additive `reason` field (not in the console's UpdateStatus type). */
function withReason(s: UpdateStatus, reason: string): UpdateStatus {
  return { ...s, reason } as UpdateStatus
}

function fakeClient(s: UpdateStatus = status()) {
  const calls: Array<{ verb: UpdateVerb | string; body?: unknown }> = []
  const client: UpdatesPanelClient = {
    async updates(): Promise<ApiResult<UpdateStatus>> {
      return { state: 'ok', status: 200, data: s }
    },
    async action(verb, body): Promise<ApiResult<unknown>> {
      calls.push({ verb, body })
      return { state: 'ok', status: 200, data: { verb, exit: 0 }, exit: 0 }
    },
  }
  return { client, calls }
}

describe('runUpdateAction', () => {
  it('apply asks first, and a "no" sends nothing', async () => {
    const { client, calls } = fakeClient()
    const asked: string[] = []
    const r = await runUpdateAction(client, { kind: 'apply' }, (m) => { asked.push(m); return false })
    expect(r.outcome).toBe('cancelled')
    expect(calls).toHaveLength(0)
    expect(asked[0]).toBe(CONFIRM_TEXT.apply)
    expect(asked[0]).toMatch(/reboot/)
  })

  it('apply with a "yes" sends update-apply', async () => {
    const { client, calls } = fakeClient()
    await runUpdateAction(client, { kind: 'apply' }, () => true)
    expect(calls).toEqual([{ verb: 'update-apply', body: undefined }])
  })

  it('rollback asks first', async () => {
    const { client, calls } = fakeClient()
    expect((await runUpdateAction(client, { kind: 'rollback' }, () => false)).outcome).toBe('cancelled')
    expect(calls).toHaveLength(0)
    await runUpdateAction(client, { kind: 'rollback' }, () => true)
    expect(calls[0].verb).toBe('update-rollback')
  })

  it('check never asks', async () => {
    const { client, calls } = fakeClient()
    await runUpdateAction(client, { kind: 'check' }, () => { throw new Error('asked') })
    expect(calls[0].verb).toBe('update-check')
  })

  it('the channel can only be stable or beta', async () => {
    const { client, calls } = fakeClient()
    for (const bad of ['lts', 'stable; reboot', '', 'BETA']) {
      const r = await runUpdateAction(client, { kind: 'channel', channel: bad }, () => true)
      expect(r.outcome).toBe('invalid')
    }
    expect(calls).toHaveLength(0)
    await runUpdateAction(client, { kind: 'channel', channel: 'stable' }, () => { throw new Error('asked') })
    expect(calls[0]).toEqual({ verb: 'update-channel', body: { channel: 'stable' } })
  })

  it('beta warns before switching', async () => {
    const { client, calls } = fakeClient()
    const asked: string[] = []
    await runUpdateAction(client, { kind: 'channel', channel: 'beta' }, (m) => { asked.push(m); return false })
    expect(calls).toHaveLength(0)
    expect(asked[0]).toMatch(/before it has passed/)
  })

  it('auto-apply sends on/off', async () => {
    const { client, calls } = fakeClient()
    await runUpdateAction(client, { kind: 'auto-apply', on: true }, () => true)
    await runUpdateAction(client, { kind: 'auto-apply', on: false }, () => true)
    expect(calls.map((c) => c.body)).toEqual([{ value: 'on' }, { value: 'off' }])
  })
})

describe('status language', () => {
  it('an unsigned image reads as refused, never as a signer', () => {
    const s = status({ state: 'unsigned-refused', signer_identity: 'https://github.com/x' })
    expect(signatureLabel(s)).toBe('unsigned — refused')
    expect(describeUpdate(s).tone).toBe('danger')
  })

  it('a verified stage names its signer', () => {
    const s = status({ state: 'staged', staged_digest: D2, signer_identity: 'https://github.com/Aitherium/awnix/.github/workflows/build-and-publish-images.yml@refs/heads/main' })
    expect(signatureLabel(s)).toMatch(/^https:\/\/github.com\/Aitherium\/awnix/)
    expect(describeUpdate(s).headline).toBe('An update is ready')
  })

  it('license-refused shows the reason', () => {
    const d = describeUpdate(status({ state: 'license-refused', detail: 'the license was refused (revoked)' }))
    expect(d.tone).toBe('warn')
    expect(d.body).toContain('revoked')
  })

  it('a staged image this box did not verify reads as refused', () => {
    const s = withReason(status({ state: 'unsigned-refused', staged_digest: D2 }), 'staged-unverified')
    expect(signatureLabel(s)).toBe('unsigned — refused')
    expect(describeUpdate(s).tone).toBe('danger')
  })

  it('an unpublished channel is informational, not a failure', () => {
    const d = describeUpdate(withReason(status({ state: 'offline' }), 'channel-unpublished'))
    expect(d.tone).toBe('info')
    expect(d.headline).toBe('No release on this channel yet')
  })

  it('a rollback reads as rolling back, not as a fresh update', () => {
    const d = describeUpdate(withReason(status({ state: 'staged' }), 'rolled-back'))
    expect(d.headline).toBe('Rolling back')
  })

  it('an unknown reason falls back to the contract state', () => {
    const d = describeUpdate(withReason(status({ state: 'current' }), 'something-new'))
    expect(d.headline).toBe('Up to date')
  })

  it('digests are shortened, never blank', () => {
    expect(shortDigest(D1)).toBe('sha256:aaaaaaaaaaaa')
    expect(shortDigest(null)).toBe('—')
  })
})

describe('client contract', () => {
  it('the console client (createApplianceClient) satisfies the panel client', async () => {
    const { createApplianceClient } = await import('../appliance/client')
    const seen: string[] = []
    const fetchStub = (async (url: string) => {
      seen.push(String(url))
      const body = String(url).endsWith('/updates')
        ? { verb: 'updates', exit: 0, state: 'ok', result: status(), stdout_tail: '' }
        : { verb: 'update-check', exit: 0, state: 'ok', result: null, stdout_tail: '' }
      return new Response(JSON.stringify(body), { status: 200 })
    }) as unknown as typeof fetch
    const real: UpdatesPanelClient = createApplianceClient('', { fetch: fetchStub })
    const r = await real.updates()
    expect(r.state).toBe('ok')
    expect(r.data?.channel).toBe('stable')
    await runUpdateAction(real, { kind: 'check' }, () => true)
    expect(seen).toEqual(['/api/appliance/updates', '/api/appliance/actions/update-check'])
  })
})

describe('render', () => {
  it('shows the channel, digests and signer (first paint is the loading state)', () => {
    const { client } = fakeClient()
    const html = renderToStaticMarkup(<UpdatesPanel client={client} />)
    expect(html).toContain('Loading update status')
    expect(html).not.toMatch(/next\//)
  })

  it('a staged, signed update shows digests, signer, and an enabled Restart', () => {
    const { client } = fakeClient()
    const s = status({ state: 'staged', staged_digest: D2, available_digest: D2, signer_identity: 'https://github.com/Aitherium/awnix/x.yml@refs/heads/main' })
    const html = renderToStaticMarkup(<UpdatesPanel client={client} initial={s} />)
    expect(html).toContain('sha256:bbbbbbbbbbbb')
    expect(html).toContain('https://github.com/Aitherium/awnix/x.yml@refs/heads/main')
    expect(html).toMatch(/<button[^>]*>Restart to update<\/button>/)
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Restart to update/)
  })

  it('unsigned-refused renders the refusal and keeps Restart disabled', () => {
    const { client } = fakeClient()
    const html = renderToStaticMarkup(<UpdatesPanel client={client} initial={status({ state: 'unsigned-refused' })} />)
    expect(html).toContain('unsigned — refused')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Restart to update/)
  })
})
