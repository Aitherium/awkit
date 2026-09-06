/**
 * Standalone (no-React) terminal mount — the AitherTunnel portal's entry point.
 * ============================================================================
 *
 * `tunnel_portal.py` renders its HTML from Python and cannot host React, so this
 * module wraps {@link createTerminalController} in a small vanilla UI and is
 * bundled to a single IIFE (`scripts/build-terminal-bundle.mjs` ->
 * `AitherOS/services/mesh/static/aither-terminal.js`) exposing
 * `window.AitherTerminal.mount(...)`.
 *
 * The UI it adds over a bare xterm is the mobile story:
 *   - a URL TRAY: every URL seen in recent output, as a tappable full-width row
 *     with Open and Copy. On a phone this is the reliable way to follow a login
 *     link; hitting a 5-row link target with a thumb, inside a scrolling
 *     terminal that also owns touch for selection, is not.
 *   - a KEY BAR: Esc/Tab/Ctrl/arrows/pipe/slash/tilde — keys no phone keyboard
 *     offers, without which the shell is read-only in practice.
 *   - a STATUS line that distinguishes reconnecting from dead.
 */

import { createTerminalController, JSON_PROTOCOL, type TerminalController, type TerminalDeps, type TerminalStatus } from './controller';

export interface StandaloneMountOptions {
  /** Container element or its id. */
  target: HTMLElement | string;
  /** WebSocket URL factory (re-evaluated on every reconnect). */
  socketUrl(): string;
  deps: TerminalDeps;
  banner?: string[];
  showKeyBar?: boolean;
  showUrlTray?: boolean;
  /**
   * True when the endpoint attaches a real PTY. AitherTunnel only does so for a
   * container or mesh target; its default "Tunnel Shell" runs whole commands, so
   * that mode needs local echo and LF->CRLF, and a key bar there is meaningless
   * (there is no PTY to receive an escape sequence).
   */
  pty?: boolean;
  onStatusChange?(status: TerminalStatus): void;
}

const STYLE_ID = 'aither-terminal-styles';

const STYLES = `
.at-root{display:flex;flex-direction:column;height:100%;min-height:0;background:#060a12;}
.at-term{flex:1 1 auto;min-height:0;position:relative;}
.at-term .xterm{height:100%!important;}
.at-status{display:flex;align-items:center;gap:6px;padding:4px 10px;font:500 11px/1.4 ui-monospace,monospace;
  color:#94a3b8;background:rgba(15,23,42,.8);border-top:1px solid rgba(148,163,184,.14);flex:0 0 auto;}
.at-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:0 0 auto;}
.at-status[data-s="connected"]{color:#34d399;}
.at-status[data-s="connecting"],.at-status[data-s="reconnecting"]{color:#fbbf24;}
.at-status[data-s="error"],.at-status[data-s="disconnected"]{color:#f87171;}
.at-status .at-spacer{margin-left:auto;}
.at-status button{background:rgba(148,163,184,.12);border:0;color:inherit;font:inherit;
  padding:3px 9px;border-radius:6px;cursor:pointer;min-height:28px;}
.at-status button:active{background:rgba(148,163,184,.26);}

/* ── URL tray ─────────────────────────────────────────────────────────────── */
.at-urls{flex:0 0 auto;background:rgba(9,14,26,.96);border-top:1px solid rgba(99,102,241,.28);
  max-height:38vh;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.at-urls[hidden]{display:none;}
.at-urls-head{display:flex;align-items:center;gap:8px;padding:7px 10px;position:sticky;top:0;
  background:rgba(9,14,26,.98);font:600 11px/1 ui-monospace,monospace;color:#a5b4fc;
  border-bottom:1px solid rgba(99,102,241,.18);}
.at-urls-head .at-spacer{margin-left:auto;}
.at-urls-head button{background:none;border:0;color:#64748b;font:inherit;cursor:pointer;
  padding:4px 8px;min-height:28px;}
.at-url{display:flex;align-items:center;gap:8px;padding:8px 10px;
  border-bottom:1px solid rgba(148,163,184,.08);}
.at-url:last-child{border-bottom:0;}
.at-url-text{flex:1 1 auto;min-width:0;font:400 11px/1.35 ui-monospace,monospace;color:#cbd5e1;
  word-break:break-all;overflow-wrap:anywhere;}
.at-url-actions{display:flex;gap:6px;flex:0 0 auto;}
.at-url-actions button{background:rgba(99,102,241,.18);border:0;border-radius:7px;color:#c7d2fe;
  font:600 11px/1 ui-monospace,monospace;padding:0 10px;min-height:34px;min-width:44px;cursor:pointer;}
.at-url-actions button.at-copy{background:rgba(148,163,184,.14);color:#cbd5e1;}
.at-url-actions button:active{filter:brightness(1.35);}

/* ── Key bar ──────────────────────────────────────────────────────────────── */
.at-keys{flex:0 0 auto;display:flex;gap:6px;padding:7px 8px;overflow-x:auto;
  -webkit-overflow-scrolling:touch;scrollbar-width:none;
  background:rgba(15,23,42,.94);border-top:1px solid rgba(148,163,184,.14);}
.at-keys::-webkit-scrollbar{display:none;}
.at-keys[hidden]{display:none;}
.at-keys button{flex:0 0 auto;background:rgba(148,163,184,.13);border:0;border-radius:8px;
  color:#e2e8f0;font:600 12px/1 ui-monospace,monospace;
  /* 44px is the accessible touch target floor; the old bar used 24px buttons. */
  min-height:44px;min-width:44px;padding:0 12px;cursor:pointer;}
.at-keys button:active{background:rgba(148,163,184,.3);}
.at-keys button[aria-pressed="true"]{background:#6366f1;color:#fff;}
`;

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

