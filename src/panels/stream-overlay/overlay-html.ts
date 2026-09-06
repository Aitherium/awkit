/**
 * The TBAT-style tug-of-war donation overlay, as a string.
 *
 * WHY A .ts AND NOT AN .html ASSET. awkit publishes `files: ["dist/","src/"]`
 * and builds with tsc, which does not copy .html -- so an asset here would ship
 * in src/ and be ABSENT from dist/, i.e. present for this monorepo and missing
 * for every consumer importing the built package. awkit has already been bitten
 * by exactly that (its `cp src/*.css dist/` silenced by `|| true`, failing on
 * every Windows build while the build reported success). A module compiles, so
 * the compiler carries it and there is no asset-copy step to fail.
 *
 * It is also the SINGLE copy: the panel renders it, the test evaluates it, and
 * both the tenant overlay emitter and the direct publisher extract it. A
 * generated twin beside a hand-edited original is the drift this codebase keeps
 * paying for.
 *
 * Serve it (OBS browser source), or render it in an iframe via `srcDoc` and
 * drive it with postMessage:
 *
 *     iframe.contentWindow.postMessage(
 *       { type: "donation", payload: { id, amount_cents, message } }, "*")
 *     iframe.contentWindow.postMessage({ type: "reset" }, "*")        // new guest
 *     iframe.contentWindow.postMessage(
 *       { type: "setgoal", goal_cents: 50000 }, "*")                  // host sets the goal
 */
