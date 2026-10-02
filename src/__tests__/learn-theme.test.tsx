/**
 * Aither Learn tokens: every colour exists in BOTH themes, and a key screen (the
 * guardian console) renders in each theme with every `var(--al-*)` it uses
 * defined on its root. Also: the guardian files paint only through the tokens
 * (no colour literal that would exist in one theme only).
 */
import React from 'react'
import fs from 'fs'
import path from 'path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import FamilyTutorConsolePanel from '../panels/FamilyTutorConsolePanel'
import KidQuestPanel from '../panels/KidQuestPanel'
import { LEARN_MODE_KEY, LEARN_TOKENS, LEARN_TOKEN_KEYS, learnVarName, learnVars } from '../panels/learnTheme'

function installFetch() {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    const body = url.endsWith('/family/learners')
      ? [{ lid: 'l-a', alias: 'Athena', grade: 1, age_band: '6-7', claimed: true, user_id: 'u-a', sprite: { name: 'Pip', species: 'owl', level: 2 } }]
      : url.includes('/report') ? { minutes: 12, sessions: 2, attempts: 20 } : {}
    return { status: 200, ok: true, json: async () => body } as unknown as Response
  })
}

/** Every `--al-*` name referenced anywhere in the rendered DOM's inline styles and <style> text. */
function referencedVars(root: HTMLElement): Set<string> {
  const out = new Set<string>()
  const scan = (s: string) => { for (const m of s.matchAll(/var\((--al-[a-z-]+)/g)) out.add(m[1]) }
  root.querySelectorAll('[style]').forEach((el) => scan(el.getAttribute('style') || ''))
  root.querySelectorAll('style').forEach((el) => scan(el.textContent || ''))
  return out
}

describe('Aither Learn tokens', () => {
  it('defines every colour in both themes, with nothing empty', () => {
    expect(Object.keys(LEARN_TOKENS.light).sort()).toEqual(Object.keys(LEARN_TOKENS.dark).sort())
    for (const mode of ['dark', 'light'] as const) {
      for (const k of LEARN_TOKEN_KEYS) expect(String(LEARN_TOKENS[mode][k]).trim()).not.toBe('')
    }
    // The family values the brief pins.
    expect(LEARN_TOKENS.dark).toMatchObject({ ground: '#050507', ink: '#EDEFF5', accent: '#5EC9CC', amber: '#D4872B' })
    expect(LEARN_TOKENS.light).toMatchObject({ ground: '#F6F7F9', surface: '#FFFFFF', ink: '#0E1116', accent: '#1E9EA2', amber: '#B86E16' })
  })

  it.each(['dark', 'light'] as const)('renders the guardian console in %s with every token it uses defined', async (mode) => {
    window.localStorage.setItem(LEARN_MODE_KEY, mode)
    installFetch()
    render(<FamilyTutorConsolePanel apiBase="/api/tutor" />)
    await screen.findByText('Athena')
    const root = screen.getByTestId('family-tutor-console')
    expect(root.getAttribute('data-learn-theme')).toBe(mode)
    for (const k of LEARN_TOKEN_KEYS) {
      expect(root.style.getPropertyValue(learnVarName(k))).toBe(LEARN_TOKENS[mode][k])
    }
    // Open a sheet too: it carries the variables itself.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Advanced/ })) })
    const defined = new Set(LEARN_TOKEN_KEYS.map(learnVarName))
    const missing = [...referencedVars(document.body)].filter((v) => !defined.has(v))
    expect(missing).toEqual([])
    window.localStorage.removeItem(LEARN_MODE_KEY)
  })

  it.each(['dark', 'light'] as const)('renders the kid home in %s with every token defined on its root', async (mode) => {
    window.localStorage.setItem(LEARN_MODE_KEY, mode)
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
      const body = url.endsWith('/me') ? { alias: 'Athena', grade: 1, choices: ['space', 'ocean'] } : {}
      return { status: url.endsWith('/me') ? 200 : 404, ok: url.endsWith('/me'), json: async () => body } as unknown as Response
    })
    render(<KidQuestPanel apiBase="/api/tutor" />)
    await screen.findByTestId('home-screen')
    const root = screen.getByTestId('kid-quest-panel')
    expect(root.getAttribute('data-learn-theme')).toBe(mode)
    for (const k of LEARN_TOKEN_KEYS) {
      expect(root.style.getPropertyValue(learnVarName(k))).toBe(LEARN_TOKENS[mode][k])
    }
    window.localStorage.removeItem(LEARN_MODE_KEY)
  })

  it('the switch flips the theme and persists the choice', async () => {
    window.localStorage.removeItem(LEARN_MODE_KEY)
    installFetch()
    render(<FamilyTutorConsolePanel apiBase="/api/tutor" />)
    await screen.findByText('Athena')
    fireEvent.click(screen.getByRole('button', { name: 'light' }))
    expect(screen.getByTestId('family-tutor-console').getAttribute('data-learn-theme')).toBe('light')
    expect(window.localStorage.getItem(LEARN_MODE_KEY)).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: 'auto' }))
    expect(window.localStorage.getItem(LEARN_MODE_KEY)).toBeNull()
  })

  it('learnVars writes one variable per token', () => {
    const v = learnVars('light') as Record<string, string>
    for (const k of LEARN_TOKEN_KEYS) expect(v[learnVarName(k)]).toBe(LEARN_TOKENS.light[k])
  })

  it('every token a Learn file names exists (jsdom drops var() colours, so this reads the sources)', () => {
    const dir = path.join(__dirname, '..', 'panels')
    const files = fs.readdirSync(dir).filter((f) => /^(learn|Family|Kid|Tutor|Academy|LearnerSprite)/.test(f) && f.endsWith('.tsx'))
    const keys = new Set<string>(LEARN_TOKEN_KEYS)
    const names = new Set<string>(LEARN_TOKEN_KEYS.map(learnVarName))
    const bad: string[] = []
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      if (!/from '\.\/learnTheme'/.test(src) && f !== 'learnTheme.tsx') continue
      for (const m of src.matchAll(/\bC\.([A-Za-z]+)/g)) if (!keys.has(m[1])) bad.push(`${f}: C.${m[1]}`)
      for (const m of src.matchAll(/var\((--al-[a-z-]+)/g)) if (!names.has(m[1])) bad.push(`${f}: ${m[1]}`)
    }
    expect(files.length).toBeGreaterThan(3)
    expect(bad).toEqual([])
  })

  it('Learn files paint only through the tokens', () => {
    const dir = path.join(__dirname, '..', 'panels')
    const files = [
      'FamilyTutorConsolePanel.tsx', 'learnParts.tsx', 'TutorFocusCard.tsx', 'FamilyMessagesSection.tsx', 'AcademyMirrorCard.tsx',
      'KidQuestPanel.tsx', 'KidInboxCard.tsx', 'LearnerSprite.tsx', 'FamilySpaceCard.tsx',
    ]
    const offenders: string[] = []
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
      src.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
