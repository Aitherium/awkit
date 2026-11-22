import { friendlyHttpError, friendlyThrown, isHumanDetail } from './friendlyError'

describe('friendlyHttpError', () => {
  it('never prints a bare status code', () => {
    for (const s of [0, 400, 401, 403, 404, 408, 409, 413, 429, 500, 502, 503, 504]) {
      expect(friendlyHttpError(s)).not.toMatch(/HTTP|\b[45]\d\d\b/)
    }
  })
  it('a 404 on a named feature states only what is known and points to Support', () => {
    const t = friendlyHttpError(404, { subject: 'CertTrack' })
    expect(t).toBe('CertTrack is not connected on this desktop yet. If you expected it here, tell Support.')
    // No invented remedy: there is no "turn it on" switch and we cannot know the workspace.
    expect(t).not.toMatch(/administrator|turn it on|in this workspace/i)
    expect(friendlyHttpError(404)).not.toMatch(/administrator|turn it on|in this workspace/i)
  })
  it('keeps a real host sentence', () => {
    expect(friendlyHttpError(403, { detail: 'Only workspace admins can read this.' })).toBe('Only workspace admins can read this.')
  })
  it('replaces a status echo, a reason phrase and markup', () => {
    for (const d of ['HTTP 404', 'Not Found', 'Bad Gateway', '<html>nope</html>', '{"a":1}', '404', '']) {
      expect(isHumanDetail(d)).toBe(false)
      expect(friendlyHttpError(404, { detail: d, subject: 'X' })).toContain('not connected')
    }
  })
  it('no answer at all reads as a connection problem', () => {
    expect(friendlyHttpError(undefined, { action: 'load your certifications' })).toMatch(/^Could not load your certifications\./)
  })
  it('thrown HTTP nnn messages are translated, other sentences kept', () => {
    expect(friendlyThrown(new Error('HTTP 502'))).toMatch(/our side/)
    expect(friendlyThrown(new Error('Failed to fetch'))).toMatch(/Could not reach/)
    expect(friendlyThrown(new Error('The mailbox is full.'))).toBe('The mailbox is full.')
  })
  it('hides parser and network wording behind a plain sentence', () => {
    const jargon = [
      new SyntaxError('Unexpected token < in JSON at position 0'),
      new Error('Unexpected token < in JSON at position 0'),
      new Error('NetworkError when attempting to fetch resource.'),
      new TypeError('Failed to fetch'),
      new TypeError("Cannot read properties of undefined (reading 'x')"),
      new Error('net::ERR_CONNECTION_REFUSED'),
      new DOMException('The operation was aborted.', 'AbortError'),
    ]
    for (const e of jargon) {
      const t = friendlyThrown(e, { action: 'load your notes' })
      expect(t).not.toMatch(/token|JSON|NetworkError|fetch|undefined|net::|aborted|position/i)
      expect(t).toMatch(/^Could not load your notes/)
    }
  })
  it('a custom error class carrying a deliberate sentence is kept, even one that mentions a timeout', () => {
    class HostError extends Error { constructor(m: string) { super(m); this.name = 'HostError' } }
    expect(friendlyThrown(new HostError('Your mail server timed out; try again after 5 pm.'), { action: 'send it' }))
      .toBe('Your mail server timed out; try again after 5 pm.')
    expect(friendlyThrown(new HostError('The mailbox is full.'))).toBe('The mailbox is full.')
    // a bare stack-level timeout line is still translated
    expect(friendlyThrown(new Error('Request timed out'), { action: 'load it' })).toMatch(/took too long/)
    // runtime error classes are still hidden
    expect(friendlyThrown(new RangeError('Invalid array length'), { action: 'load it' })).toMatch(/^Could not load it/)
  })
  it('unreadable answers are said as such, not as a lost connection', () => {
    expect(friendlyThrown(new SyntaxError('Unexpected token < in JSON at position 0')))
      .toMatch(/something unexpected/)
  })
  it('timeouts read as a sentence with no "did not work: it took too long"', () => {
    expect(friendlyHttpError(504)).toBe('That took too long. Try again in a moment.')
    expect(friendlyHttpError(408, { action: 'open that page' })).toBe(
      'Could not open that page because it took too long. Try again in a moment.')
    expect(friendlyThrown(new DOMException('x', 'AbortError'))).toMatch(/took too long/)
  })
})

describe('friendlyError source', () => {
  it('has no control bytes (a backslash-b typed through a tool call became 0x08 once)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path')
    const src = fs.readFileSync(path.join(__dirname, 'friendlyError.ts'), 'utf8')
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(src)).toBe(false)
  })
  it('the word-boundary patterns really match whole words only', () => {
    expect(friendlyThrown(new Error('The records are sorted'), { action: 'x' })).toBe('The records are sorted')
    expect(friendlyThrown(new Error('CORS policy blocked it'), { action: 'load it' })).toMatch(/^Could not load it/)
    expect(friendlyThrown(new Error('Request aborted'), { action: 'load it' })).toMatch(/took too long/)
  })
})
