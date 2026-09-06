/**
 * Framework-free terminal controller.
 * ===================================
 *
 * One implementation, three consumers:
 *   - the Python-rendered AitherTunnel portal (via the standalone IIFE bundle,
 *     which is why this file must not import React or any DOM framework),
 *   - Veil's <WebTerminal /> React wrapper,
 *   - anything else that needs a browser terminal.
 *
 * It owns the parts that were previously copy-pasted (and drifting) between
 * `tunnel_portal.py`'s inline JS and three separate Veil components: xterm setup,
 * fit-on-resize, reconnect with backoff, OSC 52 clipboard, the mobile key bar,
 * and — the reason this consolidation happened — tmux-aware wrapped-URL links.
 */

import {
  createUrlCollector,
  createWrappedLinkProvider,
  type TerminalLike,
  type UrlCollector,
} from './wrapped-links';

export type TerminalStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface TerminalDeps {
  /** `new Terminal(...)` from @xterm/xterm (or xterm@5 via CDN). */
  Terminal: new (options?: Record<string, unknown>) => any;
  /** FitAddon constructor. */
  FitAddon: new () => any;
}

export interface TerminalControllerOptions {
  /** Element the terminal mounts into. */
  element: HTMLElement;
  /** xterm + fit addon, injected so this module never bundles them. */
  deps: TerminalDeps;
  /** Build the WebSocket for a (re)connection attempt. */
  createSocket(): WebSocket;
  /**
   * Wire protocol. Defaults match AitherTunnel and Veil's /api/terminal:
   * JSON frames `{type:'input'|'output'|'resize'|'ping'|'exit', ...}`.
   */
  protocol?: TerminalProtocol;
  /** Extra xterm options merged over the defaults. */
  terminalOptions?: Record<string, unknown>;
  onStatusChange?(status: TerminalStatus, detail?: string): void;
  /** Called whenever the tracked URL list changes. */
  onUrlsChange?(urls: string[]): void;
  /** Open a URL. Defaults to window.open(url, '_blank', 'noopener'). */
  openUrl?(url: string): void;
  /** Copy text. Defaults to navigator.clipboard with a prompt() fallback. */
  copyText?(text: string): void | Promise<void>;
  /** Max reconnect attempts before giving up. 0 disables reconnect. */
  maxReconnectAttempts?: number;
  /** Banner lines written before the first connect. */
  banner?: string[];
  /**
   * Non-PTY endpoints (AitherTunnel's default "Tunnel Shell" executes whole
   * commands rather than attaching a PTY) need the client to echo keystrokes and
   * only transmit on Enter. Leave false for any real shell — echoing there
   * double-prints every character.
   */
  lineBuffered?: boolean;
  /**
   * Translate bare LF to CRLF on output. Required for non-PTY endpoints, whose
   * output is ordinary process stdout rather than PTY-cooked bytes; without it
   * every line staircases down the screen.
   */
  convertOutputEol?: boolean;
}

export type DecodedFrame =
  | { kind: 'output'; data: string }
  | { kind: 'exit'; code?: number }
  | null;

export interface TerminalProtocol {
  encodeInput(data: string): string;
  encodeResize(cols: number, rows: number): string;
  encodePing(): string;
  /** Return the text to write, or null to ignore the frame. */
  decode(raw: string): DecodedFrame;
}

export const JSON_PROTOCOL: TerminalProtocol = {
  encodeInput: (data) => JSON.stringify({ type: 'input', data }),
  encodeResize: (cols, rows) => JSON.stringify({ type: 'resize', cols, rows }),
  encodePing: () => JSON.stringify({ type: 'ping' }),
  decode: (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (!msg) return null;
      if (msg.type === 'ping' || msg.type === 'pong') return null;
      if (msg.type === 'output') return { kind: 'output', data: String(msg.data ?? '') };
      if (msg.type === 'exit') return { kind: 'exit', code: msg.code };
      // AitherTunnel's handshake and error frames. These were previously dropped
      // by any consumer that only knew 'output', which is how an auth failure
      // ("Terminal access denied") showed up as a terminal that just sat blank.
      if (msg.type === 'connected') {
        return { kind: 'output', data: `\x1b[32m${msg.message ?? 'connected'}\x1b[0m\r\n` };
      }
      if (msg.error) return { kind: 'output', data: `\x1b[31mError: ${msg.error}\x1b[0m\r\n` };
      if (typeof msg.data === 'string') return { kind: 'output', data: msg.data };
      return null;
    } catch {
      // Not JSON — treat as raw PTY bytes.
      return { kind: 'output', data: raw };
    }
  },
};

