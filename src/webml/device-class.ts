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
 * across Veil, gargbot, adk and AitherConnect (gate 1zt BIH002), which a
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