const KEY_BAR: Array<{ label: string; key: string; sticky?: boolean }> = [
  { label: 'Esc', key: 'Escape' },
  { label: 'Tab', key: 'Tab' },
  { label: 'Ctrl', key: 'Control', sticky: true },
  { label: '^C', key: 'Control-c' },
  { label: '^D', key: 'Control-d' },
  { label: '↑', key: 'ArrowUp' },
  { label: '↓', key: 'ArrowDown' },
  { label: '←', key: 'ArrowLeft' },
  { label: '→', key: 'ArrowRight' },
  { label: '|', key: '|' },
  { label: '/', key: '/' },
  { label: '-', key: '-' },
  { label: '~', key: '~' },
  { label: '"', key: '"' },
];

const STATUS_LABEL: Record<TerminalStatus, string> = {
  connecting: 'connecting…',
  connected: 'connected',
  reconnecting: 'reconnecting…',
  disconnected: 'disconnected',
  error: 'error',
};

export interface StandaloneHandle extends TerminalController {
  /** The root element created by mount(); remove it to fully tear down. */
  root: HTMLElement;
}

export function mount(options: StandaloneMountOptions): StandaloneHandle {
  ensureStyles();

  const host =
    typeof options.target === 'string'
      ? document.getElementById(options.target)
      : options.target;
  if (!host) throw new Error(`AitherTerminal.mount: target not found (${String(options.target)})`);

  const isTouch =
    typeof window !== 'undefined' &&
    (('ontouchstart' in window) || (navigator as any).maxTouchPoints > 0);
  const pty = options.pty ?? true;
  const showKeyBar = options.showKeyBar ?? (isTouch && pty);
  const showUrlTray = options.showUrlTray ?? true;

  host.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'at-root';

  const termEl = document.createElement('div');
  termEl.className = 'at-term';
  root.appendChild(termEl);

  // URL tray
  const tray = document.createElement('div');
  tray.className = 'at-urls';
  tray.hidden = true;
  const trayHead = document.createElement('div');
  trayHead.className = 'at-urls-head';
  const trayTitle = document.createElement('span');
  trayTitle.textContent = '🔗 Links in output';
  const traySpacer = document.createElement('span');
  traySpacer.className = 'at-spacer';
  const trayToggle = document.createElement('button');
  trayToggle.type = 'button';
  trayToggle.textContent = 'hide';
  trayHead.append(trayTitle, traySpacer, trayToggle);
  const trayList = document.createElement('div');
  tray.append(trayHead, trayList);
  if (showUrlTray) root.appendChild(tray);

  // Key bar
  const keys = document.createElement('div');
  keys.className = 'at-keys';
  keys.hidden = !showKeyBar;
  if (showKeyBar) root.appendChild(keys);

  // Status
  const status = document.createElement('div');
  status.className = 'at-status';
  status.dataset.s = 'connecting';
  const dot = document.createElement('span');
  dot.className = 'at-dot';
  const statusText = document.createElement('span');
  statusText.textContent = STATUS_LABEL.connecting;
  const statusSpacer = document.createElement('span');
  statusSpacer.className = 'at-spacer';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear';
  const reconnectBtn = document.createElement('button');
  reconnectBtn.type = 'button';
  reconnectBtn.textContent = 'Reconnect';
  status.append(dot, statusText, statusSpacer, clearBtn, reconnectBtn);
  root.appendChild(status);

  host.appendChild(root);

  let trayCollapsed = false;
  let lastUrls: string[] = [];

  function renderTray(urls: string[]): void {
    lastUrls = urls;
    if (!showUrlTray) return;
    if (!urls.length) {
      tray.hidden = true;
      return;
    }
    tray.hidden = false;
    trayToggle.textContent = trayCollapsed ? `show (${urls.length})` : 'hide';
    trayList.hidden = trayCollapsed;
    if (trayCollapsed) return;

    trayList.innerHTML = '';
    // Most recent first — that is the link the user is looking for.
    for (const url of urls.slice().reverse()) {
      const row = document.createElement('div');
      row.className = 'at-url';

      const text = document.createElement('span');
      text.className = 'at-url-text';
      text.textContent = url;

      const actions = document.createElement('span');
      actions.className = 'at-url-actions';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.textContent = 'Open';
      openBtn.setAttribute('aria-label', `Open ${url}`);
      openBtn.addEventListener('click', () => controller.openUrl(url));

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'at-copy';
      copyBtn.textContent = 'Copy';
      copyBtn.setAttribute('aria-label', `Copy ${url}`);
      copyBtn.addEventListener('click', () => {
        controller.copyUrl(url);
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
      });

      actions.append(openBtn, copyBtn);
      row.append(text, actions);
      trayList.appendChild(row);
    }
  }

  trayToggle.addEventListener('click', () => {
    trayCollapsed = !trayCollapsed;
    renderTray(lastUrls);
  });

  const controller = createTerminalController({
    element: termEl,
    deps: options.deps,
    protocol: JSON_PROTOCOL,
    banner: options.banner,
    lineBuffered: !pty,
    convertOutputEol: !pty,
    createSocket: () => new WebSocket(options.socketUrl()),
    onUrlsChange: renderTray,
    onStatusChange: (s) => {
      status.dataset.s = s;
      statusText.textContent = STATUS_LABEL[s];
      options.onStatusChange?.(s);
    },
  });

  clearBtn.addEventListener('click', () => {
    controller.clear();
    controller.focus();
  });
  reconnectBtn.addEventListener('click', () => controller.reconnect());

  if (showKeyBar) {
    for (const spec of KEY_BAR) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = spec.label;
      if (spec.sticky) btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (spec.sticky) {
          const active = controller.toggleCtrl();
          btn.setAttribute('aria-pressed', active ? 'true' : 'false');
          controller.focus();
          return;
        }
        controller.sendKey(spec.key);
        const ctrlBtn = keys.querySelector('button[aria-pressed="true"]');
        if (ctrlBtn) ctrlBtn.setAttribute('aria-pressed', 'false');
      });
      keys.appendChild(btn);
    }
  }

  return Object.assign(controller, { root });
}

export { createTerminalController, JSON_PROTOCOL };
export * from './wrapped-links';
