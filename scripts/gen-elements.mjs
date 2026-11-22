#!/usr/bin/env node
/**
 * gen-elements.mjs — build src/elements/registry.generated.ts from the element
 * files on disk.
 *
 * Usage:
 *   node scripts/gen-elements.mjs                # write the registry
 *   node scripts/gen-elements.mjs --check        # exit 1 if the file is stale
 *   node scripts/gen-elements.mjs --root <dir>   # package dir (tests use a temp tree)
 *
 * Exit codes: 0 ok · 1 stale or an element breaks the contract · 2 cannot read
 * the elements folder (could not judge) — the same triad every AitherOS checker
 * uses. No npm dependencies, no bundler globs: awkit source is consumed
 * directly by Next.js/webpack, so the registry must be a plain static module.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = resolve(HERE, '..')
const REGISTRY_PATH = 'src/elements/registry.generated.ts'
const ELEMENTS_DIR = 'src/elements'

/** Canonical order — also the order of the category list in the gallery. */
const CATEGORIES = [
  'buttons',
  'toggles',
  'loaders',
  'cards',
  'inputs',
  'checkboxes',
  'radios',
  'tooltips',
  'badges',
  'progress',
]

const CATEGORY_SET = new Set(CATEGORIES)

class ContractError extends Error {}

/** Read `--flag value` arguments without pulling in a dependency. */
function parseArgs(argv) {
  const out = { check: false, root: DEFAULT_ROOT }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') out.check = true
    else if (a === '--root') {
      const v = argv[++i]
      if (!v) throw new ContractError('--root needs a directory')
      out.root = resolve(v)
    } else if (a === '--help' || a === '-h') {
      out.help = true
    } else {
      throw new ContractError(`unknown argument: ${a}`)
    }
  }
  return out
}

/**
 * Pull the `export const meta: ElementMeta = { ... }` object out of a file.
 * Brace matching rather than a regex, so a `{` inside a tag string cannot end
 * the object early.
 */
function extractMetaObject(source, file) {
  const marker = source.search(/export\s+const\s+meta\b/)
  if (marker < 0) throw new ContractError(`${file}: no \`export const meta\``)
  const eq = source.indexOf('=', marker)
  if (eq < 0) throw new ContractError(`${file}: meta has no initializer`)
  const start = source.indexOf('{', eq)
  if (start < 0) throw new ContractError(`${file}: meta is not an object literal`)

  let depth = 0
  let quote = null
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i)
      i = nl < 0 ? source.length : nl
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end < 0 ? source.length : end + 1
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new ContractError(`${file}: meta object is not closed`)
}

