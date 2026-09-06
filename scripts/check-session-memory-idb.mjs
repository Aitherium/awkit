#!/usr/bin/env node
/**
 * Live IndexedDB probe for the session-memory lane — a check that can fail.
 *
 * Why this exists (2026-08-31): the IndexedDB store is the production half of
 * the lane, and jest/jsdom cannot exercise it (no real indexedDB). The
 * in-memory twin pins the CONTRACT; this pins the IDB IMPLEMENTATION against a
 * real Chromium tab via the AitherBrowser service (localhost:8132).
 *
 * What it does: opens a headless session on https://example.com (a real origin —
 * about:blank has an opaque origin where indexedDB throws SecurityError), evals
 * the COMPILED dist store (dist/webml/session-memory/store.js, exports stripped
 * so a classic eval can define the classes) plus a harness that asserts:
 *   addMany / get / all / embedding round-trip / upsert-by-id / remove /
 *   cross-instance persistence / clear.
 *
 * Exit contract: 0 = every check passed in the real browser; 1 = any check
 * failed or the probe could not judge (service unreachable, eval errored).
 * NEVER 0 on silence — the same rule as the python checker family.
 *
 * Run: node scripts/check-session-memory-idb.mjs
 * Requires: the AitherBrowser service (GET https://localhost:8132/health, 200).
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import https from "node:https"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const BASE = "https://localhost:8132"

// The service speaks TLS with the internal AitherNet CA. The ambient
// NODE_EXTRA_CA_CERTS on this box points at the RETIRED D: tree (measured
// 2026-08-31 — the file does not exist there and node's fetch then cannot
// verify ANYTHING). Ambient env is read at node startup and cannot be fixed
// from inside the script, so the CA is passed EXPLICITLY per request instead.
// TLS verification is never disabled.
const CA_BUNDLE = (() => {
  for (const candidate of [
    "C:/AitherOS-Data/Library/Data/tls/ca-chain.pem",
    "C:/AitherOS-Fresh/AitherOS/Library/Data/tls/ca-chain.pem",
  ]) {
    try {
      const pem = readFileSync(candidate, "utf8")
      if (pem.includes("BEGIN CERTIFICATE")) return pem
    } catch {
      // keep looking
    }
  }
  return null
})()

if (!CA_BUNDLE) {
  console.error("DEAD: no internal CA bundle resolvable — the probe cannot verify the service TLS")
  process.exit(1)
}

/** Explicit-CA https request (POST for payloads, GET for health). */
function request(path, { method = "GET", payload } = {}) {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? undefined : JSON.stringify(payload)
    const req = https.request(
      BASE + path,
      {
        method,
        ca: CA_BUNDLE,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        timeout: 60_000,
      },
      (res) => {
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`${method} ${path} -> ${res.statusCode}: ${data.slice(0, 200)}`))
            return
          }
          try {
            resolve(JSON.parse(data))
          } catch {
            reject(new Error(`${method} ${path} -> non-JSON response`))
          }
        })
      },
    )
    req.on("error", reject)
    req.on("timeout", () => req.destroy(new Error(`${method} ${path} timed out`)))
    if (body !== undefined) req.write(body)
    req.end()
  })
}

function buildHarness() {
  const src = readFileSync(join(ROOT, "dist/webml/session-memory/store.js"), "utf8")
  // ESM exports are not eval-able as a classic script — strip them.
  const body = src.replace(/export class /g, "class ")
  // Each step runs its check AFTER its own action — order is the test. The
  // first version pushed every check before the actions and reported the
  // pre-state against post-state expectations (4 false failures).
  const steps = [
    ["fresh clear", `(await store.clear(), true)`],
    ["addMany 3 chunks", `(await store.addMany([{id:'c1',text:'first chunk',capturedAt:'2026-08-31T12:00:00.000Z',embedding:[0.1,0.2]},{id:'c2',text:'second chunk',capturedAt:'2026-08-31T12:00:01.000Z',embedding:[0.3,0.4]},{id:'c3',text:'third chunk',capturedAt:'2026-08-31T12:00:02.000Z'}]), (await store.count()) === 3)`],
    ["get by id", `(await store.get('c2'))?.text === 'second chunk'`],
    ["all() returns 3", `(await store.all()).length === 3`],
    ["embedding round-trips", `JSON.stringify((await store.all()).find(c=>c.id==='c1')?.embedding) === '[0.1,0.2]'`],
    ["upsert replaces same id", `(await store.add({id:'c1',text:'first chunk UPDATED',capturedAt:'2026-08-31T13:00:00.000Z',embedding:[9.9,9.9]}), (await store.get('c1'))?.text === 'first chunk UPDATED')`],
    ["upsert does not grow count", `(await store.count()) === 3`],
    ["remove", `(await store.remove('c2'), (await store.count()) === 2)`],
    ["cross-instance persistence", `(await new IndexedDBMemoryStore().all()).length === 2`],
    ["clear", `(await store.clear(), (await store.count()) === 0)`],
  ]
  const harness = `(() => {
    const results = [];
    const run = async () => {
      try {
        if (typeof indexedDB === 'undefined') throw new Error('no indexedDB global');
        const store = new IndexedDBMemoryStore();
        ${steps
          .map(
            ([name, step]) =>
              `results.push({ name: ${JSON.stringify(name)}, ok: (${step}) === true });`,
          )
          .join("\n        ")}
      } catch (err) {
        results.push({ name: 'HARNESS CRASH', ok: false, detail: String((err && err.message) || err) });
      }
      return JSON.stringify(results);
    };
    return run();
  })()`
  return body + "\n" + harness
}

let health
try {
  health = await request("/health")
} catch {
  health = null
}
if (!health || health.status !== "healthy") {
  console.error("DEAD: AitherBrowser unreachable at " + BASE + " — the probe cannot judge")
  process.exit(1)
}

let sid
try {
  const opened = await request("/session/open", { method: "POST", payload: { url: "https://example.com/", headless: true } })
  sid = opened.session_id
  // Let the page settle before evaling (transient listeners on a fresh origin).
  await new Promise((r) => setTimeout(r, 1500))
  const res = await request(`/session/${sid}/act`, { method: "POST", payload: { action: "eval", value: buildHarness() } })
  const value = res?.value
  if (typeof value !== "string") {
    console.error("DEAD: eval returned no value:", JSON.stringify(res).slice(0, 300))
    process.exit(1)
  }
  const rows = JSON.parse(value)
  let failed = 0
  for (const row of rows) {
    console.log(`${row.ok ? "PASS" : "FAIL"}  ${row.name}${row.detail ? "  (" + row.detail + ")" : ""}`)
    if (!row.ok) failed += 1
  }
  console.log(failed === 0 ? `OK: ${rows.length}/${rows.length} live IDB checks passed` : `VIOLATION: ${failed} of ${rows.length} live IDB checks failed`)
  process.exit(failed === 0 ? 0 : 1)
} catch (err) {
  console.error("DEAD: probe failed:", err.message)
  process.exit(1)
} finally {
  if (sid) await request(`/session/${sid}/close`, { method: "POST", payload: {} }).catch(() => {})
}
