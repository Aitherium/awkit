/**
 * RETIRED_PANELS: a panel id that was retired into another surface answers with
 * where its job went, and is not also a live registry entry.
 */
import {
  PANEL_REGISTRY, RETIRED_PANELS, getPanelById, getRetiredPanel, resolvePanelIds, retiredPanelHref,
} from '../panels/registry'

describe('retired panels', () => {
  it('the Academy lesson studio is retired into Aither Classroom', () => {
    const gone = getRetiredPanel('academy-lesson-studio')
    expect(gone).toBeDefined()
    expect(gone?.to).toBe('/classroom')
    expect(gone?.successor).toBe('Aither Classroom')
    expect(getPanelById('academy-lesson-studio')).toBeUndefined()
  })

  it('a retired id is never also a live registry entry', () => {
    const live = new Set(PANEL_REGISTRY.map(p => p.id))
    expect(Object.keys(RETIRED_PANELS).filter(id => live.has(id))).toEqual([])
  })

  it('every retirement names a route, a public door, the old name, a successor and what moved', () => {
    for (const [id, r] of Object.entries(RETIRED_PANELS)) {
      expect([id, r.to.startsWith('/'), /^https:\/\/[a-z0-9.-]+$/.test(r.door), r.was.length > 0, r.successor.length > 0, r.note.length > 20])
        .toEqual([id, true, true, true, true, true])
    }
  })

  describe('resolvePanelIds: what a host list of ids becomes', () => {
    const all = () => true

    it('a retired id is kept as retired, never dropped and never active', () => {
      const r = resolvePanelIds(['academy-lessons', 'academy-lesson-studio', 'academy-analytics'], all)
      expect(r).toEqual({
        active: ['academy-lessons', 'academy-analytics'],
        retired: ['academy-lesson-studio'],
        dropped: [],
      })
    })

    it('an unknown id and an Object.prototype key are dropped, not retired', () => {
      const r = resolvePanelIds(['no-such-panel', 'constructor', 'chat'], all)
      expect(r).toEqual({ active: ['chat'], retired: [], dropped: ['no-such-panel', 'constructor'] })
    })

    it('a registered id with no component is dropped', () => {
      const r = resolvePanelIds(['chat', 'academy-lessons'], (id) => id !== 'chat')
      expect(r).toEqual({ active: ['academy-lessons'], retired: [], dropped: ['chat'] })
    })

    it('every id lands in exactly one list, once, in order', () => {
      const ids = ['academy-lesson-studio', 'chat', 'chat', 'nope', 'academy-lesson-studio', 'dashboard']
      const r = resolvePanelIds(ids, all)
      expect(r).toEqual({ active: ['chat', 'dashboard'], retired: ['academy-lesson-studio'], dropped: ['nope'] })
      expect([...r.active, ...r.retired, ...r.dropped].sort()).toEqual([...new Set(ids)].sort())
    })

    it('a host with only a retired id still has something to show', () => {
      expect(resolvePanelIds(['academy-lesson-studio'], all).retired).toEqual(['academy-lesson-studio'])
    })
  })

  describe('retiredPanelHref: a link a person can follow on this host', () => {
    const gone = RETIRED_PANELS['academy-lesson-studio']

    it('is the public door when the host says nothing', () => {
      expect(retiredPanelHref(gone)).toBe('https://academy.aitherium.com')
      expect(retiredPanelHref(gone, null)).toBe(gone.door)
      expect(retiredPanelHref(gone, '')).toBe(gone.door)
    })

    it('is the host route when the host serves the successor', () => {
      expect(retiredPanelHref(gone, '/classroom')).toBe('/classroom')
      expect(retiredPanelHref(gone, 'https://school.example/classroom')).toBe('https://school.example/classroom')
    })

    it('never becomes a script or protocol-relative link', () => {
      for (const bad of ['javascript:alert(1)', '//evil.example', 'classroom', 'data:text/html,x']) {
        expect([bad, retiredPanelHref(gone, bad)]).toEqual([bad, gone.door])
      }
    })
  })

  it('a live id, an unknown id and an Object.prototype key are not retired', () => {
    expect(getRetiredPanel('academy-lessons')).toBeUndefined()
    expect(getRetiredPanel('no-such-panel')).toBeUndefined()
    expect(getRetiredPanel('constructor')).toBeUndefined()
    expect(getRetiredPanel('toString')).toBeUndefined()
  })

  it('no live panel is named Classroom unless it talks to the Classroom API', () => {
    const wrong = PANEL_REGISTRY
      .filter(p => /classroom/i.test(p.name) && !/^\/api\/(v1\/)?classroom/.test(p.apiPrefix ?? ''))
      .map(p => [p.id, p.name])
    expect(wrong).toEqual([])
  })
})
