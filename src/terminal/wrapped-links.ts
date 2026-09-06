/**
 * Wrapped-URL link reconstruction for xterm.js terminals.
 * ========================================================
 *
 * WHY THIS EXISTS — the bug it fixes, so nobody "simplifies" it back:
 *
 * xterm's stock `WebLinksAddon` matches links **one buffer row at a time**, and
 * relies on `bufferLine.isWrapped` to stitch a wrapped line back together. That
 * works when the *application* writes a long line and lets the terminal wrap it.
 *
 * It does NOT work under tmux, and the AitherTunnel shell always runs under tmux
 * (`tmux -u new -A -s main`). tmux does its own wrapping: it redraws each screen
 * row separately with explicit cursor positioning, so every row arrives at the
 * client as its own NON-wrapped buffer line. `isWrapped` is false for all of
 * them. The addon therefore matches only the fragment on the row you tapped and
 * hands `window.open()` a truncated URL.
 *
 * On a phone the terminal is ~40 columns wide, so a Claude Code OAuth URL spans
 * four or five rows and the fragment that gets opened is missing `redirect_uri`
 * entirely — the "Missing redirect_uri" failure. The login is unusable.
 *
 * The fix is to reconstruct the logical line from the AUTO-WRAP SHAPE rather than
 * from `isWrapped`: a row that is continued fills its last column with a
 * non-space, and the next row starts with a non-space. That signature holds for
 * both real xterm wrapping and tmux's redraw-per-row wrapping, so one rule covers
 * both transports.
 *
 * Everything here is framework-free and DOM-free on purpose: it is consumed by
 * the React <WebTerminal> AND bundled standalone for the Python-rendered tunnel
 * portal, and it is unit-tested against a plain fake buffer.
 */

