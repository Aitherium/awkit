/**
 * Tests for the absolute-API-base resolution + URL rewriting that makes a
 * portal-kit SPA static-hostable (e.g. GitHub Pages) against a cross-origin
 * backend. Runner-agnostic (vitest/jest `describe`/`it`/`expect`).
 *
 * The critical invariant: with NO base configured, rewriteApiUrl is the
 * identity function — so same-origin / proxied deployments are unchanged.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getApiBase, setApiBase, hasAbsoluteApiBase, rewriteApiUrl } from './apiBase';

describe('apiBase', () => {
  beforeEach(() => setApiBase(null));

  it('defaults to empty (same-origin) and is the identity rewrite', () => {
    expect(getApiBase()).toBe('');
    expect(hasAbsoluteApiBase()).toBe(false);
    expect(rewriteApiUrl('/api/booking')).toBe('/api/booking');
    expect(rewriteApiUrl('/api/chat/aither/steer/x')).toBe('/api/chat/aither/steer/x');
  });

  it('strips a trailing slash from the configured base', () => {
    setApiBase('https://acme-api.aitherium.com/');
    expect(getApiBase()).toBe('https://acme-api.aitherium.com');
    expect(hasAbsoluteApiBase()).toBe(true);
  });

  it('prefixes relative /api/* onto the absolute base', () => {
    setApiBase('https://acme-api.aitherium.com');
    expect(rewriteApiUrl('/api/booking')).toBe('https://acme-api.aitherium.com/api/booking');
    expect(rewriteApiUrl('/api/config/embed')).toBe('https://acme-api.aitherium.com/api/config/embed');
  });

  it('does not touch non-/api paths or other absolute URLs', () => {
    setApiBase('https://acme-api.aitherium.com');
    expect(rewriteApiUrl('/assets/index.js')).toBe('/assets/index.js');
    expect(rewriteApiUrl('https://fonts.googleapis.com/css2')).toBe('https://fonts.googleapis.com/css2');
  });

  it('setApiBase("") clears back to same-origin', () => {
    setApiBase('https://acme-api.aitherium.com');
    setApiBase('');
    expect(getApiBase()).toBe('');
    expect(rewriteApiUrl('/api/booking')).toBe('/api/booking');
  });
});
