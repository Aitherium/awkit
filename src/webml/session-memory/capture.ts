/**
 * Capture adapters — turning what the browser session actually produces into
 * plain text for the chunker.
 *
 * Two sources, both first-class:
 *  - AitherBrowser's `/browse` response shape ({status, url, content, engine})
 *    — the service an agent drives; and
 *  - a live DOM node (the page the agent is standing on).
 *
 * The adapter's contract: given either, return the retrievable text and the
 * metadata that should ride along (url, title). Everything else is the
 * chunker's problem.
 */

/** The `/browse` response shape served by AitherBrowser (services/perception/AitherBrowser.py). */
export interface BrowseResponse {
  status: string
  url: string
  content?: string
  engine?: string
}

export interface CaptureInput {
  /** AitherBrowser /browse payload. */
  browse?: BrowseResponse
  /** Live DOM node (or anything with innerText/textContent — duck-typed so it works in jsdom). */
  dom?: { innerText?: string; textContent?: string | null }
  /** Explicit text — highest precedence, used when neither source has content. */
  text?: string
  /** Override metadata (the browse payload's url wins otherwise). */
  url?: string
  title?: string
}

export interface CaptureResult {
  text: string
  url?: string
  title?: string
}

const MAX_CAPTURE_CHARS = 50_000

/** Best-effort page text: textContent degrades to innerText, never the reverse. */
export function textFromDom(node: { innerText?: string; textContent?: string | null }): string {
  const primary = node.innerText ?? node.textContent ?? ""
  return primary.length > 0 ? primary : (node.textContent ?? "")
}

/** Normalize a browse/scrape/DOM capture into text + metadata. */
export function captureText(input: CaptureInput): CaptureResult {
  if (input.browse) {
    const text = input.browse.content ?? ""
    return {
      text: text.slice(0, MAX_CAPTURE_CHARS),
      url: input.url ?? input.browse.url,
      title: input.title,
    }
  }
  if (input.dom) {
    return {
      text: textFromDom(input.dom).slice(0, MAX_CAPTURE_CHARS),
      url: input.url,
      title: input.title,
    }
  }
  return {
    text: (input.text ?? "").slice(0, MAX_CAPTURE_CHARS),
    url: input.url,
    title: input.title,
  }
}