/** Minimal structural type for an xterm buffer line (v4 through v6). */
export interface BufferLineLike {
  readonly isWrapped?: boolean;
  readonly length: number;
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

/** Minimal structural type for the parts of a Terminal we read. */
export interface TerminalLike {
  readonly cols: number;
  readonly buffer: {
    readonly active: {
      readonly length: number;
      getLine(y: number): BufferLineLike | undefined;
    };
  };
}

/**
 * A logical (unwrapped) line reassembled from one or more buffer rows.
 *
 * `text` is the concatenation of every row padded to exactly `cols`, so the
 * offset arithmetic in {@link offsetToPosition} is uniform: character `n` always
 * lives at row `startRow + (n / cols | 0)`, column `n % cols`. Do not trim the
 * intermediate rows — that is what breaks the mapping.
 */
export interface LogicalLine {
  text: string;
  startRow: number;
  rowCount: number;
  cols: number;
}

export interface UrlMatch {
  url: string;
  /** Inclusive start offset into LogicalLine.text. */
  start: number;
  /** Exclusive end offset into LogicalLine.text. */
  end: number;
}

/**
 * URL characters we accept. Deliberately conservative — it excludes whitespace,
 * quotes, angle brackets, backslash, and the brace/bracket/pipe family.
 *
 * Excluding `[` and `]` costs us bare-IPv6 URLs (`http://[::1]/`), which do not
 * occur in the OAuth flows this exists for, and buys a real guarantee: when a
 * URL happens to end on the last column of the bottom-most content row, the
 * joiner can reach the tmux STATUS BAR, whose text starts `[0] 0:bash*`. Without
 * this exclusion that status text would be appended to the URL and opened.
 */
const URL_PATTERN = /(?:https?|ftp):\/\/[^\s<>"'`\\^{}|[\]]+/g;

/** Trailing characters that are almost always sentence punctuation, not URL. */
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;

/** How many rows a single logical line may span. 24 rows x 40 cols = 960 chars,
 *  comfortably past the longest OAuth URL, and bounded so a screen full of
 *  full-width box-drawing output cannot make this quadratic. */
const MAX_JOINED_ROWS = 24;

/**
 * Is buffer row `y` continued onto row `y + 1`?
 *
 * Two independent signals, either of which is sufficient:
 *   1. `isWrapped` on the next line — a real xterm auto-wrap (non-tmux shells,
 *      and tmux's own output when it does let the terminal wrap).
 *   2. The auto-wrap SHAPE — row `y` fills its final column with a non-space and
 *      row `y + 1` opens with a non-space. This is the tmux case, where every row
 *      is a separately-positioned redraw and `isWrapped` is always false.
 */
export function isContinuedRow(term: TerminalLike, y: number): boolean {
  const buf = term.buffer.active;
  const next = buf.getLine(y + 1);
  if (!next) return false;
  if (next.isWrapped) return true;

  const cols = term.cols;
  if (cols <= 0) return false;

  const current = buf.getLine(y);
  if (!current) return false;

  // translateToString(false) pads to the full line width.
  const currentText = current.translateToString(false);
  if (currentText.length < cols) return false;
  if (currentText.charAt(cols - 1) === ' ') return false;

  const nextText = next.translateToString(false);
  const nextFirst = nextText.charAt(0);
  if (!nextFirst || nextFirst === ' ') return false;

  return true;
}

/**
 * Reassemble the logical line containing buffer row `row`, walking backwards to
 * the first row of the wrap group and forwards to the last.
 */
export function readLogicalLine(term: TerminalLike, row: number): LogicalLine {
  const buf = term.buffer.active;
  const cols = term.cols;

  let startRow = row;
  let backSteps = 0;
  while (startRow > 0 && backSteps < MAX_JOINED_ROWS && isContinuedRow(term, startRow - 1)) {
    startRow--;
    backSteps++;
  }

  let endRow = row;
  let forwardSteps = 0;
  while (
    endRow < buf.length - 1 &&
    endRow - startRow + 1 < MAX_JOINED_ROWS &&
    forwardSteps < MAX_JOINED_ROWS &&
    isContinuedRow(term, endRow)
  ) {
    endRow++;
    forwardSteps++;
  }

  let text = '';
  for (let y = startRow; y <= endRow; y++) {
    const line = buf.getLine(y);
    if (!line) break;
    // Pad every row to exactly `cols` so offset -> (row, col) stays uniform.
    const raw = line.translateToString(false);
    text += raw.length >= cols ? raw.slice(0, cols) : raw.padEnd(cols, ' ');
  }

  return { text, startRow, rowCount: endRow - startRow + 1, cols };
}

/** Find every URL in a reassembled logical line, with offsets into its text. */
export function findUrls(text: string): UrlMatch[] {
  const matches: UrlMatch[] = [];
  URL_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = URL_PATTERN.exec(text)) !== null) {
    let url = m[0];

    // Trim sentence punctuation the regex swallowed.
    const trimmed = url.replace(TRAILING_PUNCTUATION, '');
    if (trimmed.length >= 'http://a'.length) url = trimmed;

    // Trim an unbalanced closing paren (common in prose: "see (http://x)").
    while (url.endsWith(')')) {
      const opens = (url.match(/\(/g) || []).length;
      const closes = (url.match(/\)/g) || []).length;
      if (closes <= opens) break;
      url = url.slice(0, -1);
    }

    if (url.length < 'http://a'.length) continue;

    matches.push({ url, start: m.index, end: m.index + url.length });
  }

  return matches;
}

/** Map an offset in a LogicalLine's text to xterm's 1-based buffer position. */
export function offsetToPosition(line: LogicalLine, offset: number): { x: number; y: number } {
  const cols = line.cols > 0 ? line.cols : 1;
  const rowDelta = Math.floor(offset / cols);
  const col = offset - rowDelta * cols;
  return { x: col + 1, y: line.startRow + rowDelta + 1 };
}

/**
 * Extract every URL visible from buffer row `row`, as full reconstructed URLs.
 * Returns [] when the row is not part of a line containing a URL.
 */
export function urlsAtRow(term: TerminalLike, row: number): UrlMatch[] {
  const logical = readLogicalLine(term, row);
  if (!logical.text) return [];
  return findUrls(logical.text);
}

// ─────────────────────────────────────────────────────────────────────────────
// xterm integration
// ─────────────────────────────────────────────────────────────────────────────

/** The subset of xterm's ILink we construct. */
export interface ProvidedLink {
  range: { start: { x: number; y: number }; end: { x: number; y: number } };
  text: string;
  activate(event: MouseEvent, text: string): void;
  hover?(event: MouseEvent, text: string): void;
  leave?(event: MouseEvent, text: string): void;
}

export interface WrappedLinkProviderOptions {
  /** Invoked with the FULL reconstructed URL. */
  onActivate(url: string, event: MouseEvent): void;
  onHover?(url: string): void;
  onLeave?(url: string): void;
}

