/**
 * Device/adapter classification and the shared in-browser inference deadlines.
 *
 * THIS FILE WAS REFERENCED BY THREE PLACES AND NEVER EXISTED.
 * `index.ts` re-exports it, `useWebGPUChat.ts` imports `FIRST_TOKEN_FAIL_MS`
 * from it, and Veil's `webgpu-brain.tsx` imports that symbol from
 * `awkit/webml` — so `tsc -p tsconfig.build.json` failed with
 * `Cannot find module './device-class'`, portal-kit produced NO `dist/`, and
 * because every `awkit` export maps into `dist/` the Veil image build then died
 * with eleven `Module not found: Can't resolve 'awkit/...'` errors. No new Veil
 * image could be produced at all, so the fleet kept serving the last one that
 * happened to build — which is indistinguishable from "my fix didn't work".
 *
 * Veil's `src/lib/bonsai-webgpu/gpu-class.ts` already carries this logic and its
 * own comment says it is "kept in step with portal-kit/src/webml/device-class.ts,
 * which BIH004 asserts rather than requests". This is that file. The mobile
 * predicate below is deliberately IDENTICAL to Veil's, because BIH004 compares
 * the two copies and a paraphrase is a failure.
 *
 * Why the shared copy has to exist at all: these constants must be ONE number
 * across every surface that bundles this module, which a
 * per-app literal cannot be — and the drift between a hardened app copy and an
 * un-hardened shared copy is exactly what gate 1zt was written for.
 */

/**
 * How long a turn may sit with NO first token before it is called dead.
 *
 * BIH002. Armed on entering `generating`, and on the FIRST TOKEN ONLY — this
 * runtime does ~1.9 tok/s on an Iris Xe and that is a working session, so
 * cutting off a slow-but-alive turn would fabricate failures, which is strictly
 * worse than the bug it guards: a fabricated error is one nobody can debug.
 *
 * It exists because a worker the browser kills for memory — the ORDINARY end of
 * a turn on a phone, not an edge case — posts no message and on several engines
 * fires no error, so `status` stayed `"generating"` forever with nothing to
 * observe. 60s is the value Veil's own test pins.
 */
export const FIRST_TOKEN_FAIL_MS = 60_000;

/** How long to wait for the worker to report READY before giving up on a load. */
export const LOAD_FAIL_MS = 180_000;

export type GpuClass = 'software' | 'integrated' | 'discrete' | 'unknown';

/** `GPUAdapterInfo` — Chrome 128+ populates a coarse vendor/architecture pair. */
export interface AdapterHint {
  vendor?: string;
  architecture?: string;
  /**
   * The adapter is a SOFTWARE rasteriser the browser substituted for a real GPU.
   * Checked FIRST: a fallback adapter routinely reports an EMPTY vendor, and an
   * empty vendor classifies as `unknown`, which is the discrete fast path — so
   * vendor-first sends SwiftShader down the path meant for a 5090.
   */
  isFallbackAdapter?: boolean;
}

const INTEGRATED_VENDORS = ['intel', 'arm', 'qualcomm', 'imgtec'] as const;

/** `microsoft` is WARP, Chrome's SOFTWARE rasteriser fallback — no usable GPU present. */
const SOFTWARE_VENDORS = ['microsoft'] as const;

export function classifyAdapter(hint?: AdapterHint): GpuClass {
  if (hint?.isFallbackAdapter === true) return 'software';
  const vendor = hint?.vendor?.trim().toLowerCase();
  if (!vendor) return 'unknown';
  if ((SOFTWARE_VENDORS as readonly string[]).includes(vendor)) return 'software';
  if ((INTEGRATED_VENDORS as readonly string[]).includes(vendor)) return 'integrated';
  return 'unknown';
}

export function mayAutoBoot(cls: GpuClass): boolean {
  if (isMobileDevice()) return false;
  return cls !== 'software';
}

/**
 * How many dispatches may share one submit — the TDR budget.
 *
 * BIH007: every file that acquires a device must consult this AND apply it via
 * setSubmitBudget; a budget computed and dropped is the silent no-op this family
 * keeps re-finding. Numbers mirror the Veil twin (gpu-class.ts) exactly:
 * measured 2026-08-22, a memory-bound dispatch is ~8 us on Blackwell and
 * ~140-168 us on phone-class GPUs, so the mobile cap of 4 keeps a burst well
 * inside a 16 ms compositor frame. Uncapped packets froze a Pixel 10 to a reboot
 * — a phone's compositor shares the GPU and mobile browsers have no TDR to reset
 * the driver, so the freeze is the DEVICE, not the tab. Windows carries the cap
 * on every class (TDR's 2 s deadline measures queue-to-completion, and an RTX
 * 5090 under external load lost its device mid-prefill, measured 2026-08-07);
 * macOS/Linux keep the uncapped fast path on discrete/unknown.
 */