/** Unescape the handful of escapes a one-line string literal can carry. */
function unquote(literal) {
  return literal.replace(/\\(['"`\\nrt])/g, (_, c) => {
    switch (c) {
      case 'n': return '\n'
      case 'r': return '\r'
      case 't': return '\t'
      default: return c
    }
  })
}

/** `key: 'value'` from the meta object. */
function readStringField(object, key, file) {
  const re = new RegExp(`\\b${key}\\s*:\\s*(?:'((?:\\\\.|[^'\\\\])*)'|"((?:\\\\.|[^"\\\\])*)"|\`((?:\\\\.|[^\`\\\\])*)\`)`)
  const m = object.match(re)
  if (!m) throw new ContractError(`${file}: meta.${key} is missing or not a string`)
  return unquote(m[1] ?? m[2] ?? m[3] ?? '')
}

/** `tags: ['a', 'b']` from the meta object. */
function readTags(object, file) {
  const m = object.match(/\btags\s*:\s*\[([\s\S]*?)\]/)
  if (!m) throw new ContractError(`${file}: meta.tags is missing`)
  const tags = []
  const re = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`/g
  let t
  while ((t = re.exec(m[1])) !== null) tags.push(unquote(t[1] ?? t[2] ?? t[3] ?? ''))
  return tags
}

function readMeta(source, file) {
  const object = extractMetaObject(source, file)
  const meta = {
    id: readStringField(object, 'id', file),
    title: readStringField(object, 'title', file),
    category: readStringField(object, 'category', file),
    tags: readTags(object, file),
  }
  if (!meta.id) throw new ContractError(`${file}: meta.id is empty`)
  if (!meta.title) throw new ContractError(`${file}: meta.title is empty`)
  if (meta.tags.length < 3 || meta.tags.length > 6) {
    throw new ContractError(`${file}: meta.tags must hold 3–6 words (has ${meta.tags.length})`)
  }
  return meta
}

/** `SpinnerArc` -> import identifier. Rejects names that cannot be identifiers. */
function componentName(file) {
  const base = file.replace(/\.tsx$/, '')
  if (!/^[A-Za-z_$][\w$]*$/.test(base)) {
    throw new ContractError(`${file}: file name is not a valid component identifier`)
  }
  return base
}

function pascal(s) {
  return s.replace(/(^|[-_])([a-z0-9])/g, (_, __, c) => c.toUpperCase())
}

function collect(root) {
  const elementsDir = join(root, ELEMENTS_DIR)
  let entries
  try {
    entries = readdirSync(elementsDir)
  } catch (err) {
    const e = new Error(`cannot read ${elementsDir}: ${err.message}`)
    e.code = 'EREAD'
    throw e
  }

  const elements = []
  const seen = new Map()
  for (const category of CATEGORIES) {
    const dir = join(elementsDir, category)
    let names
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.tsx'))
    } catch (err) {
      // A category with no folder yet is legitimate while the gallery is being
      // built out; only the elements root is required.
      if (err.code === 'ENOENT') continue
      throw err
    }
    names.sort()
    for (const name of names) {
      if (name.endsWith('.d.ts')) continue
      const full = join(dir, name)
      if (!statSync(full).isFile()) continue
      const source = readFileSync(full, 'utf8')
        .replace(/^﻿/, '')
        // Canonical text regardless of the checkout's line endings, so a
        // registry written on Windows and checked on Linux is identical.
        .replace(/\r\n/g, '\n')
      if (!/\bexport\s+default\b/.test(source)) {
        throw new ContractError(`${ELEMENTS_DIR}/${category}/${name}: no default export`)
      }
      const meta = readMeta(source, `${ELEMENTS_DIR}/${category}/${name}`)
      if (!CATEGORY_SET.has(meta.category)) {
        throw new ContractError(`${ELEMENTS_DIR}/${category}/${name}: unknown category "${meta.category}"`)
      }
      if (meta.category !== category) {
        throw new ContractError(
          `${ELEMENTS_DIR}/${category}/${name}: meta.category "${meta.category}" does not match its folder`,
        )
      }
      if (!meta.id.startsWith(`${category}-`) || meta.id.length <= category.length + 1) {
        throw new ContractError(`${ELEMENTS_DIR}/${category}/${name}: meta.id must be "${category}-<kebab-name>"`)
      }
      if (seen.has(meta.id)) {
        throw new ContractError(`${ELEMENTS_DIR}/${category}/${name}: duplicate id "${meta.id}" (also ${seen.get(meta.id)})`)
      }
      seen.set(meta.id, `${ELEMENTS_DIR}/${category}/${name}`)
      elements.push({
        category,
        component: componentName(name),
        importPath: `./${category}/${name.replace(/\.tsx$/, '')}`,
        meta,
        code: source,
      })
    }
  }
  return elements
}

function render(elements) {
  const lines = []
  lines.push('/**')
  lines.push(' * AUTO-GENERATED — do not edit.')
  lines.push(' *')
  lines.push(' * Written by `scripts/gen-elements.mjs` (`npm run gen:elements`). It scans')
  lines.push(' * src/elements/<category>/*.tsx, reads each file\'s `meta` and embeds the file')
  lines.push(' * source so the gallery can offer copy-ready code.')
  lines.push(` * ${elements.length} element${elements.length === 1 ? '' : 's'}.`)
  lines.push(' */')
  lines.push("import type { ElementEntry } from './types'")

  const imports = []
  for (const el of elements) {
    const base = `${pascal(el.category)}${el.component}`
    imports.push(`import ${base}, { meta as ${base}Meta } from '${el.importPath}'`)
  }
  if (imports.length) {
    lines.push('')
    lines.push(...imports)
  }

  lines.push('')
  lines.push('export const ELEMENTS: ElementEntry[] = [')
  for (const el of elements) {
    const base = `${pascal(el.category)}${el.component}`
    lines.push(`  { ...${base}Meta, Component: ${base}, code: ${JSON.stringify(el.code)} },`)
  }
  lines.push(']')
  lines.push('')
  return lines.join('\n')
}

function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`gen-elements: ${err.message}`)
    return 2
  }
  if (args.help) {
    console.log('usage: node scripts/gen-elements.mjs [--check] [--root <package-dir>]')
    return 0
  }

  let elements
  try {
    elements = collect(args.root)
  } catch (err) {
    if (err.code === 'EREAD') {
      console.error(`gen-elements: ${err.message}`)
      return 2
    }
    console.error(`gen-elements: ${err.message}`)
    return 2
  }

  let expected
  try {
    expected = render(elements)
  } catch (err) {
    console.error(`gen-elements: ${err.message}`)
    return 2
  }

  const outPath = join(args.root, REGISTRY_PATH)

  if (args.check) {
    if (!existsSync(outPath)) {
      console.error(`gen-elements: ${REGISTRY_PATH} is missing — run \`npm run gen:elements\``)
      return 1
    }
    const current = readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n')
    if (current !== expected) {
      console.error(`gen-elements: ${REGISTRY_PATH} is stale — run \`npm run gen:elements\``)
      return 1
    }
    console.log(`gen-elements: ${REGISTRY_PATH} is up to date (${elements.length} elements)`)
    return 0
  }

  writeFileSync(outPath, expected, 'utf8')
  console.log(`gen-elements: wrote ${REGISTRY_PATH} (${elements.length} elements)`)
  return 0
}

process.exit(main())
