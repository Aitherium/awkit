// Copy every .css under src/ to the same relative path under dist/.
//
// tsc emits .js and .d.ts and nothing else, so a package whose exports name a .css
// ships a manifest pointing at a file the build never produced: it installs cleanly
// and imports nothing (NPE001).
//
// This is a .mjs rather than `cp src/*.css dist/` because npm runs scripts through
// cmd.exe on Windows, where `cp` and `mkdir -p` do not exist. portal-kit's script did
// exactly that and failed with "The system cannot find the path specified" on every
// build, silenced by an `|| true` — tsc succeeded, so the build reported success while
// emitting no CSS at all.
//
// Copying nothing is a FAILURE, not a no-op: if this package stops having stylesheets
// the exports naming them are already wrong, and a silent zero is how that ships.
import { cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const SRC = "src";
const OUT = "dist";

function cssFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

const found = cssFiles(SRC);
for (const file of found) {
  const dest = join(OUT, relative(SRC, file));
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(file, dest);
}

if (found.length === 0) {
  console.error(`copy-assets: no .css found under ${SRC}/ — exports naming one are broken`);
  process.exit(1);
}
console.log(`copy-assets: ${found.length} stylesheet(s) -> ${OUT}/`);