/**
 * Build an xterm `ILinkProvider` that understands tmux-wrapped URLs.
 *
 * Register with `term.registerLinkProvider(createWrappedLinkProvider(term, ...))`
 * and do NOT also load `WebLinksAddon` — two providers on the same range give
 * you two underlines and a race over which handler runs.
 */
export function createWrappedLinkProvider(
  term: TerminalLike,
  options: WrappedLinkProviderOptions,
): { provideLinks(bufferLineNumber: number, callback: (links: ProvidedLink[] | undefined) => void): void } {
  return {
    provideLinks(bufferLineNumber, callback) {
      const row = bufferLineNumber - 1;
      let logical: LogicalLine;
      try {
        logical = readLogicalLine(term, row);
      } catch {
        callback(undefined);
        return;
      }
      if (!logical.text) {
        callback(undefined);
        return;
      }

      const links: ProvidedLink[] = [];
      for (const match of findUrls(logical.text)) {
        const start = offsetToPosition(logical, match.start);
        const end = offsetToPosition(logical, match.end - 1);
        // Only surface the link on rows it actually covers — xterm asks per row.
        if (bufferLineNumber < start.y || bufferLineNumber > end.y) continue;
        links.push({
          range: { start, end },
          // `text` is what xterm hands to activate(); the full URL, not the row
          // fragment. A caller using the default handler is correct too.
          text: match.url,
          activate: (event) => options.onActivate(match.url, event),
          hover: options.onHover ? () => options.onHover!(match.url) : undefined,
          leave: options.onLeave ? () => options.onLeave!(match.url) : undefined,
        });
      }

      callback(links.length ? links : undefined);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// URL collection (the mobile "URL tray")
// ─────────────────────────────────────────────────────────────────────────────

export interface UrlCollectorOptions {
  /** Most recent URLs to retain. */
  limit?: number;
  /** How many trailing buffer rows to rescan per sweep. */
  scanRows?: number;
  /** Debounce for rescans, ms. */
  debounceMs?: number;
}

export interface UrlCollector {
  /** Most-recent-last, deduped. */
  urls(): string[];
  /** Rescan now (used by tests and by an explicit refresh button). */
  scan(): string[];
  subscribe(listener: (urls: string[]) => void): () => void;
  /** Call on every terminal write; coalesced internally. */
  notify(): void;
  dispose(): void;
}

/**
 * Track URLs seen in recent terminal output so a phone user can tap one from a
 * list instead of trying to hit a 4-row link target with a thumb.
 *
 * This is not a nicety: even with the link provider fixed, tapping a link inside
 * a scrolling terminal on a touch screen competes with selection and scrolling.
 * The tray is the reliable path; the link is the convenient one.
 */
export function createUrlCollector(
  term: TerminalLike,
  options: UrlCollectorOptions = {},
): UrlCollector {
  const limit = options.limit ?? 25;
  const scanRows = options.scanRows ?? 400;
  const debounceMs = options.debounceMs ?? 250;

  const seen: string[] = [];
  const listeners = new Set<(urls: string[]) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function emit(): void {
    const snapshot = seen.slice();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        /* a bad listener must not stop the others */
      }
    }
  }

  function scan(): string[] {
    const buf = term.buffer.active;
    const end = buf.length;
    const start = Math.max(0, end - scanRows);
    let changed = false;

    let y = start;
    while (y < end) {
      const logical = readLogicalLine(term, y);
      const consumed = Math.max(1, logical.rowCount);
      if (logical.text) {
        for (const match of findUrls(logical.text)) {
          const existing = seen.indexOf(match.url);
          if (existing !== -1) {
            // Move to most-recent without duplicating.
            if (existing !== seen.length - 1) {
              seen.splice(existing, 1);
              seen.push(match.url);
              changed = true;
            }
            continue;
          }
          seen.push(match.url);
          changed = true;
        }
      }
      y += consumed;
    }

    while (seen.length > limit) {
      seen.shift();
      changed = true;
    }

    if (changed) emit();
    return seen.slice();
  }

  return {
    urls: () => seen.slice(),
    scan,
    subscribe(listener) {
      listeners.add(listener);
      listener(seen.slice());
      return () => listeners.delete(listener);
    },
    notify() {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!disposed) scan();
      }, debounceMs);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      listeners.clear();
    },
  };
}
