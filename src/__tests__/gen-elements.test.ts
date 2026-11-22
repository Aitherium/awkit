// @vitest-environment node
/**
 * scripts/gen-elements.mjs — the registry must be exactly what is on disk.
 *
 * A stale registry means the gallery renders an element that no longer exists,
 * or omits one that does; a broken element file must stop the generator with
 * "could not judge" (exit 2), never silently produce a partial registry.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../../scripts/gen-elements.mjs')

const PROBE = (id: string) => `import type { ElementMeta } from '../types'

export const meta: ElementMeta = {
  id: '${id}',
  title: 'Probe Button',
  category: 'buttons',
  tags: ['probe', 'button', 'test'],
}

const css = \`.awk-el-${id} { color: var(--text-primary); }\`

export default function Probe(): JSX.Element {
  return <div className={\`awk-el-${id}\`}><style>{css}</style><button type="button">Probe</button></div>
}
`

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'awk-elements-'))
  roots.push(root)
  mkdirSync(join(root, 'src', 'elements', 'buttons'), { recursive: true })
  return root
}

function run(root: string, ...flags: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...flags, '--root', root], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

describe('gen-elements', () => {
  it('the committed registry is fresh', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('--check passes right after a write and names the element count', () => {
    const root = makeRoot()
    writeFileSync(join(root, 'src', 'elements', 'buttons', 'ProbeButton.tsx'), PROBE('buttons-probe-button'))

    const wrote = run(root)
    expect(wrote.status).toBe(0)
    expect(wrote.stdout).toContain('1 element')

    const registry = readFileSync(join(root, 'src', 'elements', 'registry.generated.ts'), 'utf8')
    expect(registry).toContain("import ButtonsProbeButton, { meta as ButtonsProbeButtonMeta } from './buttons/ProbeButton'")
    expect(registry).toContain('Component: ButtonsProbeButton')
    // The code field is the file's exact source (JSON.stringify of the contents).
    expect(registry).toContain(JSON.stringify(PROBE('buttons-probe-button').replace(/^﻿/, '')))

    const checked = run(root, '--check')
    expect(checked.status).toBe(0)
    expect(checked.stdout).toContain('up to date')
  })

  it('--check exits 1 when an element file changes after the registry was written', () => {
    const root = makeRoot()
    const file = join(root, 'src', 'elements', 'buttons', 'ProbeButton.tsx')
    writeFileSync(file, PROBE('buttons-probe-button'))
    expect(run(root).status).toBe(0)

    writeFileSync(file, `${PROBE('buttons-probe-button')}\n// a later edit\n`)
    const checked = run(root, '--check')
    expect(checked.status).toBe(1)
    expect(checked.stderr).toContain('is stale')
  })

  it('--check exits 1 when the registry is missing', () => {
    const root = makeRoot()
    writeFileSync(join(root, 'src', 'elements', 'buttons', 'ProbeButton.tsx'), PROBE('buttons-probe-button'))
    const checked = run(root, '--check')
    expect(checked.status).toBe(1)
    expect(checked.stderr).toContain('is missing')
  })

  it('exits 2 when the elements folder cannot be read', () => {
    const root = makeRoot()
    rmSync(join(root, 'src', 'elements'), { recursive: true, force: true })
    expect(existsSync(join(root, 'src', 'elements'))).toBe(false)
    const result = run(root, '--check')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('cannot read')
  })

  it('rejects an element whose meta breaks the contract', () => {
    const root = makeRoot()
    // category 'loaders' in the buttons folder
    writeFileSync(
      join(root, 'src', 'elements', 'buttons', 'WrongFolder.tsx'),
      PROBE('loaders-wrong-folder').replace("category: 'buttons'", "category: 'loaders'"),
    )
    const result = run(root)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('does not match its folder')
  })
})