export function maxDispatchesPerSubmit(
  cls: GpuClass,
  opts?: { windowsTdr?: boolean; mobile?: boolean },
): number {
  if (opts?.mobile) return 4;
  switch (cls) {
    case 'software':
    case 'integrated':
      return 8;
    case 'unknown':
    case 'discrete':
    default:
      return opts?.windowsTdr ? 64 : 0;
  }
}

/**
 * Is this a phone or tablet?
 *
 * No adapter field reports the fact that actually decides the outcome: a mobile
 * browser reclaims a background tab's memory and kills the worker holding the
 * weights. Vendor and architecture strings say nothing about that.
 *
 * The `Macintosh` + touch branch is the half everyone omits. iPadOS 13+ sends a
 * DESKTOP Safari user agent, so a plain UA regex misses every modern iPad —
 * precisely the class gate 1zt BIH004 exists for. Byte-for-byte the same
 * predicate as Veil's gpu-class.ts on purpose; BIH004 compares them.
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  const touch = (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0;
  return /Macintosh/i.test(ua) && touch > 1;
}

/**
 * Is this a PHONE — never a tablet? Owner directive 2026-09-01: phones may not load ANY
 * in-browser model — GPU lane, wasm lane, tap, or auto — because even the 1.7B on the
 * wasm-cpu lane froze a Pixel 10 to a reboot. Tablets (iPads included) stay allowed, so
 * this is NOT `isMobileDevice()`: Android phones carry "Mobile" in the UA and Android
 * tablets do not; iPhones always contain "iPhone"; iPads (any iPadOS, including the 13+
 * desktop-UA `Macintosh` branch) match none of these. Byte-for-byte the same predicate
 * as Veil's gpu-class.ts on purpose; BIH004 compares them.
 */
export function isPhoneDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  return /Android.+Mobile|iPhone|iPod/i.test(ua);
}

// ── WASP PHONE RATCHET ──────────────────────────────────────────────────────
//
// THE TABLE IS THE DECISION, AND IT IS DATA SO THE DECISION CAN BE AUDITED.
//
// The owner directive of 2026-09-01 was `isPhoneDevice()` -> refuse, everywhere: even the
// smallest model (1.7B) on the wasm-CPU lane froze a Pixel 10 to a whole-device reboot.
// That ban is being LIFTED ONE CELL AT A TIME, and only against measured hardware. A cell
// moves from 'banned' to 'verified' in the commit that lands a passing report under
// `bonsai-webgpu/selftest/phone-verify/<platform>-<lane>-<yyyy-mm-dd>.json`, and BIH015
// refuses a 'verified' with no report behind it.
//
// Why a table rather than a flag: the four cases are genuinely different devices. Android
// Chrome exposes a real WebGPU adapter and no TDR watchdog; iOS Safari exposes no adapter
// info at all and kills a tab on jetsam long before its RAM runs out. One boolean would
// let a Pixel result speak for an iPhone, which is precisely the reasoning that produced
// the original freeze.
//
// EVERY ENTRY IS 'banned' TODAY. This whole plane is behaviour-neutral on phones until a
// cell flips, and that is asserted rather than promised: `phoneLaneAllowed` returns false
// on every phone for every lane while the table reads like this.
export const WASP_PHONE_RATCHET = {
  android: { wasm: 'banned', webgpu: 'banned' },
  ios: { wasm: 'banned', webgpu: 'banned' },
} as const;

export type WaspLaneName = 'wasm' | 'webgpu';
export type PhoneRatchetState = 'banned' | 'verified';

/**
 * The smallest plan a phone may be offered, in bytes.
 *
 * The 1.7B is 237 MB and the loader needs ~1.2x that resident while it uploads, so a
 * budget below this cannot carry the smallest thing in the catalogue and "allowed" would
 * be a promise the device cannot keep.
 */
export const PHONE_MIN_PLAN_BYTES = 285 * 1024 * 1024;

/** Which phone platform this is, or null when it is not a phone at all. */
export function phonePlatform(): 'android' | 'ios' | null {
  if (!isPhoneDevice()) return null;
  const ua = typeof navigator === 'undefined' ? '' : (navigator.userAgent ?? '');
  return /iPhone|iPod/i.test(ua) ? 'ios' : 'android';
}