export const TUGOFWAR_OVERLAY_HTML = `<!--
  TBAT Tug-of-War donation overlay -- a single self-contained OBS browser source.

  THE MECHANIC (confirmed with the show, 2026-08-28):
  - The host sets an initial KICK goal (default $100).
  - Donations carrying "kick" fill the POT toward that goal.
  - Donations carrying "keep" RAISE the goal -- keepers are goalkeepers, and
    the two forces tug: kick pulls the line right, keep pushes it back.
  - When the pot meets the goal the guest is KICKED -- but every guest is
    guaranteed a minimum airtime (default 2 minutes). If the goal is met during
    the guarantee, the kick is PENDING: the timer counts it down and keep
    donations can still raise the goal and SAVE the guest.
  - Kicks are favoured on purpose (cycle people through the show): the kick
    splash auto-advances to the next guest with a fresh goal.

  WHY ONE FILE. An OBS browser source loads a URL and runs it in a bare
  Chromium. No build step, no server, no npm install: the operator pastes a path
  or URL and it works, on stream, at 2am, with no developer present. Derrick
  raised nodecg, which is the right answer for a MULTI-graphic control-room
  setup and is a real dependency to take on; this reads its state from the same
  event shape, so it can be wrapped as a nodecg bundle later without rewriting
  the graphic.

  Never trusts the page it is embedded in: every incoming event is validated,
  amounts are integer cents, and unknown fields are ignored.

  Query parameters (all optional):
    ?demo=1              synthesise donations so it can be shown with no feed
    &goal=10000          initial KICK goal in cents (default 10000 = $100)
    &guarantee=120       guaranteed airtime in seconds (default 120 = 2 min)
    &big=2500            cents at/above which a donation pops (default 2500 = $25)
    &left=kick&right=keep    the two keywords
    &ws=wss://host/path  a WebSocket emitting the event shape below
    &poll=https://host/x  polled every 5s, returns {events:[...]}
-->
<meta charset="utf-8">
<title>TBAT Tug of War</title>
<style>
  /* Transparent by design: OBS composites this over the scene. */
  /* color-scheme MATTERS here and is not cosmetic. A transparent html/body is
     not sufficient: the browser still paints the frame's BASE CANVAS, and under
     the default light scheme that base is WHITE. Measured in a real Chromium on
     the published page -- html and body both computed rgba(0,0,0,0) while the
     embedding surface rendered a solid white card, and declaring the dark scheme
     made the backdrop show through. Every computed style said transparent while
     the pixels said white, so only looking at it found this.
     NOTE: no backticks in this file -- it lives inside a TS template literal. */
  html, body { margin: 0; padding: 0; background: transparent; color-scheme: dark; overflow: hidden; }

  /* TBAT FLIER PALETTE. Their social fliers are four colours and no gradients:
     flag red, Old Glory blue, white, black -- heavy uppercase, hard edges,
     white keylines. The overlay previously used a warm orange (#ff6b4a) and a
     pale cyan (#4ab8ff) with a two-stop gradient, which reads as generic
     stream-tech and does not sit next to their artwork.

     Old Glory Blue (#002868) is the flier value and is too dark to read as a
     BAR FILL on a black overlay, so the blue is split: --blue for large flat
     areas, --blue-ink for type, which sits on black with a white keyline. Do
     not collapse them -- the type value fails contrast as a fill and the fill
     value disappears as type. */
  :root {
    --red:      #CE1126;   /* flag red */
    --red-ink:  #FF2537;   /* same hue, lifted for type on black */
    --blue:     #002868;   /* Old Glory blue */
    --blue-ink: #3D6DFF;   /* lifted for type on black */
    --ink:      #000;
    --paper:    #fff;
  }
  body {
    font-family: "Inter", "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    color: var(--paper);
  }
  #wrap { position: relative; width: 100vw; padding: 18px 24px 0; box-sizing: border-box; }

  .heads { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px; }
  .side { display: flex; flex-direction: column; line-height: 1; }
  .side.right { align-items: flex-end; }
  .label {
    font-size: 34px; font-weight: 900; letter-spacing: -.01em; text-transform: uppercase;
    /* A hard black keyline, not a soft drop shadow. Flier type is cut out of
       the background rather than floating above it, and a blurred shadow is
       the single biggest tell that this is a stream widget and not artwork. */
    -webkit-text-stroke: 2px var(--ink);
    paint-order: stroke fill;
    text-shadow: 0 2px 0 var(--ink);
  }
  .total {
    font-size: 26px; font-weight: 900; letter-spacing: -.02em; opacity: 1;
    color: var(--paper);
    -webkit-text-stroke: 2px var(--ink);
    paint-order: stroke fill;
    text-shadow: 0 2px 0 var(--ink);
  }
  .l { color: var(--red-ink); }
  .r { color: var(--blue-ink); }

  /* The bar. The RED fill is the kick pot's progress toward the goal; the blue
     field behind it is the gap that remains. The white knot rides the fill's
     leading edge -- kick donations push it right, keep donations (which raise
     the goal) push it back left. When it reaches the right edge the fill is
     full, the bar pulses, and the guest is gone. A single fill whose width IS
     the ratio, so there is no way for the two halves to disagree about the
     score. */
  #bar {
    /* Square, not a pill, and a solid white keyline rather than a translucent
       inset -- the flier vocabulary is blocks and rules. */
    position: relative; height: 38px; border-radius: 0; overflow: hidden;
    background: var(--blue);
    border: 3px solid var(--paper);
    box-shadow: 0 4px 0 var(--ink);
  }
  #bar.pending { animation: pulse 0.8s infinite; }
  #fill {
    position: absolute; inset: 0 auto 0 0; width: 0%;
    background: var(--red);
    transition: width .8s cubic-bezier(.22,.61,.36,1);
  }
  /* Centre rope marker -- where the line currently stands. */
  #knot {
    position: absolute; top: -5px; bottom: -5px; width: 6px; left: 0%;
    margin-left: -3px; background: var(--paper); border-radius: 0;
    box-shadow: 0 0 0 2px var(--ink);
    transition: left .8s cubic-bezier(.22,.61,.36,1);
  }

  .footer { display: flex; justify-content: center; margin-top: 10px; }
  #timer {
    font-size: 22px; font-weight: 900; letter-spacing: .06em;
    padding: 6px 18px; border-radius: 0;
    background: var(--ink); border: 3px solid var(--paper);
    text-shadow: none;
  }
  /* Window about to open, or a kick pending: the moment is near, pulse it. */
  #timer.soon, #timer.kick { background: var(--red); animation: pulse 1s infinite; }
  @keyframes pulse { 50% { opacity: .55; } }

  /* Big-donation pops. Positioned per side, animated out and removed. */
  .pop {
    position: absolute; top: 78px; font-size: 50px; font-weight: 900;
    letter-spacing: -.02em;
    -webkit-text-stroke: 3px var(--ink); paint-order: stroke fill;
    text-shadow: 0 3px 0 var(--ink); pointer-events: none;
    animation: rise 2.6s ease-out forwards;
  }
  .pop.left  { left: 24px; }
  .pop.right { right: 24px; }
  @keyframes rise {
    0%   { opacity: 0; transform: translateY(14px) scale(.7); }
    16%  { opacity: 1; transform: translateY(0)    scale(1.12); }
    28%  { transform: translateY(0) scale(1); }
    100% { opacity: 0; transform: translateY(-58px) scale(1); }
  }

  /* The kick moment. Covers the widget for a few seconds while the board
     underneath resets for the next guest. */
  #splash {
    position: absolute; inset: 0; z-index: 10;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; background: rgba(0,0,0,.82);
  }
  #splash[hidden] { display: none; }
  .splash-title {
    font-size: 96px; font-weight: 900; letter-spacing: -.02em; line-height: 1;
    color: var(--red-ink); text-transform: uppercase;
    -webkit-text-stroke: 4px var(--ink); paint-order: stroke fill;
    text-shadow: 0 4px 0 var(--ink);
  }
  .splash-sub {
    font-size: 26px; font-weight: 800; letter-spacing: .02em;
    color: var(--paper);
    -webkit-text-stroke: 2px var(--ink); paint-order: stroke fill;
  }

  /* A pending kick averted by keep: the goalkeepers saved the guest. */
  #saved {
    position: absolute; top: 150px; left: 50%; transform: translateX(-50%);
    font-size: 34px; font-weight: 900; letter-spacing: .04em; text-transform: uppercase;
    color: var(--ink); background: var(--paper); border: 3px solid var(--ink);
    padding: 8px 22px; z-index: 11; animation: saved-pop 1.5s ease-out forwards;
  }
  #saved[hidden] { display: none; }
  @keyframes saved-pop {
    0%   { opacity: 0; transform: translateX(-50%) scale(.8); }
    18%  { opacity: 1; transform: translateX(-50%) scale(1.08); }
    30%  { transform: translateX(-50%) scale(1); }
    100% { opacity: 0; transform: translateX(-50%) scale(1); }
  }

  #status { position: absolute; top: 4px; right: 24px; font-size: 12px; opacity: .5; }
</style>

<div id="wrap">
  <div class="heads">
    <div class="side left">
      <span class="label l" id="lLabel">KICK</span>
      <span class="total l" id="lTotal">$0</span>
    </div>
    <div class="side right">
      <span class="label r" id="rLabel">KEEP</span>
      <span class="total r" id="rTotal">GOAL $100</span>
    </div>
  </div>
  <div id="bar"><div id="fill"></div><div id="knot"></div></div>
  <div class="footer"><span id="timer">WINDOW 2:00</span></div>
  <span id="status"></span>
  <div id="splash" hidden></div>
  <div id="saved" hidden></div>
</div>

<script>
(() => {
  "use strict";
  const qs = new URLSearchParams(location.search);
  const CFG = {
    left:      (qs.get("left")  || "kick").toLowerCase(),
    right:     (qs.get("right") || "keep").toLowerCase(),
    goal:      Math.max(100, parseInt(qs.get("goal") || "10000", 10) || 10000),
    guarantee: Math.max(10, parseInt(qs.get("guarantee") || "120", 10) || 120),
    big:       Math.max(1, parseInt(qs.get("big") || "2500", 10) || 2500),
    demo:      qs.get("demo") === "1",
  };
  /* THEME -- swappable per org, no rebuild.
     The palette ships as TBAT's flier colours because that is who runs it
     today, but the overlay is a product and the next org will not be red/blue.
     A preset covers the common case (?theme=tbat) and four hex overrides cover
     the rest (?red=%23CE1126&blue=%23002868&red-ink=...&blue-ink=...).

     Values are validated as #rrggbb and DISCARDED otherwise. That is not
     tidiness: these land in setProperty, so an unvalidated value from the query
     string is a CSS injection into a page anyone can hand someone a link to.

     --red/--blue are large flat areas; --red-ink/--blue-ink are the same hues
     lifted for TYPE on black. They are separate on purpose -- Old Glory blue
     (#002868) is unreadable as type on this overlay -- so a preset must give
     all four rather than deriving two from two. */
  const THEMES = {
    tbat:   { red: "#CE1126", redInk: "#FF2537", blue: "#002868", blueInk: "#3D6DFF" },
    /* The pre-TBAT palette, kept as a named preset rather than deleted so a
       swap back is a query param instead of a revert. */
    aither: { red: "#FF5330", redInk: "#FF6B4A", blue: "#12518A", blueInk: "#4AB8FF" },
    mono:   { red: "#8A8A8A", redInk: "#D8D8D8", blue: "#2E2E2E", blueInk: "#9A9AA5" },
  };
  const hex6 = (v) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
  const theme = Object.assign({}, THEMES[(qs.get("theme") || "tbat").toLowerCase()] || THEMES.tbat);
  [["red", "red"], ["redInk", "red-ink"], ["blue", "blue"], ["blueInk", "blue-ink"]]
    .forEach(([key, param]) => { const v = hex6(qs.get(param)); if (v) theme[key] = v; });
  try {
    const rs = document.documentElement.style;
    rs.setProperty("--red", theme.red);
    rs.setProperty("--red-ink", theme.redInk);
    rs.setProperty("--blue", theme.blue);
    rs.setProperty("--blue-ink", theme.blueInk);
  } catch (_e) { /* no CSSOM (test harness) -- the stylesheet defaults stand */ }

  document.getElementById("lLabel").textContent = CFG.left.toUpperCase();
  document.getElementById("rLabel").textContent = CFG.right.toUpperCase();

  // The clock is a mutable holder so tests can freeze time; production never
  // rebinds it.
  const clock = { now: () => Date.now() };

  // All amounts are integer CENTS. Floats drift, and a tug-of-war whose score
  // is 0.1+0.2 away from the truth is the kind of bug nobody finds on stream.
  const GUARANTEE_MS = CFG.guarantee * 1000;
  const state = {
    pot: 0,                 // kick cents raised toward the goal
    goal: CFG.goal,         // the threshold; keep donations raise it
    guestStart: clock.now(), // when the current guest came on
    kickPending: null,       // ms timestamp when a pending kick fires, or null
    guest: 1,                // guests cycled through (kick or manual reset)
    kicked: 0,               // guests actually kicked
    seen: new Set(),
  };

  const money = (cents) => {
    const d = cents / 100;
    return "$" + d.toLocaleString("en-US", {
      minimumFractionDigits: d % 1 ? 2 : 0, maximumFractionDigits: 2,
    });
  };

  // Word-boundary match, so "kickoff" and "keepsake" do NOT score. A donor who
  // typed a real word should not be dragged onto a side they did not pick, and
  // a substring match is how that happens.
  const sideOf = (text) => {
    const t = String(text || "").toLowerCase();
    const hit = (w) => new RegExp("(^|[^a-z0-9])" + w + "([^a-z0-9]|$)", "i").test(t);
    const l = hit(CFG.left), r = hit(CFG.right);
    if (l && !r) return "left";
    if (r && !l) return "right";
    return null;   // neither, or BOTH -- ambiguous is not a vote
  };

  function render() {
    // The fill IS the ratio: kick money over the current goal. Keep donations
    // shrink it (the goal grew); kick donations grow it. Cap at 100 -- a pot
    // past the goal is a pending kick, not an overflowing bar.
    const pct = state.goal > 0 ? Math.min(100, (state.pot / state.goal) * 100) : 100;
    document.getElementById("fill").style.width = pct + "%";
    document.getElementById("knot").style.left = pct + "%";
    document.getElementById("lTotal").textContent = money(state.pot);
    document.getElementById("rTotal").textContent = "GOAL " + money(state.goal);
    document.getElementById("bar").classList.toggle("pending", !!state.kickPending);
  }

  function pop(side, cents) {
    const el = document.createElement("div");
    /* Carry the SAME .l/.r class the labels use, so the pop colour is defined
       in exactly one place. The first version of this set el.style.color from
       getComputedStyle -- which reintroduced the hardcoded pair one layer down
       AND used a DOM API the test harness does not stub, so it threw on the
       first big donation. A class needs no runtime lookup and cannot drift. */
    el.className = "pop " + side + " " + (side === "left" ? "l" : "r");
    el.textContent = money(cents);
    document.getElementById("wrap").appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  /** A fresh guest: pot back to zero, goal back to the base, guarantee restarts. */
  function resetGuest() {
    state.pot = 0;
    state.goal = CFG.goal;
    state.guestStart = clock.now();
    state.kickPending = null;
    state.guest += 1;
    render();
  }

  /** The kick itself. State resets for the next guest immediately; the splash
      is presentation on top, and donations that arrive during it count toward
      the NEXT guest -- cycling is what the show wants. */
  function kickNow() {
    const raised = state.pot;
    state.kicked += 1;
    resetGuest();
    splash("KICKED!", money(raised) + " raised to kick · guest " + state.guest + " next");
  }

  /**
   * The mechanic's heart. Called after every donation and every timer tick:
   * - a pending kick that no longer has the pot at/over the goal is SAVED
   *   (a keep donation raised the goal past it);
   * - the pot meeting the goal before the guarantee ends becomes PENDING --
   *   the guest is guaranteed their airtime, and the countdown is the drama;
   * - the pot meeting the goal after the guarantee is an immediate kick.
   */
  function evaluate() {
    const now = clock.now();
    if (state.kickPending) {
      if (now >= state.kickPending) { kickNow(); return; }
      if (state.pot >= state.goal) return;      // still pending
      state.kickPending = null;                  // goalkeepers saved them
      flashSaved();
      render();
    } else if (state.pot >= state.goal) {
      if (now < state.guestStart + GUARANTEE_MS) {
        state.kickPending = state.guestStart + GUARANTEE_MS;
        render();
      } else {
        kickNow();
      }
    }
  }

  /**
   * Accept one donation event.
   *   { id?, amount_cents | amount, message | comment | note }
   * \`amount\` is accepted as DOLLARS for convenience and converted; amount_cents
   * always wins when both are present.
   * Returns true when it scored, so a caller can tell "ignored" from "counted".
   */
  function ingest(ev) {
    if (!ev || typeof ev !== "object") return false;
    // Idempotent by id: a reconnecting socket or an overlapping poll will
    // re-deliver, and double-counting a $500 donation is unrecoverable on air.
    const id = ev.id != null ? String(ev.id) : null;
    if (id) { if (state.seen.has(id)) return false; state.seen.add(id); }

    let cents = Number.isFinite(ev.amount_cents) ? Math.round(ev.amount_cents)
              : Number.isFinite(ev.amount)       ? Math.round(ev.amount * 100)
              : NaN;
    if (!Number.isFinite(cents) || cents <= 0) return false;

    const side = sideOf(ev.message ?? ev.comment ?? ev.note ?? "");
    if (!side) return false;          // no keyword: still a donation, not a vote

    if (side === "left") state.pot += cents;   // kick: fill the pot
    else state.goal += cents;                  // keep: raise the goal

    render();
    if (cents >= CFG.big) pop(side, cents);
    evaluate();
    return true;
  }

  // ---- kick / saved presentation -------------------------------------------
  let splashTimer = null, savedTimer = null;
  function splash(title, sub) {
    const el = document.getElementById("splash");
    el.textContent = "";
    const t = document.createElement("div");
    t.className = "splash-title";
    t.textContent = title;
    const s = document.createElement("div");
    s.className = "splash-sub";
    s.textContent = sub;
    el.appendChild(t);
    el.appendChild(s);
    el.hidden = false;
    clearTimeout(splashTimer);
    splashTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }
  function flashSaved() {
    const el = document.getElementById("saved");
    el.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { el.hidden = true; }, 1500);
  }

  // ---- timer ---------------------------------------------------------------
  // Three modes, each the answer to "when is the next decision point?":
  //   WINDOW m:ss  -- countdown of the guest's guaranteed airtime; when it
  //                   reaches zero the kick window is open.
  //   KICK m:ss    -- a kick is PENDING; this counts down to the moment the
  //                   guest is gone, and keep can still save them.
  //   ON AIR m:ss  -- the window is open and nothing is pending; this is how
  //                   long the guest has survived.
  function mmss(sec) {
    const s = Math.max(0, Math.floor(sec));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }
  function tick() {
    const now = clock.now();
    const el = document.getElementById("timer");
    if (state.kickPending) {
      if (now >= state.kickPending) { kickNow(); return; }
      el.textContent = "KICK " + mmss((state.kickPending - now) / 1000);
      el.className = "kick";
      return;
    }
    const end = state.guestStart + GUARANTEE_MS;
    if (now < end) {
      el.textContent = "WINDOW " + mmss((end - now) / 1000);
      el.className = (end - now <= 30000) ? "soon" : "";
    } else {
      el.textContent = "ON AIR " + mmss((now - state.guestStart) / 1000);
      el.className = "";
    }
  }
  setInterval(tick, 250); tick();

  // ---- inputs ------------------------------------------------------------
  // 1) postMessage, so a host page (or nodecg bundle) can drive it directly.
  // The handler is a named function so the control panel can be TESTED through
  // the same door the overlay opens on the live stream -- and so a nodecg
  // wrapper can drive it without touching this file.
  function handleMessage(d, source) {
    if (!d || typeof d !== "object") return;
    if (d.type === "donation") ingest(d.payload ?? d);
    if (d.type === "reset") resetGuest();                 // operator: new guest on
    if (d.type === "clear") {                             // operator: fresh board,
      state.pot = 0;                                       // SAME guest -- totals
      state.goal = CFG.goal;                               // and window start over,
      state.guestStart = clock.now();                      // the guest counter does
      state.kickPending = null;                            // not move.
      render();
    }
    if (d.type === "window") {                            // operator: restart the
      state.guestStart = clock.now();                      // guaranteed airtime for
      evaluate();                                          // the CURRENT guest (a
      render();                                            // pending kick re-arms at
    }                                                      // the new window's end).
    if (d.type === "setgoal") {                           // operator: set the goal
      const g = Number.isFinite(d.goal_cents) ? Math.round(d.goal_cents)
              : Number.isFinite(d.goal)       ? Math.round(d.goal)
              : NaN;
      if (Number.isFinite(g) && g > 0) {
        state.goal = g;
        evaluate();                                        // may cancel a pending kick
        render();
      }
    }
    if (d.type === "snapshot") {                          // control panel: a live
      if (source && typeof source.postMessage === "function") {
        source.postMessage({ type: "snapshot", payload: {
          pot: state.pot, goal: state.goal,
          guest: state.guest, kicked: state.kicked,
          kickPending: state.kickPending,
          guestStart: state.guestStart, now: clock.now(),
          // The guarantee is CONFIG, and the control room's timer readout
          // must derive from the same value the overlay enforces -- a
          // hardcoded twin in the control page silently disagrees the moment
          // the operator sets a 30s guarantee.
          guarantee: GUARANTEE_MS,
        } }, "*");
      }
    }
  }
  addEventListener("message", (e) => handleMessage(e.data, e.source));

  // 2) WebSocket, 3) polling. Both optional; failures are shown, never silent.
  const status = (t) => {
    const counters = "guest " + state.guest + " · kicked " + state.kicked;
    document.getElementById("status").textContent = t ? counters + " · " + t : counters;
  };
  const wsUrl = qs.get("ws");
  if (wsUrl) {
    (function connect() {
      let ws;
      try { ws = new WebSocket(wsUrl); } catch { status("ws: bad url"); return; }
      ws.onopen    = () => status("");
      // handleMessage, NOT ingest: ingest() takes a donation, while
      // handleMessage() dispatches reset/clear/window/setgoal too. Routing the
      // socket at ingest silently DROPPED every operator control on the OBS
      // copy -- the one thing the relay exists to carry. The postMessage path
      // above has always used handleMessage; these two disagreed.
      // A null source: a socket message comes from no window.
      ws.onmessage = (m) => { try { handleMessage(JSON.parse(m.data), null); } catch {} };
      // Reconnect: a stream runs for hours and a socket WILL drop. Silent
      // disconnection would freeze the bar while looking perfectly fine.
      ws.onclose   = () => { status("ws: reconnecting"); setTimeout(connect, 3000); };
      ws.onerror   = () => status("ws: error");
    })();
  }
  const pollUrl = qs.get("poll");
  if (pollUrl) {
    setInterval(async () => {
      try {
        const r = await fetch(pollUrl, { cache: "no-store" });
        if (!r.ok) { status("poll: HTTP " + r.status); return; }
        const d = await r.json();
        (Array.isArray(d) ? d : d.events || []).forEach(ingest);
        status("");
      } catch { status("poll: unreachable"); }
    }, 5000);
  }

  // 4) demo -- so this can be shown to a room with no donation platform wired.
  // Kicks are weighted 65/35 on purpose: the show favours kicking, and a demo
  // that never produces a kick cannot show the mechanic it exists to sell.
  if (CFG.demo) {
    let n = 0;
    setInterval(() => {
      const word = Math.random() < 0.65 ? CFG.left : CFG.right;
      const cents = Math.random() < 0.12
        ? (Math.floor(Math.random() * 300) + 100) * 100   // $100-$400 pops
        : (Math.floor(Math.random() * 45) + 5) * 100;     // $5-$50
      ingest({ id: "demo-" + (n++), amount_cents: cents, message: "go " + word + "!" });
    }, 1300);
    status("demo");
  }

  render();
  status("");
  // Exposed for tests and for a nodecg wrapper; not used by the graphic itself.
  window.__tbat = { ingest, sideOf, state, CFG, evaluate, kickNow, resetGuest, clock, handleMessage };
})();
</script>
`;


