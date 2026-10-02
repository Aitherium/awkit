/**
 * requestDownload maps every server answer to an explicit state, and the panel
 * renders each one. Both directions: a 200 must yield links, and a 200 WITHOUT
 * links must be an error, never an empty success.
 */
import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import DownloadPanel, { secondsLeft } from '../panels/LicenseDownloadPanel'
import {
  assembleInstructions,
  formatBytes,
  looksLikeEnvelope,
  requestDownload,
  type LicenseDownloadResponse,
} from '../appliance/download-client'

const LIC = 'AITHER1.eyJzIjoxfQ.c2ln'
const SHA = 'ab'.repeat(32)

const OK_BODY: LicenseDownloadResponse = {
  ok: true,
  asset: 'acme-iso',
  release_tag: 'appliance-20260926',
  filename: 'awnix-x86_64.iso',
  size: 1800,
  sha256: SHA,
  parts: [
    { name: 'awnix-x86_64.iso.00.part', size: 1000, url: 'https://objects.example/10', expires_at: 2000 },
    { name: 'awnix-x86_64.iso.01.part', size: 800, url: 'https://objects.example/11', expires_at: 2000 },
  ],
  extras: [{ name: 'SHA256SUMS', url: 'https://objects.example/12' }],
  expires_at: 2000,
  lic_id: 'lic_x',
}

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return {
      status,
      headers: { get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null },
      json: async () => body,
    } as unknown as Response
  }
  return { impl, calls }
}

describe('requestDownload', () => {
  it('posts the normalised envelope with no credentials and maps 200 to ok', async () => {
    const f = fakeFetch(200, OK_BODY)
    const r = await requestDownload('https://api.example/', { license: ` ${LIC}\n`, asset: 'acme-iso' }, f.impl)
    expect(r.state).toBe('ok')
    expect(r.data?.sha256).toBe(SHA)
    expect(f.calls[0].url).toBe('https://api.example/v1/licenses/download')
    expect(f.calls[0].init?.credentials).toBe('omit')
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ license: LIC, asset: 'acme-iso' })
  })

  it('a 200 without links is an error, never an empty success', async () => {
    const r = await requestDownload('x', { license: LIC, asset: 'acme-iso' }, fakeFetch(200, { ok: true, parts: [] }).impl)
    expect(r.state).toBe('error')
  })

  it('maps every refusal code', async () => {
    const cases: [number, unknown, string][] = [
      [400, { code: 'malformed' }, 'invalid'],
      [403, { code: 'invalid' }, 'invalid'],
      [403, { code: 'expired' }, 'expired'],
      [403, { code: 'revoked' }, 'revoked'],
      [403, { code: 'not-entitled' }, 'not-entitled'],
      [403, { code: 'unknown-license' }, 'invalid'],
      [404, { code: 'unknown-release' }, 'error'],
      [503, { code: 'unavailable' }, 'unavailable'],
      [500, {}, 'error'],
    ]
    for (const [status, body, want] of cases) {
      const r = await requestDownload('x', { license: LIC, asset: 'acme-iso' }, fakeFetch(status, body).impl)
      expect(r.state).toBe(want)
    }
  })

  it('429 carries Retry-After', async () => {
    const r = await requestDownload('x', { license: LIC, asset: 'acme-iso' },
      fakeFetch(429, { code: 'throttled' }, { 'Retry-After': '120' }).impl)
    expect(r.state).toBe('throttled')
    expect(r.retryAfter).toBe(120)
  })

  it('a network failure is an error state', async () => {
    const r = await requestDownload('x', { license: LIC, asset: 'acme-iso' }, async () => {
      throw new Error('offline')
    })
    expect(r.state).toBe('error')
    expect(r.detail).toBe('offline')
  })
})

describe('helpers', () => {
  it('recognises the envelope shape', () => {
    expect(looksLikeEnvelope(LIC)).toBe(true)
    expect(looksLikeEnvelope('AITHER2.a.b')).toBe(false)
    expect(looksLikeEnvelope('')).toBe(false)
  })
  it('formats sizes and countdowns', () => {
    expect(formatBytes(1024 * 1024 * 1900)).toBe('1.9 GB')
    expect(secondsLeft(2000, 1_700_000)).toBe(300)
    expect(secondsLeft(2000, 3_000_000)).toBe(0)
  })
  it('instructions name the verify step and the expected digest', () => {
    const lines = assembleInstructions(OK_BODY).join('\n')
    expect(lines).toContain('sha256sum -c SHA256SUMS')
    expect(lines).toContain(SHA)
  })
})

describe('DownloadPanel', () => {
  it('renders links, sha256 and a live countdown for ok', () => {
    const html = renderToStaticMarkup(
      <DownloadPanel apiBase="x" now={() => 1_700_000} initialResult={{ state: 'ok', status: 200, data: OK_BODY }} />,
    )
    expect(html).toContain('https://objects.example/10')
    expect(html).toContain(SHA)
    expect(html).toContain('links expire in 5:00')
  })

  it('hides links once they have expired', () => {
    const html = renderToStaticMarkup(
      <DownloadPanel apiBase="x" now={() => 3_000_000} initialResult={{ state: 'ok', status: 200, data: OK_BODY }} />,
    )
    expect(html).not.toContain('https://objects.example/10')
    expect(html).toContain('links expired')
  })

  for (const state of ['invalid', 'expired', 'revoked', 'not-entitled', 'throttled', 'unavailable', 'error'] as const) {
    it(`renders the ${state} state as an alert`, () => {
      const html = renderToStaticMarkup(
        <DownloadPanel apiBase="x" initialResult={{ state, status: 403, retryAfter: 120 }} />,
      )
      expect(html).toContain(`data-state="${state}"`)
      expect(html).toContain('role="alert"')
    })
  }
})