/** What a caller must show to be allowed a lane. Structural, so no module depends on the budget. */
export interface PhoneLaneBudget {
  lane?: string;
  weightsBytes?: number;
}

/**
 * MAY THIS PHONE RUN THIS LANE?
 *
 * FAIL-CLOSED AT EVERY STEP, and each `return false` is a distinct real case:
 *   - not a phone            -> true, and the caller's own guards decide (this is the
 *                               only reason desktop behaviour is untouched)
 *   - platform unknown       -> false; an unclassifiable phone is the weakest device there is
 *   - cell is not 'verified' -> false; this is every cell today
 *   - no budget supplied     -> false; "allowed" without knowing what the device can hold
 *                               is the exact claim that produced the freeze
 *   - budget is for the OTHER lane, or too small for the smallest model -> false
 */
export function phoneLaneAllowed(lane: WaspLaneName, budget?: PhoneLaneBudget): boolean {
  if (!isPhoneDevice()) return true;
  const platform = phonePlatform();
  if (!platform) return false;
  if (WASP_PHONE_RATCHET[platform][lane] !== ('verified' as PhoneRatchetState)) return false;
  if (!budget || budget.lane !== lane) return false;
  return typeof budget.weightsBytes === 'number'
    && budget.weightsBytes >= PHONE_MIN_PLAN_BYTES;
}


/**
 * May this device run the WebGPU lane at all? Phones: never, tap or no tap. Mobile
 * browsers expose `navigator.gpu` and hand out a real adapter, then the OS kills the
 * worker for memory mid-load — and a memory-killed worker posts nothing and on several
 * engines fires no `onerror`, so nothing cleans it up. This hook has no CPU lane, so on a
 * phone the honest answer is "unsupported", never a GPU worker. Kept in step with
 * AitherVeil's gpu-class.ts (gpuLaneAllowed).
 */
export function gpuLaneAllowed(): boolean {
  return !isMobileDevice();
}

/**
 * The auto-boot question as callers actually have it: a hint that may be NULL.
 *
 * 🚨 THE NULL CASE IS WHY THIS NEEDS ITS OWN ENTRY POINT. Every call site used
 * to be spelled `adapterInfo && !mayAutoBoot(classifyAdapter(adapterInfo))`,
 * which short-circuits to "allowed" whenever the hint is absent. `GPUAdapterInfo`
 * is Chrome 128+ and **Safari exposes nothing**, so on an iPhone the hint is
 * null, the guard is skipped entirely, and teaching `mayAutoBoot` about mobile
 * would have changed NOTHING on the single most affected device. The refusal has
 * to live where the null is handled — BIH003 treats the old spelling as a
 * violation.
 *
 * An absent hint still means "no opinion" for everything else: the
 * software-rasteriser refusal genuinely cannot be made without a hint, and
 * guessing there would park desktop Safari and Firefox in idle for a class they
 * are probably not in.
 */
export function autoBootAllowed(hint?: AdapterHint | null): boolean {
  if (isMobileDevice()) return false;
  if (!hint) return true;
  return mayAutoBoot(classifyAdapter(hint));
}


// ── THE DEVICE GATE: one probe, one ordered verdict ─────────────────────────
//
// RESTORED 2026-09-14, and the reason it was missing is worth keeping. The sweep-recovery
// commit of 2026-08-26 (592e4bf4f1, "restore the 222 files b39d5baef8 swept from develop")
// brought back `src/lib/__tests__/awkit-device-gate.test.ts` and NOT the functions it
// tests. So the suite has been red on develop ever since -- 13 failures, every one
// `probeDevice is not a function` -- and nothing noticed, because the publish lane's jest
// pattern covers only `marketing|greeter`. A test whose subject was deleted is a louder
// failure than no test, and it still ran nowhere.
//
// The test IS the specification; this is written to it rather than to a fresh design.
//
// 🚨 THE ORDER IS THE RULE. Each later reason is less specific and the visitor is shown
// `reason` verbatim, so telling someone on a software rasteriser "phones are slow" is a
// wrong explanation -- its own kind of dishonesty. Fallback before mobile, mobile before
// vendor, and the happy path must stay reachable (a gate that discouraged everything
// would satisfy every negative assertion while making the feature unreachable).

/** Is the visitor asking us not to spend their bytes? */
export function isDataSaver(): boolean {
  if (typeof navigator === 'undefined') return false;
  const c = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!c) return false;
  if (c.saveData === true) return true;
  // 2g and slow-2g only. A 3g/4g connection is slow, not RESTRICTED, and downgrading it
  // would discourage most of the mobile web for a reason the visitor never gave.
  return c.effectiveType === '2g' || c.effectiveType === 'slow-2g';
}