/**
 * A demo STAGE for the overlay: a dark backdrop standing in for the stream, the
 * real overlay in an iframe above it, and buttons that post the same events a
 * donation feed would.
 *
 * The overlay is transparent by design, so on its own in a browser it looks like
 * nothing -- which makes it impossible to show anyone. This is what you open to
 * demonstrate it.
 *
 * It EMBEDS overlay.html rather than reimplementing it. A demo that
 * reimplements the thing it demonstrates agrees with itself and disagrees with
 * what ships.
 */
export const TUGOFWAR_DEMO_HTML = `<!--
  CONTROL ROOM for the tug-of-war donation overlay (also the demo stage).

  The OVERLAY (overlay.html) is transparent by design: in a browser, on its
  own, it looks like nothing -- it is an OBS browser source that composites
  over the stream. THIS page is where a human runs the show: the same overlay
  in an iframe above a stand-in stream scene, every operator control, a live
  state readout, the segment config, and the exact OBS URL to paste.

  It embeds \`overlay.html\` rather than reimplementing it, and drives it with
  the SAME postMessage events a donation feed would -- a page that reimplements
  the graphic agrees with itself and disagrees with air.

  OBS SYNC: the copy of the overlay inside OBS is a separate process, so page
  buttons cannot reach it directly. Both instances can share one WebSocket
  relay: point the OBS overlay at \`?ws=wss://relay\`, put the same URL in the
  relay box here, and every control action (donations included) is broadcast
  to the relay as well as to the local preview.

  THE KIT: everything this page needs to run the show -- overlay, control
  room, relay, README -- is downloadable as one kit.zip next to these pages,
  so the operator can run the whole thing off a USB stick with zero connection
  to the platform. The zip is built by the EMITTER from these same bytes; a
  zip that disagreed with the pages it ships would be the drift this file
  exists to prevent.
-->
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tug of War — control room</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; background: #0d0d10; color: #e8e8ee; min-height: 100vh;
    font-family: "Inter", "Segoe UI", system-ui, sans-serif;
  }
  header { padding: 28px 24px 12px; max-width: 1100px; margin: 0 auto; }
  h1 { margin: 0 0 6px; font-size: 24px; font-weight: 800; letter-spacing: -.01em; }
  .sub { margin: 0; font-size: 14px; opacity: .68; line-height: 1.5; max-width: 76ch; }
  main { max-width: 1100px; margin: 0 auto; padding: 0 24px 40px; }

  /* The "stream": a scene the transparent overlay composites onto. */
  .stage {
    position: relative; margin: 20px 0 12px; border-radius: 12px; overflow: hidden;
    aspect-ratio: 16 / 6;
    background:
      radial-gradient(120% 90% at 20% 10%, #24304a 0%, transparent 60%),
      radial-gradient(120% 90% at 85% 20%, #3a2036 0%, transparent 55%),
      #14161d;
    border: 1px solid rgba(255,255,255,.09);
  }
  .stage::after {
    content: "stream"; position: absolute; right: 12px; bottom: 10px;
    font-size: 11px; letter-spacing: .18em; text-transform: uppercase; opacity: .25;
  }
  iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }

  .live {
    display: flex; gap: 18px; flex-wrap: wrap; align-items: center;
    font-size: 13px; padding: 8px 12px; margin-bottom: 12px;
    background: rgba(255,255,255,.05); border-radius: 8px;
    border: 1px solid rgba(255,255,255,.08);
  }
  .live strong.kick { color: #FF2537; }
  .live strong.keep { color: #3D6DFF; }
  .live strong.danger { color: #FF2537; }

  .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
  button, input, select {
    font: inherit; font-size: 14px; padding: 8px 14px; border-radius: 8px; cursor: pointer;
    border: 1px solid rgba(255,255,255,.16); background: #1b1e27; color: #e8e8ee;
  }
  input, select { cursor: text; width: 96px; }
  input[type="number"] { width: 84px; }
  button:hover { background: #232734; }
  button.l { border-color: #CE1126; }
  button.r { border-color: #3D6DFF; }
  button.ghost { opacity: .75; }
  fieldset {
    margin-top: 14px; padding: 12px 14px; border-radius: 8px;
    border: 1px solid rgba(255,255,255,.1);
  }
  legend { font-size: 12px; opacity: .7; padding: 0 6px; }
  .note {
    margin-top: 14px; padding: 14px 16px; border-radius: 10px; font-size: 13px;
    line-height: 1.6; background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08);
  }
  code { background: rgba(255,255,255,.09); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  a { color: #7fc4ff; }
</style>

<header>
  <h1>Tug of War — control room</h1>
  <p class="sub">
    KICK donations fill the pot toward the goal; KEEP donations raise the goal — the
    goalkeepers push the line back. When the pot meets the goal the guest is kicked,
    never before their guaranteed minimum airtime (keep can still save them during the
    countdown). The kick cycles to the next guest with a fresh goal. A donation of $25
    or more pops its amount on the side it backed.
  </p>
</header>

<main>
  <div class="stage">
    <iframe id="ov" title="Overlay preview" src="overlay.html?goal=5000&amp;guarantee=30"></iframe>
  </div>

  <div class="live" id="live">
    <span>POT <strong class="kick" id="livePot">$0</strong></span>
    <span>GOAL <strong class="keep" id="liveGoal">$50</strong></span>
    <span>TIMER <strong id="liveTimer">—</strong></span>
    <span>GUEST <strong id="liveGuest">1</strong></span>
    <span>KICKED <strong id="liveKicked">0</strong></span>
  </div>

  <div class="controls">
    <button class="l" data-side="kick" data-amt="5">+$5 kick</button>
    <button class="l" data-side="kick" data-amt="25">+$25 kick</button>
    <button class="l" data-side="kick" data-amt="250">+$250 kick</button>
    <button class="r" data-side="keep" data-amt="5">+$5 keep</button>
    <button class="r" data-side="keep" data-amt="25">+$25 keep</button>
    <button class="r" data-side="keep" data-amt="250">+$250 keep</button>
    <button class="ghost" id="ambiguous">$50 "kick or keep?"</button>
  </div>

  <div class="row">
    <button class="ghost" id="clear">Reset board</button>
    <button class="ghost" id="restart">Restart timer</button>
    <button class="ghost" id="newguest">New guest</button>
    <input id="goalAmt" type="number" min="1" placeholder="goal $" value="100">
    <button class="ghost" id="setgoal">Set goal</button>
    <button class="ghost" id="demo">Auto feed</button>
  </div>

  <div class="row">
    <input id="manualAmt" type="number" min="0.01" step="0.01" placeholder="amount $">
    <select id="manualSide">
      <option value="kick">kick (fills the pot)</option>
      <option value="keep">keep (raises the goal)</option>
    </select>
    <button id="manualAdd">Add donation</button>
  </div>

  <fieldset>
    <legend>Segment settings — rebuilds the preview, exactly as OBS would load it</legend>
    <div class="row">
      <label>Kick goal $ <input id="cfgGoal" type="number" min="1" value="100"></label>
      <label>Guarantee s <input id="cfgGuarantee" type="number" min="10" value="120"></label>
      <label>Pop $ <input id="cfgBig" type="number" min="1" value="25"></label>
      <button class="ghost" id="applyCfg">Apply</button>
    </div>
  </fieldset>

  <fieldset>
    <legend>OBS browser source (1920×1080, transparent)</legend>
    <div class="row">
      <code id="obs" style="flex:1; white-space:nowrap; overflow-x:auto;"></code>
      <button id="copyObs">Copy</button>
    </div>
    <div class="row">
      <label>Relay ws:// (optional — drives the OBS copy too)
        <input id="relay" type="text" placeholder="ws://localhost:8787" style="width:260px;"></label>
      <a href="relay.js" download style="font-size:13px;">Get the relay (relay.js)</a>
      <span style="opacity:.45;">·</span>
      <a href="kit.zip" download style="font-size:13px;">Download the whole kit (kit.zip — runs with no platform)</a>
    </div>
  </fieldset>

  <div class="note">
    <strong>For OBS:</strong> add a Browser Source pointing at <code id="obs2"></code>.
    The overlay accepts <code>?goal=</code> (cents), <code>&amp;guarantee=</code> (seconds),
    <code>&amp;big=</code> (cents), <code>&amp;left=</code>/<code>&amp;right=</code> (keywords),
    and <code>&amp;ws=</code> or <code>&amp;poll=</code> for a live donation feed.
    To make OBS follow this page's buttons, run a tiny WebSocket relay, put its URL in the
    relay box here, and add <code>&amp;ws=</code> with the same URL to the OBS overlay.
  </div>
</main>

<script>
  const ov = document.getElementById("ov");
  let n = 0;

  // Every action goes to the preview AND, when a relay is set, to the relay —
  // so the OBS copy of the overlay (connected with ?ws=) follows the buttons.
  let relay = null;
  function broadcast(msg) {
    ov.contentWindow.postMessage(msg, "*");
    if (relay && relay.readyState === WebSocket.OPEN) {
      relay.send(JSON.stringify(msg));
    }
  }
  const relayInput = document.getElementById("relay");
  relayInput.addEventListener("change", () => {
    const url = relayInput.value.trim();
    if (relay) { try { relay.close(); } catch {} relay = null; }
    if (url) {
      try { relay = new WebSocket(url); } catch { relay = null; }
    }
    refreshObs();   // the OBS URL carries &ws= from this box
  });

  const send = (amountDollars, word) => broadcast({
    type: "donation",
    payload: { id: "manual-" + (n++), amount_cents: Math.round(amountDollars * 100), message: "go " + word + "!" },
  });

  document.querySelectorAll("button[data-side]").forEach((b) => {
    b.addEventListener("click", () => send(Number(b.dataset.amt), b.dataset.side));
  });
  // Shows the ambiguous case honestly: it lands as a donation, not as a vote,
  // so the bar must NOT move.
  document.getElementById("ambiguous").addEventListener("click", () => broadcast({
    type: "donation",
    payload: { id: "manual-" + (n++), amount_cents: 5000, message: "kick or keep?" },
  }));
  document.getElementById("clear").addEventListener("click", () => broadcast({ type: "clear" }));
  document.getElementById("restart").addEventListener("click", () => broadcast({ type: "window" }));
  document.getElementById("newguest").addEventListener("click", () => broadcast({ type: "reset" }));
  document.getElementById("setgoal").addEventListener("click", () => {
    const v = Number(document.getElementById("goalAmt").value);
    if (Number.isFinite(v) && v > 0) broadcast({ type: "setgoal", goal_cents: Math.round(v * 100) });
  });
  document.getElementById("manualAdd").addEventListener("click", () => {
    const v = Number(document.getElementById("manualAmt").value);
    const side = document.getElementById("manualSide").value;
    if (Number.isFinite(v) && v > 0) send(v, side);
  });
  document.getElementById("demo").addEventListener("click", () => {
    ov.src = "overlay.html?demo=1&goal=5000&guarantee=30";
  });
  document.getElementById("applyCfg").addEventListener("click", () => {
    const g = Math.max(1, Number(document.getElementById("cfgGoal").value) || 100);
    const t = Math.max(10, Number(document.getElementById("cfgGuarantee").value) || 120);
    const b = Math.max(1, Number(document.getElementById("cfgBig").value) || 25);
    ov.src = "overlay.html?goal=" + (g * 100) + "&guarantee=" + t + "&big=" + (b * 100);
    refreshObs();
  });

  function refreshObs() {
    // The OBS URL carries the operator's config AND the relay — the whole
    // show in one paste. When the relay serves this page (node relay.js),
    // location resolves to http://127.0.0.1:8787/overlay.html — a normal
    // http URL OBS handles with query params guaranteed.
    const g = Math.max(1, Number(document.getElementById("cfgGoal").value) || 100);
    const t = Math.max(10, Number(document.getElementById("cfgGuarantee").value) || 120);
    const b = Math.max(1, Number(document.getElementById("cfgBig").value) || 25);
    const relayUrl = document.getElementById("relay").value.trim();
    let url = new URL("overlay.html", location.href).href;
    url += "?goal=" + (g * 100) + "&guarantee=" + t + "&big=" + (b * 100);
    if (relayUrl) url += "&ws=" + encodeURIComponent(relayUrl);
    document.getElementById("obs").textContent = url;
    document.getElementById("obs2").textContent = url;
  }
  document.getElementById("copyObs").addEventListener("click", () => {
    navigator.clipboard && navigator.clipboard.writeText(document.getElementById("obs").textContent);
  });

  // Live readout: the overlay answers a snapshot request with its own state —
  // the same numbers the preview (and OBS, on the same feed) is showing.
  function mmss(sec) {
    const s = Math.max(0, Math.floor(sec));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.type !== "snapshot" || !d.payload) return;
    const p = d.payload;
    document.getElementById("livePot").textContent = "$" + (p.pot / 100).toFixed(p.pot % 100 ? 2 : 0);
    document.getElementById("liveGoal").textContent = "$" + (p.goal / 100).toFixed(p.goal % 100 ? 2 : 0);
    document.getElementById("liveGuest").textContent = String(p.guest);
    document.getElementById("liveKicked").textContent = String(p.kicked);
    const el = document.getElementById("liveTimer");
    const guarantee = p.guarantee || 120000;   // snapshot carries it; the fallback
                                               // only covers an old overlay in a cache
    if (p.kickPending) {
      const left = Math.max(0, Math.ceil((p.kickPending - p.now) / 1000));
      el.textContent = "KICK " + mmss(left);
      el.className = "danger";
    } else if (p.now < p.guestStart + guarantee) {
      el.textContent = "WINDOW " + mmss((p.guestStart + guarantee - p.now) / 1000);
      el.className = "";
    } else {
      el.textContent = "ON AIR " + mmss((p.now - p.guestStart) / 1000);
      el.className = "";
    }
  });
  setInterval(() => ov.contentWindow.postMessage({ type: "snapshot" }, "*"), 1000);

  refreshObs();
</script>
<script>
  // Version badge from manifest.json (written beside this page by the emitter).
  // A screenshot of the control room then names the build. Silent when absent.
  (function () {
    fetch("manifest.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((m) => {
      if (!m || !m.version) return;
      const b = document.createElement("div");
      b.textContent = "kit v" + m.version;
      b.title = "built from " + m.source_commit + " — paste this version when reporting a problem";
      b.style.cssText = "position:fixed;right:10px;bottom:8px;font:11px/1.4 system-ui,sans-serif;opacity:.55;"
        + "padding:2px 8px;border-radius:6px;background:rgba(0,0,0,.4);color:#fff;z-index:9999";
      document.body.appendChild(b);
    }).catch(() => {});
  })();
</script>
`;


