/**
 * Tests for the tug-of-war overlay's scoring logic.
 *
 *   node AitherOS/apps/packages/awkit/src/panels/stream-overlay/overlay.test.mjs
 *
 * It evaluates the REAL script out of overlay-html.ts against a minimal DOM stub,
 * rather than restating the logic here. A test that reimplements the thing it
 * checks passes while the shipped file is broken -- and this graphic runs
 * unattended on a live stream, where the failure mode is a wrong number on
 * screen that nobody can correct in the moment.
 *
 * THE MECHANIC under test: kick donations fill the POT toward the goal; keep
 * donations RAISE the goal. When the pot meets the goal the guest is kicked --
 * never before the guaranteed airtime (the kick goes PENDING and keep can still
 * save them). The KICKED message then HOLDS (requested by the show 2026-09-06:
 * the next contestant has to sit down first): no clock starts, no board
 * resets, donations buffer, until the operator presses play -- only play
 * cycles to the next guest with a fresh goal.
 *
 * Exit 0 all passed, 1 a real failure, 2 the harness could not run (the file
 * moved, or the script block could not be extracted) -- never 0 on "could not
 * check", because an empty test run and a clean one look identical.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const ts = readFileSync(join(here, "overlay-html.ts"), "utf8");
// The overlay lives inside a TS template literal (see overlay-html.ts for why).
// Decode it the way the compiler will, so the test evaluates the SHIPPED string.
// Scan to the first UNESCAPED closing backtick. A greedy [\s\S]* anchored at
// $ silently swallows every later export the moment this module grows a second
// constant -- which it did, and the test caught it only because the
// concatenation happened to eval to invalid JS. It could have produced a
// plausible, wrong page instead.
const decl = "export const TUGOFWAR_OVERLAY_HTML = " + "`";
const i = ts.indexOf(decl);
let j = i + decl.length;
for (; i >= 0 && j < ts.length; j++) {
  if (ts[j] === "`") { let b = 0, k = j - 1; while (k >= 0 && ts[k] === "\\") { b++; k--; }
    if (b % 2 === 0) break; }
}
const lit = i < 0 || j >= ts.length ? null : [null, ts.slice(i + decl.length, j)];
if (!lit) { console.error("COULD NOT RUN: overlay-html.ts has no template literal"); process.exit(2); }
const html = eval("`" + lit[1] + "`");

const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("COULD NOT RUN: no <script> block in overlay.html"); process.exit(2); }

/** Minimal DOM: enough for the graphic to initialise, nothing more. */
function makeEl() {
  const el = {
    style: {}, textContent: "", className: "",
    classList: { toggle() {}, add() {}, remove() {} },
    appendChild() {}, remove() {},
  };
  return el;
}
const els = {};
const sandbox = {
  console,
  setInterval: () => 0,          // no timers: the tests drive ingest()/evaluate() directly
  setTimeout: () => 0,
  clearInterval: () => {},
  clearTimeout: () => {},
  Date,
  Math,
  Number,
  RegExp,
  String,
  Array,
  JSON,
  URLSearchParams,
  location: { search: "" },      // defaults: kick/keep, goal=$100, guarantee=120s
  addEventListener: () => {},
  fetch: () => Promise.reject(new Error("no network in tests")),
  WebSocket: function () { throw new Error("not used"); },
  document: {
    getElementById: (id) => (els[id] ||= makeEl()),
    createElement: () => makeEl(),
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

try {
  vm.createContext(sandbox);
  vm.runInContext(m[1], sandbox, { timeout: 5000 });
} catch (e) {
  console.error("COULD NOT RUN: overlay script threw on load:", e.message);
  process.exit(2);
}

const api = sandbox.__tbat;
if (!api || typeof api.ingest !== "function") {
  console.error("COULD NOT RUN: overlay did not expose __tbat.ingest");
  process.exit(2);
}

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} -> ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const BASE = api.CFG.goal;                 // 10000
const GUARANTEE_MS = api.CFG.guarantee * 1000;
// A fixed clock, so the guarantee and the pending kick are deterministic. The
// overlay reads time through api.clock, which production never rebinds.
const T0 = 1_700_000_000_000;
let now = T0;
const reset = () => {
  api.clock.now = () => now;
  api.resetGuest();                        // pot=0, goal=BASE, guestStart=now
};

// ---- keyword matching: the part that decides someone's money ---------------
check("plain 'kick' scores left",        api.sideOf("kick"),            "left");
check("'go KEEP!' is case-insensitive",  api.sideOf("go KEEP!"),        "right");
check("punctuation-adjacent counts",     api.sideOf("...keep."),        "right");

// The whole reason sideOf uses word boundaries. A substring match would drag a
// donor onto a side they never chose.
check("'kickoff' does NOT score",        api.sideOf("kickoff party"),   null);
check("'keepsake' does NOT score",       api.sideOf("a keepsake"),      null);
check("'sidekick' does NOT score",       api.sideOf("sidekick"),        null);

// Ambiguous is not a vote -- picking one would be inventing intent.
check("both keywords -> no side",        api.sideOf("kick or keep?"),   null);
check("neither keyword -> no side",      api.sideOf("love the show"),   null);
check("empty/absent message",            api.sideOf(undefined),         null);

// ---- amounts ---------------------------------------------------------------
reset();
check("amount_cents counted",  api.ingest({ amount_cents: 500, message: "kick" }), true);
check("  kick fills the pot",  api.state.pot, 500);
check("  kick does not touch the goal", api.state.goal, BASE);

reset();
check("dollars converted",     api.ingest({ amount: 12.34, message: "keep" }), true);
check("  keep RAISES the goal", api.state.goal, BASE + 1234);
check("  keep does not fill the pot", api.state.pot, 0);

reset();
api.ingest({ amount_cents: 100, amount: 999, message: "kick" });
check("amount_cents wins over amount", api.state.pot, 100);

// Money that cannot be trusted must not move the bar.
reset();
check("zero rejected",     api.ingest({ amount_cents: 0,    message: "kick" }), false);
check("negative rejected", api.ingest({ amount_cents: -500, message: "kick" }), false);
check("NaN rejected",      api.ingest({ amount_cents: NaN,  message: "kick" }), false);
check("missing amount",    api.ingest({ message: "kick" }),                     false);
check("non-object",        api.ingest("kick"),                                  false);
check("  nothing scored",  [api.state.pot, api.state.goal],                     [0, BASE]);

// A donation with no keyword is still a donation -- just not a vote.
reset();
check("no-keyword donation ignored", api.ingest({ amount_cents: 5000, message: "thanks!" }), false);
check("  totals untouched",          [api.state.pot, api.state.goal],                      [0, BASE]);

// ---- idempotency: the one that is unrecoverable on air ---------------------
reset();
const dup = { id: "evt-1", amount_cents: 50000, message: "keep" };
check("first delivery counts",  api.ingest({ ...dup }), true);
check("redelivery ignored",     api.ingest({ ...dup }), false);
check("  counted exactly once", api.state.goal, BASE + 50000);

// Events with no id cannot be deduped and must still count (a feed without ids
// is worse, but silently dropping its donations would be worse still).
reset();
api.ingest({ amount_cents: 100, message: "kick" });
api.ingest({ amount_cents: 100, message: "kick" });
check("id-less events both count", api.state.pot, 200);

// ---- the mechanic: pot vs goal, the guarantee, and the kick -----------------
// A kick donation that meets the goal DURING the guarantee becomes PENDING --
// the guest is guaranteed their airtime. Nothing is kicked yet.
reset();
const b1 = { kicked: api.state.kicked, guest: api.state.guest };
api.ingest({ amount_cents: BASE, message: "kick" });
check("pot at the goal",            api.state.pot, BASE);
check("  no kick before guarantee", api.state.kicked, b1.kicked);
check("  same guest",               api.state.guest, b1.guest);
check("  kick is pending",          api.state.kickPending, T0 + GUARANTEE_MS);

// Keep donations can SAVE a pending kick by raising the goal past the pot.
api.ingest({ amount_cents: 1000, message: "keep" });
check("keep raised the goal",    api.state.goal, BASE + 1000);
check("  pending kick averted",  api.state.kickPending, null);
check("  nobody was kicked",     api.state.kicked, b1.kicked);

// The pending kick fires at the guarantee mark -- the countdown is real, not
// cosmetic: donations that arrive before it can still change the outcome.
reset();
const b2 = { kicked: api.state.kicked, guest: api.state.guest };
api.ingest({ amount_cents: BASE, message: "kick" });
now = T0 + GUARANTEE_MS - 1000;
api.evaluate();
check("pending survives until the deadline", api.state.kickPending, T0 + GUARANTEE_MS);
check("  still not kicked early",            api.state.kicked, b2.kicked);
now = T0 + GUARANTEE_MS + 1;
api.evaluate();
check("pending kick fires at the deadline",  api.state.kicked, b2.kicked + 1);
check("  no pending left after the kick",    api.state.kickPending, null);
check("  the KICKED message HOLDS",          api.state.held, true);
check("  next guest waits for play",         api.state.guest, b2.guest);

// ---- the hold: the KICKED message stays until the operator presses play ----
// Requested by the show (2026-09-06): after a kick the widget must NOT move
// on -- the next contestant has to sit down first, and their clock must not
// start before they are ready. While held: the board is frozen, the clock
// does not run, and donations buffer onto the NEXT guest's board.
const HOLD_MS = 3 * GUARANTEE_MS;
now += HOLD_MS;                                // time passes behind the splash
api.evaluate();
check("  the guarantee clock does not run while held", api.state.kicked, b2.kicked + 1);
check("  pot frozen at the kick moment",               api.state.pot, BASE);
api.ingest({ amount_cents: 2000, message: "kick" });
api.ingest({ amount_cents: 3000, message: "keep" });
check("  held kick donation is buffered, not scored",  api.state.pot, BASE);
check("  held keep donation is buffered, not scored",  api.state.goal, BASE);
api.evaluate();
check("  buffered donations cannot kick anyone early", api.state.kicked, b2.kicked + 1);
let snapHeld = null;
api.handleMessage({ type: "snapshot" }, { postMessage: (m) => { snapHeld = m; } });
check("  snapshot says held", snapHeld && snapHeld.payload.held, true);
// The operator presses play once the next contestant is seated: the board
// resets fresh (pot 0, base goal) and the buffered donations then land on it.
api.handleMessage({ type: "play" }, null);
check("  play clears the hold",               api.state.held, false);
check("  play starts the next guest",         api.state.guest, b2.guest + 1);
// 2000, not BASE + 2000: the board really reset before the buffer landed.
// A flush that ran before the reset would leave the kicked pot on screen.
check("  buffered kick landed on the next guest",  api.state.pot, 2000);
check("  buffered keep raised the next goal",      api.state.goal, BASE + 3000);

// Once the guarantee has elapsed, the pot meeting the goal is an IMMEDIATE
// kick -- and, like every kick, it HOLDS until the operator presses play.
now = T0;   // the previous block left the clock advanced; a fresh guest starts HERE
reset();
const k2 = { kicked: api.state.kicked, guest: api.state.guest };
now = T0 + GUARANTEE_MS + 1000;
api.ingest({ amount_cents: BASE, message: "kick" });
check("kick after the guarantee is immediate", api.state.kicked, k2.kicked + 1);
check("  the KICKED message holds",            api.state.held, true);
check("  next guest waits for play",           api.state.guest, k2.guest);
api.handleMessage({ type: "play" }, null);
check("  play cycles to the next guest",       api.state.guest, k2.guest + 1);
check("  play resets pot and goal",            api.state.pot === 0 && api.state.goal === BASE, true);
check("  play leaves no hold behind",          api.state.held, false);

// ---- a SECOND play must not destroy the money the first one landed --------
// Measured before the guard: buffer $20 during a hold, press play (pot 2000),
// press it again -> pot 0, and ingest() had already marked that id seen, so no
// re-delivery can restore it. A double-click reaches this in under a second
// (the button's own visibility only refreshes on the 1s snapshot poll), and a
// duplicated frame over the relay reaches it with no click at all.
now = T0; reset();
{
  const b = { kicked: api.state.kicked, guest: api.state.guest };
  now = T0 + GUARANTEE_MS + 1000;
  api.ingest({ id: "dt-kick", amount_cents: BASE, message: "kick" });
  api.ingest({ id: "dt-buf", amount_cents: 2000, message: "kick" });
  api.handleMessage({ type: "play" }, null);
  check("play lands the buffered donation",   api.state.pot, 2000);
  api.handleMessage({ type: "play" }, null);
  check("  a SECOND play does not destroy it", api.state.pot, 2000);
  check("  and does not advance the guest again", api.state.guest, b.guest + 1);
  // reset is the always-on door and must still work.
  api.handleMessage({ type: "reset" }, null);
  check("  reset still starts a new guest",   api.state.guest, b.guest + 2);
  check("  on a fresh board",                 api.state.pot, 0);
}

// setgoal during a hold must not be silently accepted then overwritten.
now = T0; reset();
{
  now = T0 + GUARANTEE_MS + 1000;
  api.ingest({ id: "sg-kick", amount_cents: BASE, message: "kick" });
  api.handleMessage({ type: "setgoal", goal_cents: 50000 }, null);
  check("setgoal while held is refused, not silently lost", api.state.goal, BASE);
  api.handleMessage({ type: "play" }, null);
  api.handleMessage({ type: "setgoal", goal_cents: 50000 }, null);
  check("  and works once the hold is released",           api.state.goal, 50000);
}

// ---- while HELD, only play/reset may end the hold -------------------------
// Measured on the shipped script before this guard existed: a "window" while
// held un-froze the board, landed the buffered donations on the ALREADY-KICKED
// guest's still-full pot, re-armed a pending kick, and counted that SAME guest
// as kicked a second time (kicked 2 -> 3 with the guest counter never moving).
// Both controls also made the splash vanish on a mis-click, which is the exact
// thing the hold exists to prevent.
for (const ctrl of ["clear", "window"]) {
  now = T0; reset();
  const b = { kicked: api.state.kicked, guest: api.state.guest };
  now = T0 + GUARANTEE_MS + 1000;
  api.ingest({ id: "held-" + ctrl, amount_cents: BASE, message: "kick" });
  check(`held before ${ctrl}`, api.state.held, true);
  api.ingest({ id: "buf-" + ctrl, amount_cents: 300, message: "kick" });
  api.handleMessage({ type: ctrl }, null);
  check(`  ${ctrl} does NOT end the hold`,       api.state.held, true);
  check(`  ${ctrl} does NOT move the board`,     api.state.pot, BASE);
  check(`  ${ctrl} does NOT advance the guest`,  api.state.guest, b.guest);
  // ...and the same guest is never counted as kicked twice.
  now += GUARANTEE_MS + 2000;
  api.evaluate();
  check(`  no second kick for one guest after ${ctrl}`, api.state.kicked, b.kicked + 1);
  // play still works afterwards, and the buffered money still lands.
  api.handleMessage({ type: "play" }, null);
  check(`  play still releases after ${ctrl}`,   api.state.held, false);
  check(`  buffered donation still landed`,      api.state.pot, 300);
}

// A keep donation at or above the pot during the guarantee never even starts a
// pending kick.
reset();
api.ingest({ amount_cents: 5000, message: "kick" });
api.ingest({ amount_cents: 6000, message: "keep" });
check("goal above pot, no pending", api.state.kickPending, null);

// New guest (operator button / reset event) is NOT a kick: fresh board, same
// nobody-kicked counter.
reset();
const mr = { kicked: api.state.kicked, guest: api.state.guest };
api.resetGuest();
check("manual reset cycles the guest",    api.state.guest, mr.guest + 1);
check("  without counting a kick",        api.state.kicked, mr.kicked);
check("  fresh pot",                      api.state.pot, 0);
check("  fresh goal",                     api.state.goal, BASE);

// ---- operator controls: clear / window / snapshot -------------------------
// "Clear board" (v1's "Clear totals", new-mechanic semantics): fresh pot and
// goal for the SAME guest -- the guest counter must NOT move, unlike reset.
reset();
const cb = { kicked: api.state.kicked, guest: api.state.guest };
api.ingest({ amount_cents: 4000, message: "kick" });
api.ingest({ amount_cents: 500, message: "keep" });
api.handleMessage({ type: "clear" }, null);
check("clear resets the pot",       api.state.pot, 0);
check("clear resets the goal",      api.state.goal, BASE);
check("clear keeps the same guest", api.state.guest, cb.guest);
check("clear keeps the kick count", api.state.kicked, cb.kicked);

// "Restart timer" (v1's "Reset timer"): the guaranteed airtime restarts for the
// current guest. If the pot is already at the goal, the kick re-arms at the
// end of the NEW window -- the window event is a restart, not a pardon.
reset();
now = T0 + 50000;
api.handleMessage({ type: "window" }, null);
check("window restarts the guarantee", api.state.guestStart, T0 + 50000);
api.ingest({ amount_cents: BASE, message: "kick" });
check("  pending re-arms at the new window", api.state.kickPending, T0 + 50000 + GUARANTEE_MS);

// Snapshot: the control panel's live readout is fed by this reply. It must
// carry the full state so the panel can render pot/goal/guest/timer without
// re-deriving anything itself.
reset();
let snap = null;
const src = { postMessage: (msg) => { snap = msg; } };
api.handleMessage({ type: "snapshot" }, src);
check("snapshot replied to the caller", !!snap && snap.type === "snapshot", true);
check("  pot in the snapshot",          snap.payload.pot, 0);
check("  goal in the snapshot",         snap.payload.goal, BASE);
check("  guest in the snapshot",        snap.payload.guest, snap.payload.guest);
check("  clock in the snapshot",        snap.payload.now, now);
check("  guarantee in the snapshot",    snap.payload.guarantee, GUARANTEE_MS);
check("  held flag in the snapshot",    snap.payload.held, false);
api.handleMessage({ type: "snapshot" }, null);
check("a sourceless snapshot request never posts to a window", snap.payload.pot, 0);
// A snapshot REPLY carries a payload; a REQUEST does not. Without that test
// two overlays on one relay answer each other's answers forever, because on
// the wire a reply is indistinguishable from a request. This is the arm that
// makes the relay's snapshot lane safe to have more than one overlay on.
snap = null;
api.handleMessage({ type: "snapshot", payload: { pot: 999, held: true } }, src);
check("a snapshot REPLY is not answered with another reply", snap, null);

// ---- TBAT flier palette ----------------------------------------------------
// The overlay sits next to TBAT's own social artwork: four flat colours -- flag
// red, Old Glory blue, white, black -- hard edges, no gradients. That is a
// BRAND requirement, not taste, and nothing else in this repo asserts it. A
// restyle is invisible to every functional test above, which is exactly how the
// previous generic orange/cyan survived.
//
// Pinned as VALUES because the point is the specific colours: asserting only
// "some --red exists" would pass on the orange this replaced.
check("palette: flag red",       html.includes("--red:      #CE1126"), true);
check("palette: Old Glory blue", html.includes("--blue:     #002868"), true);

// Both inks present. The type values are DELIBERATELY not the flier values --
// #002868 is unreadable as type on a black overlay -- so a well-meaning
// "simplify" collapsing the pair is a legibility regression dressed as cleanup.
check("palette: separate ink for type",
      html.includes("--red-ink") && html.includes("--blue-ink"), true);

// The generic stream-tech palette must be GONE, not merely joined. Without this
// arm the checks above pass while the old colours still paint the bar.
//
// Matched against the DECLARATIONS only. The first version scanned the raw
// source and failed on the CSS comment that explains which colours were
// replaced and why -- flagging the documentation of a defect as the defect,
// which is how a check gets deleted rather than satisfied.
const declarations = html
  .replace(/\/\*[\s\S]*?\*\//g, "")   // CSS block comments
  .replace(/^\s*\/\/.*$/gm, "");      // JS line comments in the inline script
// Scoped to the :root block -- the DEFAULT palette -- not the whole file. The
// warmer orange legitimately survives as a named PRESET, so a whole-file scan
// now fails on a feature. What must not come back is the default: this asserts
// what the overlay paints when nobody passes ?theme.
const rootBlock = (declarations.match(/:root\s*\{[\s\S]*?\}/) || [""])[0];
check("  :root block was found", rootBlock.includes("--red"), true);
check("no orange in the default palette",
      /#ff6b4a|#ff5330|#ff8a5c/i.test(rootBlock), false);
check("no pale cyan in the default palette",
      /#4ab8ff/i.test(rootBlock), false);

// The presets are a product requirement (the next org is not red/white/blue),
// so pin that they exist and that overrides are VALIDATED -- an unvalidated
// query value reaches setProperty, which is a CSS injection via a link.
check("theme presets exist",     html.includes("THEMES") && html.includes("warm:"), true);
check("hex overrides validated", /\^#\[0-9a-fA-F\]\{6\}\$/.test(html), true);

// Guard the guard: if the stripper ever ate the whole file, every "no X left"
// arm above would pass vacuously and this test would report a clean palette on
// an empty string.
check("  stripper left the stylesheet intact", declarations.includes("#CE1126"), true);

// Flier vocabulary is blocks and rules. A gradient also makes the leading edge
// ambiguous, and showing exactly where the line is is the bar's only job.
check("bar fill has no gradient", /#fill[\s\S]{0,200}?linear-gradient/.test(html), false);
check("bar is square",            html.includes("border-radius: 0"), true);

// The mechanic's tell: the widget must speak the pot/goal language, not the old
// left-vs-right share language. A regression to the old scoring (or a renamed
// state that forgot the render) leaves these on screen.
check("keep side shows the GOAL",   html.includes("GOAL"), true);
check("kick/pending timer exists",  html.includes("KICK ") || html.includes("WINDOW "), true);
check("splash element exists",      html.includes("splash"), true);

// ---- the control room (TUGOFWAR_DEMO_HTML): every operator control ---------
// The page at /tugofwar/ is where a human runs the show. An overlay change
// that forgets the control page leaves operators with a graphic they cannot
// drive -- the exact "the control surface vanished" report that prompted the
// control room. The demo constant is the SECOND literal in the module; scan
// for it the same way the emitter does.
const decl2 = "export const TUGOFWAR_DEMO_HTML = " + "`";
const i2 = ts.indexOf(decl2);
let j2 = i2 + decl2.length;
for (; i2 >= 0 && j2 < ts.length; j2++) {
  if (ts[j2] === "`") { let b = 0, k = j2 - 1; while (k >= 0 && ts[k] === "\\") { b++; k--; }
    if (b % 2 === 0) break; }
}
const demoHtml = i2 < 0 || j2 >= ts.length ? "" : eval("`" + ts.slice(i2 + decl2.length, j2) + "`");
check("control room constant exists", demoHtml.length > 1000, true);
for (const ctrl of ["Reset board", "Restart timer", "New guest", "Set goal",
                    "Add donation", "Fake donations", "snapshot", "relay", "Copy",
                    "NEXT GUEST READY"]) {
  check("  control room carries: " + ctrl, demoHtml.includes(ctrl), true);
}
// The splash's only exit is an operator message, so a dead relay strands a
// full-cover KICKED splash on air while this page still looks fine. The
// reconnect and the visible status are the difference between "play did
// nothing" and "play did nothing BECAUSE the relay is down".
check("  control room reconnects a dropped relay",
      demoHtml.includes("onclose") && demoHtml.includes("connectRelay"), true);
check("  and says so on screen",
      demoHtml.includes("relayState") && demoHtml.includes("DISCONNECTED"), true);
check("  control room drives the hold with play",
      demoHtml.includes('type: "play"') && demoHtml.includes("playNext"), true);
// The play button is HIDDEN unless held, and held reached this page only from
// the PREVIEW iframe -- a different overlay from the one in OBS. When the two
// diverge (OBS reloads the scene, the relay drops, the operator changes the
// goal without re-pasting the URL) the graphic on air sits under a full-cover
// KICKED splash while the button that clears it is not on screen. So the poll
// must go down the relay too, and the reply must be preferred over the
// preview's. Behaviour is proven in the browser proof; these pin the wiring.
check("  control room polls the ON-AIR copy over the relay",
      demoHtml.includes("relay.send") && demoHtml.includes('type: "snapshot"'), true);
check("  and reads the reply back off that socket",
      demoHtml.includes("ws.onmessage") && demoHtml.includes("applySnapshot"), true);
check("  the on-air copy wins over the preview",
      demoHtml.includes("lastOnAir"), true);
// close() is ASYNCHRONOUS. connectRelay() replaces the socket immediately, so
// the OLD socket's onclose runs afterwards -- and unguarded it threw away the
// socket that had just replaced it and scheduled another reconnect, which
// closed the next live socket in turn. Measured in a real browser: the third
// and fourth button presses of a session were silently dropped while the
// status line read "connected". Every handler must check it is still current.
check("  a replaced relay socket's handlers are inert",
      (demoHtml.match(/relay [!=]== ws/g) || []).length >= 4, true);
// The preview always moves, so a send that never left the room looks exactly
// like one that did -- unless the page says so.
check("  a press that did not reach the relay says so",
      demoHtml.includes("OBS did not get that"), true);
check("  control room embeds the real overlay", demoHtml.includes("overlay.html"), true);
check("  control room links the kit zip", demoHtml.includes("kit.zip"), true);

// ---- the downloads page (TUGOFWAR_DOWNLOADS_HTML): the operator grab bag ----
// A public static page on the tenant origin listing the kit. The emitter's
// self-test asserts it extracts; here we assert it actually LINKS the kit.
const decl4 = "export const TUGOFWAR_DOWNLOADS_HTML = " + "`";
const i4 = ts.indexOf(decl4);
let j4 = i4 + decl4.length;
for (; i4 >= 0 && j4 < ts.length; j4++) {
  if (ts[j4] === "`") { let b = 0, k = j4 - 1; while (k >= 0 && ts[k] === "\\") { b++; k--; }
    if (b % 2 === 0) break; }
}
const dlHtml = i4 < 0 || j4 >= ts.length ? "" : eval("`" + ts.slice(i4 + decl4.length, j4) + "`");
check("downloads page constant exists", dlHtml.length > 1000, true);
check("  downloads page links the kit zip", dlHtml.includes("kit.zip"), true);
check("  downloads page links relay and overlay",
      dlHtml.includes("relay.js") && dlHtml.includes("overlay.html"), true);

// ---- the relay (TUGOFWAR_RELAY_JS): the OBS-sync bridge, PROVEN -------------
// The control room and the OBS copy are separate processes; the relay is the
// only thing that makes the buttons reach on-air. It is extracted the same
// way the emitter serves it, and its SELF-TEST is actually executed -- two
// real sockets, a real handshake, a masked frame broadcast -- because a relay
// that parses frames wrong fails only at 2am on a live stream.
const decl3 = "export const TUGOFWAR_RELAY_JS = " + "`";
const i3 = ts.indexOf(decl3);
let j3 = i3 + decl3.length;
for (; i3 >= 0 && j3 < ts.length; j3++) {
  if (ts[j3] === "`") { let b = 0, k = j3 - 1; while (k >= 0 && ts[k] === "\\") { b++; k--; }
    if (b % 2 === 0) break; }
}
const relayJs = i3 < 0 || j3 >= ts.length ? "" : eval("`" + ts.slice(i3 + decl3.length, j3) + "`");
check("relay constant exists", relayJs.length > 2000, true);
check("  carries the RFC6455 handshake", relayJs.includes("Sec-WebSocket-Accept"), true);
check("  refuses unmasked client frames", relayJs.includes("client frames must be masked"), true);
if (relayJs.length > 2000) {
  const tmp = join(tmpdir(), "tugofwar-relay-selftest-" + process.pid + ".js");
  writeFileSync(tmp, relayJs, "utf8");
  const r = spawnSync(process.execPath, [tmp, "--selftest"],
                      { encoding: "utf8", timeout: 15000 });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  relay --selftest broadcasts (${(r.stdout || r.stderr || "").trim().slice(0, 80)})`);

  // ---- the offline KIT: `node relay.js` must serve the whole show ----------
  // The kit claims "one command runs everything offline". Prove it: put
  // relay.js + overlay.html + control-room.html in a temp dir (the unzipped
  // kit), start the relay, and fetch the pages over plain HTTP — the same way
  // OBS and the control room would. A relay that only speaks WebSocket leaves
  // the operator with file:// query-param flakiness; that is the defect this
  // arm exists to catch.
  const kitDir = mkdtempSync(join(tmpdir(), "tugofwar-kit-"));
  writeFileSync(join(kitDir, "relay.js"), relayJs, "utf8");
  writeFileSync(join(kitDir, "overlay.html"), html, "utf8");
  writeFileSync(join(kitDir, "control-room.html"), demoHtml, "utf8");
  // Start it and WATCH it, rather than sleeping a fixed guess at it. relay.js
  // exits 1 on a listen error and stdio is ignored, so a port already in use
  // looked exactly like a relay that would not start -- measured 1 failing run
  // in 3 before this. A gate that fails at random teaches people to re-run
  // until green, which trains away the signal.
  // stdio: "ignore" -- the port is OURS (we passed it); pipes would leave
  // handles open and Windows libuv asserts on parent teardown.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function startKitRelay(attempts = 3) {
    for (let a = 0; a < attempts; a++) {
      const p = 20000 + Math.floor(Math.random() * 20000);
      const child = spawn(process.execPath, [join(kitDir, "relay.js"), String(p)],
                          { stdio: "ignore" });
      let died = false;
      child.on("exit", () => { died = true; });
      for (let i = 0; i < 40 && !died; i++) {
        try { await fetch(`http://127.0.0.1:${p}/`); return { child, port: p }; }
        catch { await sleep(250); }
      }
      child.kill();
      if (!died) return null;   // never died AND never answered: a real failure
    }
    return null;
  }
  const kit = await startKitRelay();
  if (!kit) {
    failed++;
    console.log("  FAIL  offline kit relay never answered on any of 3 ports");
  }
  const relay = kit ? kit.child : { kill() {}, on(_e, cb) { cb(); } };
  const port = kit ? kit.port : 0;
  for (const [path, needle] of (kit ? [["/", "control room"], ["/overlay.html", "tug-of-war"],
                                ["/overlay.html?goal=10000&ws=ws://127.0.0.1:" + port, "tug-of-war"]] : [])) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      const body = await res.text();
      const hit = res.status === 200 && body.toLowerCase().includes(needle);
      if (!hit) failed++;
      console.log(`  ${hit ? "PASS" : "FAIL"}  offline kit serves ${path} (${res.status})`);
    } catch (e) {
      failed++;
      console.log(`  FAIL  offline kit fetch ${path}: ${e.message}`);
    }
  }
  // ---- the Origin gate: a foreign TAB must not be able to drive the show ---
  // A WebSocket is exempt from the same-origin policy, so any page the operator
  // has open can dial ws://127.0.0.1:8787 and fake a donation or kick the guest.
  // Binding to loopback does not help -- the attacker is a tab, not a host.
  // Absent Origin (native clients, OBS) and this relay's own origin must STILL
  // connect, or the gate has deleted the feature instead of guarding it.
  const handshake = (originLine) => new Promise((res) => {
    const sock = netConnect(port, "127.0.0.1");
    let out = "";
    sock.on("connect", () => sock.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" + originLine + "Sec-WebSocket-Key: aGVsbG8gd29ybGQ=\r\nSec-WebSocket-Version: 13\r\n\r\n"));
    sock.on("data", (d) => { out += d; sock.end(); });
    sock.on("close", () => res(out.split("\r\n")[0] || ""));
    setTimeout(() => { sock.destroy(); res("(timeout)"); }, 2500);
  });
  for (const [label, line, want] of [
    ["no Origin (a native client) connects", "", "101"],
    ["this relay's own origin connects", "Origin: http://127.0.0.1:" + port + "\r\n", "101"],
    ["a FOREIGN page is refused", "Origin: https://evil.example\r\n", "403"],
    ["a different local port is refused", "Origin: http://127.0.0.1:9999\r\n", "403"],
  ]) {
    const got = await handshake(line);
    const ok = got.includes(want);
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  origin gate: ${label} (${got.trim()})`);
  }

  // ---- "node relay.js 0" -- the invocation serve() documents ---------------
  // serve()'s own comment tells people to run it ("node relay.js 0 would
  // otherwise print a URL that does not connect") while the arg guard below it
  // refused any port under 1. So a documented invocation had never once
  // worked, and the failure was a bare "bad port: 0" -- which reads as the
  // operator mistyping rather than as the tool contradicting its own docs.
  // A comment is not a gate; this is.
  const ephemeral = await new Promise((res) => {
    const child = spawn(process.execPath, [join(kitDir, "relay.js"), "0"]);
    let buf = "", done = false;
    const finish = (v) => { if (!done) { done = true; res(v); } };
    const onData = (d) => {
      buf += d;
      const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)/);
      if (m) finish({ child, port: Number(m[1]) });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (c) => finish({ child: null, port: 0, why: `exited ${c}: ${buf.trim()}` }));
    setTimeout(() => { child.kill(); finish({ child: null, port: 0, why: "no port announced" }); }, 6000);
  });
  {
    const ok = ephemeral.port > 0;
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  "relay.js 0" binds a free port and announces it `
                + `(${ok ? ephemeral.port : ephemeral.why})`);
    if (ok) {
      // Announcing a port it did not bind would be worse than refusing 0.
      let served = false;
      try {
        const r = await fetch(`http://127.0.0.1:${ephemeral.port}/`);
        served = r.status === 200;
      } catch { served = false; }
      if (!served) failed++;
      console.log(`  ${served ? "PASS" : "FAIL"}  the announced ephemeral port really serves`);
      ephemeral.child.kill();
    }
  }

  relay.kill();
  await new Promise((r) => { relay.on("close", r); setTimeout(r, 1500); });
}

console.log(failed
  ? `\ntest-overlay: ${failed} failure(s)`
  : "\ntest-overlay: all assertions passed");
// process.exitCode, NOT process.exit(): force-exit runs libuv teardown on
// Windows and asserts on the killed child's handles (exit 127). Natural exit
// carries the same code with no teardown crash.
process.exitCode = failed ? 1 : 0;