export type DeviceLane = 'webgpu' | 'discouraged' | 'unsupported';

export interface DeviceVerdict {
  lane: DeviceLane;
  /** Shown to the visitor VERBATIM. Empty only on the cleared path. */
  reason: string;
  isMobile: boolean;
  isFallbackAdapter: boolean;
  /** The adapter's vendor string, when the browser reports one. Safari reports none. */
  vendor?: string;
}

/**
 * Ask the browser what it can actually do, once, and answer with a verdict plus a reason.
 *
 * AN API IS NOT AN ADAPTER, and that distinction is the whole reason this exists.
 * `isWebGPUAvailable()` answers "is `navigator.gpu` there", which is YES on a VM and on a
 * blocklisted driver -- both of which then fail at `requestAdapter()`, after the surface
 * has already promised the visitor a local model.
 *
 * FAILS CLOSED on a throw. A probe that propagates leaves the caller with no verdict at
 * all, and "I could not look" must never reach a visitor as "everything is fine".
 */
export async function probeDevice(): Promise<DeviceVerdict> {
  const base = { isMobile: isMobileDevice(), isFallbackAdapter: false };
  const gpu = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & {
      gpu?: { requestAdapter(o?: { forceFallbackAdapter?: boolean }): Promise<unknown> };
    }).gpu;
  if (!gpu) {
    return {
      ...base,
      lane: 'unsupported',
      reason: 'This browser has no WebGPU, so a model cannot run on this device.',
    };
  }

  // NAMED types, not `as typeof adapter`: at the assignment `typeof adapter` is the
  // narrowed `null` (the initialiser), so the cast typed the adapter as null and every
  // later `adapter.x` was a read on `never`. That is what broke `tsc` in the awkit
  // build step of every tenant-portal deploy from 2026-09-14 to 2026-09-18.
  type ProbedAdapter = { info?: { vendor?: string }; isFallbackAdapter?: boolean };
  type ProbedFallback = { info?: { vendor?: string } };
  let adapter: ProbedAdapter | null = null;
  let fallback: ProbedFallback | null = null;
  try {
    adapter = (await gpu.requestAdapter()) as ProbedAdapter | null;
    if (!adapter) {
      fallback = (await gpu.requestAdapter({ forceFallbackAdapter: true })) as ProbedFallback | null;
    }
  } catch (e) {
    return {
      ...base,
      lane: 'unsupported',
      reason: `WebGPU could not be initialised on this device (${
        e instanceof Error ? e.message : String(e)}).`,
    };
  }

  if (!adapter && !fallback) {
    return {
      ...base,
      lane: 'unsupported',
      reason: 'WebGPU is present but this device offers no GPU adapter '
        + '(a virtual machine, or a driver the browser has blocklisted).',
    };
  }

  // SOFTWARE FIRST, before the mobile branch and before the vendor string. A fallback
  // adapter routinely reports NO vendor, so a vendor-first order classifies it 'unknown'
  // and sends it down the DISCRETE fast path -- measured 2026-07-31, where SwiftShader was
  // ~125x slower than the same box's real GPU and reported nothing at all.
  if (!adapter || adapter.isFallbackAdapter === true) {
    return {
      ...base,
      lane: 'discouraged',
      isFallbackAdapter: true,
      reason: 'This browser is rendering on the CPU rather than a GPU, so a model would '
        + 'run far too slowly to be useful.',
    };
  }

  const vendor = adapter.info?.vendor;
  if (base.isMobile) {
    return {
      ...base,
      lane: 'discouraged',
      vendor,
      reason: 'This is a phone or tablet — it can run a model, but the download is large '
        + 'and mobile browsers reclaim memory aggressively.',
    };
  }
  if (isDataSaver()) {
    return {
      ...base,
      lane: 'discouraged',
      vendor,
      reason: 'Data Saver is on — a model is a large download, so this is opt-in only.',
    };
  }
  if (classifyAdapter({ vendor }) === 'integrated') {
    return {
      ...base,
      lane: 'discouraged',
      vendor,
      reason: 'This is an integrated GPU — it can run a small model, but a large one may '
        + 'stall the display driver.',
    };
  }
  // AN UNRECOGNISED VENDOR IS NOT DOWNGRADED. Guessing about hardware that did not exist
  // when this list was written is how a future GPU gets treated as a phone.
  return { ...base, lane: 'webgpu', reason: '', vendor };
}
