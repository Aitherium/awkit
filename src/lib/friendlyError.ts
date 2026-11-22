/**
 * One place that turns a failed request into a sentence a non-technical person can act on.
 *
 * Why: a panel that printed `HTTP 404` (CertTrack on a workspace that has no CertTrack
 * backend, owner screenshot 2026-11-16) tells a grandma nothing, and ~70 panels build that
 * string by hand. A status code is for logs; the screen gets the cause and the next step.
 *
 * Contract:
 *  - a human `detail` from the host (a sentence) is kept as the host wrote it;
 *  - a generic reason phrase ("Not Found", "Bad Gateway", "HTTP 404", a JSON/HTML blob) is
 *    NOT a sentence and is replaced by the status-class sentence;
 *  - status 0 / undefined means the request never got an answer.
 */

/** Phrases servers and proxies send as `detail` that carry no meaning for a person. */
const GENERIC_DETAIL =
  /^(?:http\s*\d{3}(?:\s.*)?|\d{3}|not found|forbidden|unauthori[sz]ed|bad request|bad gateway|service unavailable|gateway time-?out|internal server error|method not allowed|request timeout|too many requests|conflict|error|failed|fetch failed|failed to fetch|network ?error|load failed)\.?$/i

/** True when `detail` is a sentence worth showing (not a status echo, markup or JSON). */
export function isHumanDetail(detail: unknown): detail is string {
  if (typeof detail !== 'string') return false
  const t = detail.trim()
  if (!t || t.length > 300) return false
  if (GENERIC_DETAIL.test(t)) return false
  if (/^[<{[]/.test(t)) return false
  return true
}

export interface FriendlyErrorOptions {
  /** What was being done, as a verb phrase: "load your certifications". */
  action?: string
  /** What the thing is called for the not-set-up case: "CertTrack". */
  subject?: string
  /** The host's own explanation, kept when it is a real sentence. */
  detail?: unknown
}

/** The sentence for a status. `status` 0/undefined = no answer at all. */
export function friendlyHttpError(status: number | undefined, opts: FriendlyErrorOptions = {}): string {
  if (isHumanDetail(opts.detail)) return opts.detail.trim()
  const subject = opts.subject || 'This'
  const could = opts.action ? `Could not ${opts.action}` : 'That did not work'
  if (!status) return `${opts.action ? could : 'Could not reach the service'}. Check your connection and try again.`
  if (status === 401) return 'You have been signed out. Sign in again to continue.'
  if (status === 403) {
    return `You do not have permission${opts.action ? ` to ${opts.action}` : ' for this'}. Ask a workspace administrator for access.`
  }
  if (status === 404 || status === 410) {
    return opts.subject
      ? `${subject} is not connected on this desktop yet. If you expected it here, tell Support.`
      : 'This is not available right now. If you expected it here, tell Support.'
  }
  if (status === 408 || status === 504) {
    return opts.action
      ? `Could not ${opts.action} because it took too long. Try again in a moment.`
      : 'That took too long. Try again in a moment.'
  }
  if (status === 409) return 'Someone changed this at the same time. Reload and try again.'
  if (status === 413) return 'That file is too large.'
  if (status === 429) return 'Too many requests. Wait a minute and try again.'
  if (status >= 500) return `${could}: something went wrong on our side. Try again in a minute; if it keeps happening, use Support.`
  return `${could}. Try again, or use Support if it keeps happening.`
}

/** Wording from a JSON/HTML parser: the service answered, but not in a shape we can read. */
const PARSER_WORDING =
  /unexpected (?:token|end of|character|non-whitespace)|in json at position|is not valid json|json\.parse|not valid json|unterminated string|expected (?:property name|double-quoted)/i
/** Wording from the browser or network stack: the request never completed. */
const NETWORK_WORDING =
  /networkerror|network request failed|failed to fetch|load failed|fetch failed|err_[a-z_]+|econn\w*|etimedout|enotfound|socket hang up|net::|\bcors\b/i
/** A bare stack-level timeout/abort line ("Request timed out"); a longer host sentence that mentions it is kept. */
const BARE_TIMEOUT =
  /^(?:the\s+)?(?:request|operation|connection|signal|fetch)?\s*(?:(?:was|is)\s+)?(?:timed?[ -]?out|timeout|aborted)\.?$/i
/** Error classes the runtime throws when OUR code fails; any other class may carry a deliberate sentence. (A DOMException is also the runtime's, not ours.) */
const CODE_ERROR_NAMES = new Set(['TypeError', 'RangeError', 'ReferenceError', 'EvalError', 'URIError'])
/** Wording from our own code failing (a bug), never a sentence for a person. */
const CODE_WORDING = /cannot read propert|is not a function|is not defined|is not iterable|undefined|null is not/i

/** For a thrown error: translate status echoes, parser and network wording; keep deliberate sentences. */
export function friendlyThrown(e: unknown, opts: FriendlyErrorOptions = {}): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const name = e && typeof e === 'object' && typeof (e as { name?: unknown }).name === 'string' ? (e as { name: string }).name : ''
  const could = opts.action ? `Could not ${opts.action}` : 'That did not work'
  const m = /^HTTP\s*(\d{3})/i.exec(msg)
  if (m) return friendlyHttpError(Number(m[1]), opts)
  if (name === 'AbortError' || name === 'TimeoutError' || BARE_TIMEOUT.test(msg.trim()) || /^request aborted$/i.test(msg.trim())) {
    return friendlyHttpError(504, opts)
  }
  if (name === 'SyntaxError' || PARSER_WORDING.test(msg)) {
    return `${could}: the service sent back something unexpected. Try again in a moment; if it keeps happening, use Support.`
  }
  if (NETWORK_WORDING.test(msg)) return friendlyHttpError(0, opts)
  // The runtime's own error classes are our code failing, not a message written for a person.
  if (CODE_ERROR_NAMES.has(name) || (typeof DOMException !== 'undefined' && e instanceof DOMException)) return friendlyHttpError(0, opts)
  if (CODE_WORDING.test(msg)) return friendlyHttpError(0, opts)
  // Plain Error or a custom class (e.g. HostError) with a real sentence: keep the host's words.
  if (isHumanDetail(msg)) return msg.trim()
  return friendlyHttpError(0, opts)
}