/**
 * The tiny WebSocket relay that lets the CONTROL ROOM drive the OBS copy of
 * the overlay. Two instances of the overlay are separate processes — OBS's
 * embedded Chromium cannot receive this page's postMessage — so both connect
 * to one relay: the control room broadcasts every action to it (relay box),
 * the OBS overlay reads it (?ws=), and donations entered on either side reach
 * both graphics.
 *
 * Served at /tugofwar/relay.js so the operator downloads it from the same
 * URL as the control room. Zero dependencies — the RFC6455 server half is
 * ~120 lines here, deliberately. A dependency (the `ws` package) would make
 * "run this on the streaming rig" a setup step, and setup steps are how a
 * 2am show starts without the relay.
 *
 *   node relay.js            # port 8787 (ws://localhost:8787)
 *   node relay.js 9001       # another port
 *   node relay.js --selftest # two clients, handshake + broadcast, exit 0/1
 *
 * NO backticks and NO ${ in this file: it lives inside a TS template literal
 * and the extractors that serve it refuse interpolated literals.
 */
export const TUGOFWAR_RELAY_JS = `#!/usr/bin/env node
/**
 * tugofwar_relay.js — WebSocket relay for the tug-of-war donation overlay.
 *
 * The control room (tugofwar/) and the OBS copy of the overlay
 * (tugofwar/overlay.html) are separate processes; a browser page cannot
 * postMessage into OBS's embedded Chromium. This relay bridges them:
 *
 *   1. Control room: put ws://localhost:8787 in the relay box.
 *   2. OBS overlay:  append &ws=ws://localhost:8787 to the overlay URL.
 *
 * Every control action (donations included) then reaches both graphics, so
 * the operator drives the copy that is actually on air.
 *
 * Zero dependencies on purpose — it is a raw RFC6455 server (~120 lines).
 * Messages are small JSON text frames; anything larger than 65535 bytes is
 * refused loudly rather than half-broadcast.
 *
 * Usage:
 *   node tugofwar_relay.js [port]     (default 8787)
 *   node tugofwar_relay.js --selftest (two clients, proves the broadcast)
 */
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const CLIENTS = new Set();

function acceptKey(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}

function encodeTextFrame(payload) {
  const b = Buffer.from(payload, "utf8");
  if (b.length > 65535) throw new Error("frame too large: " + b.length);
  const head = [0x81];                                  // FIN + text opcode
  if (b.length < 126) {
    head.push(b.length);
  } else {
    head.push(126, (b.length >> 8) & 0xff, b.length & 0xff);
  }
  return Buffer.concat([Buffer.from(head), b]);
}

/** Parse one client frame off the head of buf; null when incomplete. */
function tryParseFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const op = buf[0] & 0x0f;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    off = 10;
  }
  if (len > 65535) return { err: "frame too large: " + len };
  if ((buf[1] & 0x80) === 0) return { err: "client frames must be masked" };
  if (buf.length < off + 4 + len) return null;
  const mask = buf.slice(off, off + 4);
  off += 4;
  const payload = Buffer.alloc(len);
  for (let i = 0; i < len; i++) payload[i] = buf[off + i] ^ mask[i & 3];
  return { fin, op, payload, consumed: off + len };
}

/** The kit manifest (version, source commit, per-file sha256) written beside
 *  relay.js by the emitter. Null when absent -- an unversioned/hand-copied kit.
 *  The version is printed on every start so a customer's paste or screenshot
 *  identifies the exact build: the 2026-09-01 "spins forever" report could not
 *  be tied to a build for an hour because nothing in the kit said which it was. */
function kitManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[1]), "manifest.json"), "utf8"));
  } catch (e) {
    return null;
  }
}

/** Serve the kit pages over plain HTTP — one command runs the whole show.
 *  "node relay.js" then gives the operator the control room AND the overlay
 *  AND the websocket on one port: OBS points at a normal http URL (query
 *  params guaranteed, no file:// quirks), the control room is a browser tab.
 *  Files are read from the relay's own directory, so the unzipped kit IS the
 *  server. */
function serveHttp(socket, req) {
  const g = req.match(/^GET (\\S+) HTTP/i);
  const reqPath = g ? g[1].split("?")[0] : "/";
  const FILES = {
    "/": "control-room.html",
    "/index.html": "control-room.html",
    "/control-room.html": "control-room.html",
    "/overlay.html": "overlay.html",
    "/relay.js": process.argv[1],
    "/kit.zip": "kit.zip",
    "/manifest.json": "manifest.json",
    "/kit.zip.sha256": "kit.zip.sha256",
  };
  const name = FILES[reqPath];
  const fail = (code) => socket.end("HTTP/1.1 " + code + "\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n");
  if (!name) { fail("404 Not Found"); return; }
  const file = name === process.argv[1] ? process.argv[1]
             : path.join(path.dirname(process.argv[1]), name);
  fs.readFile(file, (err, data) => {
    if (err) { fail("404 Not Found"); return; }
    const ct = name.endsWith(".html") ? "text/html; charset=utf-8"
             : name.endsWith(".js") ? "application/javascript"
             : name.endsWith(".zip") ? "application/zip"
             : name.endsWith(".json") ? "application/json; charset=utf-8"
             : name.endsWith(".sha256") ? "text/plain; charset=utf-8"
             : "application/octet-stream";
    const head = Buffer.from("HTTP/1.1 200 OK\\r\\nContent-Type: " + ct
               + "\\r\\nContent-Length: " + data.length
               + "\\r\\nConnection: close\\r\\n\\r\\n", "latin1");
    socket.end(Buffer.concat([head, data]));
  });
}

function handle(socket) {
  let buf = Buffer.alloc(0);
  let partial = "";                                     // fragmented text frame
  let open = false;

  function sendText(text) {
    if (!socket.destroyed) socket.write(encodeTextFrame(text));
  }
  function broadcast(text, except) {
    // Encode ONCE, and encode AT ALL. Writing raw text into a WebSocket is a
    // protocol violation: the browser answers it by CLOSING the socket, which
    // the overlay surfaces as "ws: reconnecting" on a 3s loop forever.
    // sendText() has always encoded; this path never did, so every control-room
    // message killed the OBS socket instead of driving it. Customer-reported
    // 2026-09-02 -- and the relay --selftest passed throughout, because it
    // asserted a SUBSTRING over raw bytes, which a raw-text write satisfies.
    const frame = encodeTextFrame(text);
    for (const c of CLIENTS) if (c !== except && !c.destroyed) c.write(frame);
  }

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (!open) {
      const i = buf.indexOf("\\r\\n\\r\\n");
      if (i < 0) return;
      const req = buf.slice(0, i).toString("utf8");
      buf = buf.slice(i + 4);
      const m = req.match(/Sec-WebSocket-Key: ([^\\r\\n]+)/i);
      if (!m) { serveHttp(socket, req); return; }
      socket.write(
        "HTTP/1.1 101 Switching Protocols\\r\\n" +
        "Upgrade: websocket\\r\\nConnection: Upgrade\\r\\n" +
        "Sec-WebSocket-Accept: " + acceptKey(m[1].trim()) + "\\r\\n\\r\\n");
      open = true;
      CLIENTS.add(socket);
      return;
    }
    for (;;) {
      const f = tryParseFrame(buf);
      if (!f) break;
      if (f.err) { socket.destroy(); return; }
      buf = buf.slice(f.consumed);
      if (f.op === 0x1) {                               // text (or start)
        partial = f.payload.toString("utf8");
        if (f.fin) { broadcast(partial, socket); partial = ""; }
      } else if (f.op === 0x0) {                        // continuation
        partial += f.payload.toString("utf8");
        if (f.fin) { broadcast(partial, socket); partial = ""; }
      } else if (f.op === 0x8) {                        // close
        socket.end();
        return;
      } else if (f.op === 0x9) {                        // ping -> pong
        socket.write(Buffer.concat([Buffer.from([0x8a]), Buffer.from([f.payload.length]), f.payload]));
      }
    }
  });
  socket.on("close", () => CLIENTS.delete(socket));
  socket.on("error", () => CLIENTS.delete(socket));
}

function serve(port) {
  const server = net.createServer(handle);
  server.listen(port, "127.0.0.1", () => {
    // Announce the BOUND port, not the requested one: "node relay.js 0"
    // (or a busy 8787 fallback) would otherwise print a URL that does not
    // connect. Measured 2026-09-01 -- the offline-kit test caught it.
    const actual = server.address().port;
    const mf = kitManifest();
    const ver = mf && mf.version
      ? "v" + mf.version + " (" + String(mf.source_commit || "").slice(0, 10) + ")"
      : "(unversioned kit -- no manifest.json beside relay.js)";
    console.log("tugofwar relay " + ver + " on ws://127.0.0.1:" + actual);
    console.log("  control room:            http://127.0.0.1:" + actual + "/");
    console.log("  OBS overlay URL:         http://127.0.0.1:" + actual + "/overlay.html");
    console.log("  control room relay box:  ws://127.0.0.1:" + actual);
  });
  server.on("error", (e) => { console.error("relay: " + e.message); process.exit(1); });
  return server;
}

// ---- self-test: two real sockets, real handshake, real broadcast ----------
function selftest() {
  const server = net.createServer(handle);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    const keyA = "aGVsbG8gd29ybGQ=", keyB = "c29tZS1yYW5kb20ta2V5";
    const BIG = "x".repeat(150);                        // exercises the 126-length path
    const mask = Buffer.from([1, 2, 3, 4]);
    function masked(payload) {
      const b = Buffer.from(payload, "utf8");
      const head = b.length < 126 ? [0x81, 0x80 | b.length]
        : [0x81, 0x80 | 126, (b.length >> 8) & 0xff, b.length & 0xff];
      const out = Buffer.alloc(head.length + 4 + b.length);
      head.forEach((v, i) => { out[i] = v; });
      mask.copy(out, head.length);
      for (let i = 0; i < b.length; i++) out[head.length + 4 + i] = b[i] ^ mask[i & 3];
      return out;
    }
    const a = net.connect(port, "127.0.0.1");
    const b = net.connect(port, "127.0.0.1");
    const fail = (why) => { console.error("SELF-TEST FAIL: " + why); process.exit(1); };
    let handshaken = false;
    let buf = Buffer.alloc(0);
    const got = [];
    // Decode frames the way a BROWSER does. The previous assertion was
    // body.includes("hello") -- a SUBSTRING over raw wire bytes, which a correct
    // frame and an unencoded raw-text write satisfy EQUALLY. So it could not
    // distinguish the 2026-09-02 broadcast defect from its fix: it stayed green
    // while every real client closed the socket on a protocol violation, and a
    // customer became the detector. Parse, and refuse anything that is not a
    // well-formed unmasked text frame.
    function drain() {
      for (;;) {
        if (buf.length < 2) return;
        if ((buf[0] & 0x80) === 0 || (buf[0] & 0x0f) !== 1) {
          fail("not a FIN text frame -- first byte 0x" + buf[0].toString(16) +
               " (an unencoded raw-text write looks exactly like this)");
          return;
        }
        if (buf[1] & 0x80) { fail("a server-to-client frame must not be masked"); return; }
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { fail("unexpected 64-bit length in this test"); return; }
        if (buf.length < off + len) return;
        got.push(buf.slice(off, off + len).toString("utf8"));
        buf = buf.slice(off + len);
      }
    }
    b.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (!handshaken) {
        // Byte form, not an escape: this file is a template literal and every
        // backslash in it has to survive two extractors.
        const i = buf.indexOf(Buffer.from([13, 10, 13, 10]));
        if (i < 0) return;                              // header spanning chunks
        handshaken = true;
        buf = buf.slice(i + 4);
      }
      drain();
      // Compare DECODED payloads exactly -- never a substring of the wire.
      if (got.indexOf("hello") >= 0 && got.indexOf(BIG) >= 0) {
        server.close();
        console.log("SELF-TEST OK: handshake + masked broadcast + long frame (decoded)");
        process.exit(0);
      }
    });
    const hs = (k) => "GET / HTTP/1.1\\r\\nHost: localhost\\r\\nUpgrade: websocket\\r\\n" +
      "Connection: Upgrade\\r\\nSec-WebSocket-Key: " + k + "\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n";
    a.on("connect", () => a.write(hs(keyA)));
    b.on("connect", () => {
      b.write(hs(keyB));
      setTimeout(() => { a.write(masked("hello")); a.write(masked(BIG)); }, 100);
    });
    a.on("error", (e) => fail("client A: " + e.message));
    b.on("error", (e) => fail("client B: " + e.message));
    setTimeout(() => fail("timeout — broadcast never arrived"), 5000);
  });
}

if (process.argv.includes("--selftest")) {
  selftest();
} else if (process.argv.includes("--version")) {
  const mf = kitManifest();
  console.log(mf && mf.version ? mf.version : "unversioned");
} else {
  const port = parseInt(process.argv[2] || "8787", 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error("bad port: " + process.argv[2]);
    process.exit(1);
  }
  serve(port);
}
`;