export interface TerminalController {
  readonly term: any;
  readonly status: TerminalStatus;
  urls(): string[];
  focus(): void;
  fit(): void;
  clear(): void;
  /** Send a literal string as user input. */
  send(text: string): void;
  /** Send a named key (Escape, Tab, ArrowUp, Control-c, …). */
  sendKey(key: string): void;
  /** Toggle the sticky Ctrl modifier used by the mobile key bar. */
  toggleCtrl(): boolean;
  ctrlActive(): boolean;
  openUrl(url: string): void;
  copyUrl(url: string): void;
  reconnect(): void;
  dispose(): void;
}

const KEY_SEQUENCES: Record<string, string> = {
  Escape: '\x1b',
  Tab: '\t',
  Enter: '\r',
  Backspace: '\x7f',
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
  'Control-c': '\x03',
  'Control-d': '\x04',
  'Control-z': '\x1a',
  'Control-l': '\x0c',
  'Control-r': '\x12',
};

function defaultOpenUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function defaultCopyText(text: string): void {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav && nav.clipboard && nav.clipboard.writeText) {
    nav.clipboard.writeText(text).catch(() => {
      window.prompt('Copy this URL:', text);
    });
    return;
  }
  window.prompt('Copy this URL:', text);
}

export function createTerminalController(options: TerminalControllerOptions): TerminalController {
  const protocol = options.protocol ?? JSON_PROTOCOL;
  const openUrl = options.openUrl ?? defaultOpenUrl;
  const copyText = options.copyText ?? defaultCopyText;
  const maxReconnect = options.maxReconnectAttempts ?? 8;

  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const fontSize = isNarrow ? 12 : typeof window !== 'undefined' && window.innerWidth < 900 ? 13 : 14;

  const term = new options.deps.Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize,
    lineHeight: 1.2,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace",
    scrollback: 10000,
    // A phone keyboard emits composition events; xterm needs this to not eat them.
    macOptionIsMeta: true,
    theme: {
      background: '#060a12',
      foreground: '#e2e8f0',
      cursor: '#b4a0e5',
      selectionBackground: '#6366f140',
      black: '#1e293b', red: '#ef4444', green: '#10b981', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#a855f7', cyan: '#22d3ee', white: '#e2e8f0',
      brightBlack: '#475569', brightRed: '#f87171', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#c084fc',
      brightCyan: '#67e8f9', brightWhite: '#f8fafc',
    },
    ...(options.terminalOptions ?? {}),
  });

  const fitAddon = new options.deps.FitAddon();
  term.loadAddon(fitAddon);

  // ── The fix: a tmux-aware link provider, INSTEAD of WebLinksAddon ──────────
  // Loading both would double-underline every link and race on activate().
  term.registerLinkProvider(
    createWrappedLinkProvider(term as TerminalLike, {
      onActivate: (url) => openUrl(url),
    }),
  );

  // ── OSC 52 clipboard ──────────────────────────────────────────────────────
  // Programs that support it (and tmux, which forwards it by default for
  // xterm* terminals) can put text on the clipboard directly.
  try {
    term.parser?.registerOscHandler?.(52, (data: string) => {
      try {
        const sep = data.indexOf(';');
        const b64 = sep >= 0 ? data.slice(sep + 1) : data;
        if (b64 && b64 !== '?') {
          const binary = window.atob(b64);
          const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
          const text = new TextDecoder().decode(bytes);
          void copyText(text);
          term.writeln('\r\n\x1b[38;2;16;185;129m✓ Copied to clipboard\x1b[0m');
        }
      } catch {
        /* malformed OSC 52 — ignore, never break the stream */
      }
      return true;
    });
  } catch {
    /* parser API unavailable on this xterm build — non-fatal */
  }

  term.open(options.element);
  try {
    fitAddon.fit();
  } catch {
    /* element not laid out yet; the ResizeObserver below will fit */
  }

  const collector: UrlCollector = createUrlCollector(term as TerminalLike);
  if (options.onUrlsChange) collector.subscribe(options.onUrlsChange);

  let status: TerminalStatus = 'connecting';
  let ws: WebSocket | null = null;
  let manualClose = false;
  let disposed = false;
  let reconnectAttempts = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let ctrlActive = false;

  function setStatus(next: TerminalStatus, detail?: string): void {
    status = next;
    options.onStatusChange?.(next, detail);
  }

  function sendResize(): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(protocol.encodeResize(term.cols, term.rows));
      } catch {
        /* socket closed between the check and the send */
      }
    }
  }

  function fit(): void {
    try {
      fitAddon.fit();
      sendResize();
    } catch {
      /* not laid out */
    }
  }

  function connect(): void {
    if (disposed) return;
    manualClose = false;
    setStatus(reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    let socket: WebSocket;
    try {
      socket = options.createSocket();
    } catch (err) {
      setStatus('error', err instanceof Error ? err.message : String(err));
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.onopen = () => {
      reconnectAttempts = 0;
      setStatus('connected');
      sendResize();
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(protocol.encodePing());
          } catch {
            /* closing */
          }
        }
      }, 25000);
    };

    socket.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      const decoded = protocol.decode(raw);
      if (!decoded) return;
      if (decoded.kind === 'output') {
        term.write(options.convertOutputEol ? decoded.data.replace(/\r?\n/g, '\r\n') : decoded.data);
        collector.notify();
      } else {
        term.writeln(`\r\n\x1b[33m⟡ Session ended (code ${decoded.code ?? '?'})\x1b[0m`);
      }
    };

    socket.onerror = () => {
      setStatus('error', 'connection error');
    };

    socket.onclose = () => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (disposed || manualClose) {
        setStatus('disconnected');
        return;
      }
      scheduleReconnect();
    };
  }

  function scheduleReconnect(): void {
    if (disposed || maxReconnect <= 0) {
      setStatus('disconnected');
      return;
    }
    if (reconnectAttempts >= maxReconnect) {
      term.writeln('\r\n\x1b[31m✗ Disconnected. Tap Reconnect to retry.\x1b[0m');
      setStatus('disconnected');
      return;
    }
    reconnectAttempts++;
    // The shell lives in tmux server-side, so reconnecting re-attaches the SAME
    // session — an in-flight `claude` login survives a dropped phone connection.
    const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 15000);
    setStatus('reconnecting', `attempt ${reconnectAttempts}`);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delay);
  }

  function socketSend(frame: string): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(frame);
      return true;
    } catch {
      return false;
    }
  }

  // Line-buffered input state (non-PTY endpoints only).
  let inputBuffer = '';

  term.onData((data: string) => {
    if (!options.lineBuffered) {
      socketSend(protocol.encodeInput(data));
      return;
    }
    if (data === '\r' || data === '\n') {
      term.write('\r\n');
      socketSend(protocol.encodeInput(inputBuffer));
      inputBuffer = '';
    } else if (data === '\x7f') {
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        term.write('\b \b');
      }
    } else {
      inputBuffer += data;
      term.write(data);
    }
  });

  const resizeObserver =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => fit())
      : null;
  resizeObserver?.observe(options.element);

  const onWindowResize = () => fit();
  window.addEventListener('resize', onWindowResize);

  // Mobile: a tap anywhere in the terminal must restore the soft keyboard.
  const onTouchEnd = () => term.focus();
  if (isNarrow) options.element.addEventListener('touchend', onTouchEnd, { passive: true });

  for (const line of options.banner ?? []) term.writeln(line);
  connect();

  /**
   * Transmit input to the remote shell.
   *
   * NOTE the bug this replaces: the tunnel portal's key bar called
   * `term.write(...)`, which paints a character into the LOCAL display buffer
   * and sends nothing. Esc, Tab, the arrows and ^C therefore did nothing at all
   * on mobile for as long as that toolbar has existed — the buttons rendered,
   * responded to taps, and were inert.
   */
  function sendRaw(text: string): void {
    socketSend(protocol.encodeInput(text));
  }

  return {
    term,
    get status() {
      return status;
    },
    urls: () => collector.urls(),
    focus: () => term.focus(),
    fit,
    clear: () => term.clear(),
    send: sendRaw,
    sendKey(key: string) {
      const seq = KEY_SEQUENCES[key];
      if (seq) {
        sendRaw(seq);
      } else if (ctrlActive && key.length === 1) {
        const code = key.toUpperCase().charCodeAt(0) - 64;
        if (code > 0 && code < 32) sendRaw(String.fromCharCode(code));
      } else {
        sendRaw(key);
      }
      if (ctrlActive) ctrlActive = false;
      term.focus();
    },
    toggleCtrl() {
      ctrlActive = !ctrlActive;
      return ctrlActive;
    },
    ctrlActive: () => ctrlActive,
    openUrl,
    copyUrl: (url: string) => {
      void copyText(url);
    },
    reconnect() {
      manualClose = true;
      reconnectAttempts = 0;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      }
      ws = null;
      connect();
    },
    dispose() {
      disposed = true;
      manualClose = true;
      if (pingTimer) clearInterval(pingTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      collector.dispose();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      options.element.removeEventListener('touchend', onTouchEnd);
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
      try {
        term.dispose();
      } catch {
        /* already disposed */
      }
    },
  };
}
