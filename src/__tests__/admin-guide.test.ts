/**
 * AdminGuide: the variant filter, the sanitizer and the error state.
 *
 * Each rule is pinned in both directions: acme-only content must be hidden for
 * awnix AND shown for acme-appliance, because a filter that hides everything
 * passes the first half alone.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import AdminGuideSurface from '../surfaces/AdminGuide/AdminGuideSurface'
import {
  filterHtmlForVariant, sanitizeGuideHtml, searchGuide, validateGuide, viewForVariant,
  type GuideJson,
} from '../surfaces/AdminGuide/useAdminGuide'

const guide: GuideJson = {
  version: 1,
  public: false,
  variants: ['awnix', 'acme-appliance'],
  chapters: [
    {
      id: '06-updates', title: 'Updates', applies_to: ['awnix', 'acme-appliance'],
      html: '<h2 id="how">How updates work</h2><p>Signed images.</p>'
        + '<section data-variants="acme-appliance"><h2 id="acme">On the acme appliance</h2><p>acme-update shim.</p></section>'
        + '<p>Everyone.</p>',
      headings: [
        { id: 'how', text: 'How updates work', level: 2, variants: [] },
        { id: 'acme', text: 'On the acme appliance', level: 2, variants: ['acme-appliance'] },
      ],
    },
    {
      id: '10-acme-appliance', title: 'The acme appliance', applies_to: ['acme-appliance'],
      html: '<p>Three daemons.</p>', headings: [],
    },
  ],
  man: [
    { name: 'awnix', section: '8', summary: 'the admin command', applies_to: ['awnix', 'acme-appliance'],
      status: 'live', html: '<p>awnix</p>', verbs: ['update', 'doctor'] },
    { name: 'acme-model', section: '8', summary: 'choose the model', applies_to: ['acme-appliance'],
      status: 'live', html: '<p>tiers</p>', verbs: ['list', 'set'] },
  ],
}

describe('variant filter', () => {
  it('hides acme-only chapters, pages and sections for awnix', () => {
    const v = viewForVariant(guide, 'awnix')
    expect(v.chapters.map((c) => c.id)).toEqual(['06-updates'])
    expect(v.man.map((m) => m.name)).toEqual(['awnix'])
    expect(v.chapters[0].html).not.toContain('acme-update shim')
    expect(v.chapters[0].html).toContain('Everyone.')
    expect(v.chapters[0].headings.map((h) => h.id)).toEqual(['how'])
  })

  it('shows them for acme-appliance', () => {
    const v = viewForVariant(guide, 'acme-appliance')
    expect(v.chapters.map((c) => c.id)).toEqual(['06-updates', '10-acme-appliance'])
    expect(v.man.map((m) => m.name)).toEqual(['awnix', 'acme-model'])
    expect(v.chapters[0].html).toContain('acme-update shim')
  })

  it('keeps everything for "all"', () => {
    expect(filterHtmlForVariant(guide.chapters[0].html, 'all')).toBe(guide.chapters[0].html)
  })

  it('search only finds what the variant can see', () => {
    expect(searchGuide(viewForVariant(guide, 'awnix'), 'acme')).toEqual([])
    const hits = searchGuide(viewForVariant(guide, 'acme-appliance'), 'acme')
    expect(hits.some((h) => h.doc === 'man/acme-model.8')).toBe(true)
    expect(hits.some((h) => h.anchor === 'acme')).toBe(true)
  })
})

describe('sanitizer', () => {
  it('strips <script> with its content', () => {
    const out = sanitizeGuideHtml('<p>ok</p><script>alert(1)</script><p>after</p>')
    expect(out).toBe('<p>ok</p><p>after</p>')
  })

  it('strips on* handlers, style and javascript: links', () => {
    const out = sanitizeGuideHtml(
      '<p onclick="x()" style="color:red" class="awman-note">a</p><a href="javascript:alert(1)" onmouseover="y">b</a><img src=x onerror=alert(1)>')
    expect(out).toBe('<p class="awman-note">a</p><a>b</a>')
    expect(out).not.toMatch(/on[a-z]+=/i)
  })

  it('keeps the tags awman emits', () => {
    const html = '<h2 id="x">T</h2><section data-variants="acme-appliance"><dl><dt><code>a</code></dt><dd>b</dd></dl></section>'
      + '<pre><code>sudo awnix update check</code></pre><a href="https://example.com/">l</a>'
    expect(sanitizeGuideHtml(html)).toBe(html)
  })

  it('leaves the committed public guide unchanged except for nothing unsafe', () => {
    const path = resolve(__dirname, '../../../../AitherVeil/public/docs/awnix/guide.json')
    const pub = JSON.parse(readFileSync(path, 'utf-8')) as GuideJson
    expect(validateGuide(pub).ok).toBe(true)
    for (const c of pub.chapters) expect(sanitizeGuideHtml(c.html)).toBe(c.html)
    expect(JSON.stringify(pub)).not.toMatch(/acme|aitheros|awnix-desktop/i)
  })
})

describe('error state', () => {
  it('an unknown guide.json version is an error, not a blank page', () => {
    const v = validateGuide({ ...guide, version: 2 })
    expect(v.ok).toBe(false)
    const html = renderToStaticMarkup(createElement(AdminGuideSurface, { source: { ...guide, version: 2 } }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('unsupported guide.json version 2')
  })

  it('a valid inline guide renders its first chapter', () => {
    const html = renderToStaticMarkup(createElement(AdminGuideSurface, { source: guide, variant: 'awnix' }))
    expect(html).toContain('How updates work')
    expect(html).not.toContain('acme-update shim')
  })
})