export const TUGOFWAR_DOWNLOADS_HTML = `<!--
  DGG Tug-of-War — operator downloads.

  The one-page grab bag for the stream graphic: the whole kit as one zip,
  or each piece separately. Everything here runs with NO connection to the
  platform — the relay runs on the rig, the overlay is an OBS browser source,
  the control room drives the show from a laptop.
-->
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tug-of-War — operator kit downloads</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d0d10; color: #e8e8ee; min-height: 100vh;
         font-family: "Inter", "Segoe UI", system-ui, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 48px 24px; }
  h1 { font-size: 28px; font-weight: 800; letter-spacing: -.01em; margin: 0 0 8px; }
  .sub { opacity: .7; font-size: 14px; line-height: 1.6; margin: 0 0 32px; }
  a.dl { display: block; text-decoration: none; color: #e8e8ee;
         background: #1b1e27; border: 1px solid rgba(255,255,255,.14);
         border-radius: 12px; padding: 18px 20px; margin: 12px 0;
         transition: border-color .15s, background .15s; }
  a.dl:hover { background: #232734; border-color: rgba(255,255,255,.3); }
  a.dl .big { font-size: 17px; font-weight: 700; }
  a.dl .big b { color: #FF2537; }
  a.dl .desc { font-size: 13px; opacity: .65; margin-top: 4px; line-height: 1.5; }
  .primary { border-color: #FF2537; background: #2a1519; }
  .primary:hover { background: #331a1f; }
  code { background: rgba(255,255,255,.08); padding: 2px 6px; border-radius: 5px; font-size: 13px; }
  .note { margin-top: 32px; padding: 14px 16px; border-radius: 10px; font-size: 13px;
          line-height: 1.6; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); }
  button { font: inherit; font-size: 13px; padding: 8px 14px; border-radius: 8px; cursor: pointer;
           border: 1px solid rgba(255,255,255,.16); background: #1b1e27; color: #e8e8ee; margin-top: 8px; }
  button:hover { background: #232734; }
</style>
<main>
  <h1>Kick / Keep — operator kit</h1>
  <p class="sub">Donation tug-of-war for the stream. Download the whole kit, or grab the pieces.</p>

  <a class="dl primary" href="kit.zip" download>
    <span class="big">Download the whole kit <b>(kit.zip)</b></span>
    <div class="desc">README + overlay + relay + control room. Runs off a USB stick — no platform, no account, no network.</div>
  </a>

  <a class="dl" href="overlay.html">
    <span class="big">overlay.html</span>
    <div class="desc">The OBS browser source (1920×1080, transparent). Point OBS at
      <code>http://127.0.0.1:8787/overlay.html?goal=10000&amp;guarantee=120&amp;big=2500&amp;ws=ws://127.0.0.1:8787</code>.</div>
  </a>

  <a class="dl" href="relay.js" download>
    <span class="big">relay.js</span>
    <div class="desc">The sync bridge. Run <code>node relay.js</code> on the rig — the control room drives the OBS copy through it.</div>
  </a>

  <a class="dl" href="index.html">
    <span class="big">Control room</span>
    <div class="desc">The operator page: kick/keep buttons, goal &amp; guarantee controls, snapshot, relay box.</div>
  </a>

  <div class="note" id="ver">
    <strong>Version &amp; integrity</strong> — <span id="verline">reading manifest.json…</span>
    <div id="verdetail" style="margin-top:8px"></div>
    <div style="margin-top:8px">Verify the zip you downloaded: <code>sha256sum -c kit.zip.sha256</code>
      (PowerShell: <code>Get-FileHash kit.zip</code>) — it must match the hash above.
      When reporting a problem, paste the version line <code>node relay.js</code> prints.</div>
    <div style="margin-top:8px"><a href="manifest.json">manifest.json</a> · <a href="kit.zip.sha256">kit.zip.sha256</a></div>
  </div>

  <div class="note">
    <strong>Quick start</strong> — one command runs the whole show:
    <code>node relay.js</code> serves the control room at <code>http://127.0.0.1:8787/</code>,
    the overlay for OBS on the same port, and the websocket. Add the overlay URL below
    as an OBS Browser Source. KEEP donations raise the goal; when KICK fills it, the
    guest goes — never before the guarantee.
    <br><button id="copyObs">Copy the OBS URL</button>
  </div>
</main>
<script>
  const OBS_URL = "http://127.0.0.1:8787/overlay.html?goal=10000&guarantee=120&big=2500&ws=ws://127.0.0.1:8787";
  document.getElementById("copyObs").addEventListener("click", () => {
    navigator.clipboard.writeText(OBS_URL).then(() => {
      const b = document.getElementById("copyObs");
      const old = b.textContent; b.textContent = "Copied ✓";
      setTimeout(() => { b.textContent = old; }, 1200);
    }).catch(() => {});
  });
</script>
<script>
  // Version & integrity: read from manifest.json / kit.zip.sha256 beside this
  // page (the emitter writes both), so the page never carries a stale number.
  (function () {
    const line = document.getElementById("verline");
    const det = document.getElementById("verdetail");
    const esc = (t) => String(t).replace(/</g, "&lt;");
    fetch("manifest.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((m) => {
      if (!m) { line.textContent = "no manifest.json beside this page — unversioned build"; return; }
      line.textContent = "kit v" + m.version + " — built from " + String(m.source_commit).slice(0, 10) + " on " + m.source_date;
      const rows = Object.keys(m.files || {}).map((f) =>
        "<code>" + esc(f) + "</code> " + m.files[f].bytes + " B — sha256 <code>" + esc(m.files[f].sha256) + "</code>");
      let html = rows.join("<br>");
      if (m.changelog && m.changelog.length) {
        html += "<div style='margin-top:8px'><strong>What changed</strong></div><ul style='margin:4px 0 0 18px;padding:0'>"
          + m.changelog.map((c) => "<li><code>" + esc(c.commit) + "</code> " + esc(c.date) + " — " + esc(c.subject) + "</li>").join("")
          + "</ul>";
      }
      det.innerHTML = html;
    }).catch(() => { line.textContent = "manifest.json unreadable"; });
    fetch("kit.zip.sha256", { cache: "no-store" }).then((r) => r.ok ? r.text() : "").then((t) => {
      if (!t) return;
      const z = document.createElement("div"); z.style.marginTop = "8px";
      z.innerHTML = "<strong>kit.zip sha256</strong> <code>" + esc(t.trim().split(" ")[0]) + "</code>";
      det.appendChild(z);
    }).catch(() => {});
  })();
</script>
`;
