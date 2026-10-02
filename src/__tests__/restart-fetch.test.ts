/**
 * A chat turn sent while the backend restarts is sent again, not failed
 * (lib/restartFetch.ts). Measured 2026-10-01: Genesis restarted 54 times in one day.
 */
import { fetchThroughRestart, backendIsAway } from '../lib/restartFetch';
import * as fs from 'fs';
import * as path from 'path';

type Step = number | 'network' | 'abort' | { status: number; draining?: boolean };

function scripted(steps: Step[]) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step === 'network') throw new TypeError('Failed to fetch');
    if (step === 'abort') {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    const status = typeof step === 'number' ? step : step.status;
    const headers = new Map<string, string>();
    if (typeof step !== 'number' && step.draining) headers.set('x-aither-draining', '1');
    return { status, ok: status < 400, headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null } };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function clock(stepMs = 0) {
  let t = 0;
  const waits: number[] = [];
  return {
    waits,
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms);
      t += ms + stepMs;
    },
  };
}

describe('fetchThroughRestart', () => {
  it('sends the same request again through a restart and returns the one answer', async () => {
    const { calls, fetchImpl } = scripted([502, 'network', { status: 503, draining: true }, 200]);
    const c = clock();
    const retries: number[] = [];
    const resp = await fetchThroughRestart('/api/chat/stream', { method: 'POST', body: '{"message":"hi"}' }, {
      fetchImpl, sleep: c.sleep, now: c.now, onRetry: n => retries.push(n),
    });
    expect(resp.status).toBe(200);
    expect(calls).toHaveLength(4);
    expect(new Set(calls.map(x => x.body)).size).toBe(1);
    expect(retries).toEqual([1, 2, 3]);
  });

  it('does not retry an answer from the app, good or bad', async () => {
    for (const status of [200, 400, 401, 429, 500]) {
      const { calls, fetchImpl } = scripted([status]);
      const c = clock();
      const resp = await fetchThroughRestart('/x', {}, { fetchImpl, sleep: c.sleep, now: c.now });
      expect(resp.status).toBe(status);
      expect(calls).toHaveLength(1);
    }
  });

  it('gives up after the wait and hands back the last response', async () => {
    const { calls, fetchImpl } = scripted([503]);
    const c = clock();
    const resp = await fetchThroughRestart('/x', {}, { fetchImpl, sleep: c.sleep, now: c.now, waitMs: 20_000 });
    expect(resp.status).toBe(503);
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.length).toBeLessThan(8);
  });

  it('throws the network error when the backend never comes back', async () => {
    const { fetchImpl } = scripted(['network']);
    const c = clock();
    await expect(
      fetchThroughRestart('/x', {}, { fetchImpl, sleep: c.sleep, now: c.now, waitMs: 10_000 }),
    ).rejects.toThrow('Failed to fetch');
  });

  it('never retries a request the user aborted', async () => {
    const { calls, fetchImpl } = scripted(['abort', 200]);
    const c = clock();
    await expect(fetchThroughRestart('/x', {}, { fetchImpl, sleep: c.sleep, now: c.now })).rejects.toThrow('aborted');
    expect(calls).toHaveLength(1);
  });

  it('an attempt with no headers in time is treated as away and sent again', async () => {
    let n = 0;
    const fetchImpl = ((_: string, init?: RequestInit) => {
      n += 1;
      if (n > 1) return Promise.resolve({ status: 200, headers: { get: () => null } });
      return new Promise((_ok, fail) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          fail(e);
        });
      });
    }) as unknown as typeof fetch;
    const c = clock();
    const resp = await fetchThroughRestart('/x', {}, { fetchImpl, sleep: c.sleep, now: c.now, attemptTimeoutMs: 20 });
    expect(resp.status).toBe(200);
    expect(n).toBe(2);
  });

  it('a draining 503 counts as away; an app 503 body does not change that', () => {
    const mk = (status: number, draining = false) =>
      ({ status, headers: { get: (k: string) => (draining && k === 'x-aither-draining' ? '1' : null) } }) as unknown as Response;
    expect(backendIsAway(mk(503, true))).toBe(true);
    expect(backendIsAway(mk(502))).toBe(true);
    expect(backendIsAway(mk(500))).toBe(false);
    expect(backendIsAway(mk(200))).toBe(false);
  });
});

describe('ChatPanel sends its turns through fetchThroughRestart', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'panels', 'ChatPanel.tsx'), 'utf8');

  it('no chat POST uses a bare fetch', () => {
    const posts = src.split('\n').filter(l => /fetch\w*\(/i.test(l) && /\/api\/chat\/(aither|stream)[`']/.test(l));
    expect(posts.length).toBeGreaterThanOrEqual(3);
    for (const line of posts) expect(line).toContain('fetchThroughRestart(');
  });
});
