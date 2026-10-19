/**
 * The phone layout's pure rules (studio-mobile.ts). Each one decides something a person
 * on a phone sees: which options exist, what one Generate tap sends, what the Options
 * button says, when the studio says the image service is down, how far the keyboard
 * pushes the prompt up, how many columns the results get.
 */
import {
  DEFAULT_SIZE, buildGenerateParams, gridColumns, isEngineDownCode, keyboardInset, optionFields,
  optionsSummary, saveName, serviceStatus, shortCost, sizePresets, sizeValues,
} from '../studio-mobile'
import type { CraftCatalogue, CraftOp } from '../craft-client'

const TXT2IMG: CraftOp = {
  name: 'txt2img', label: 'Generate', group: 'generate', summary: '', credits: 150, inputs: [],
  params: [
    { name: 'prompt', type: 'str' },
    { name: 'width', type: 'int', default: 1024, min: 256, max: 2048 },
    { name: 'height', type: 'int', default: 1024, min: 256, max: 2048 },
    { name: 'steps', type: 'int', default: 28, min: 1, max: 60, help: 'More steps, more detail, slower' },
    { name: 'seed', type: 'int', default: -1 },
    { name: 'model', type: 'str', default: 'auto', choices: ['auto', 'photo', 'anime'] },
    { name: 'count', type: 'int', default: 1, min: 1, max: 8 },
    { name: 'negative_prompt', type: 'str', default: '' },
    { name: 'hires', type: 'bool', default: false },
  ],
}

function catalogue(over: Partial<CraftCatalogue> = {}): CraftCatalogue {
  return {
    craft: { id: 'image-studio', name: 'Image Studio' }, live: true, ops: [TXT2IMG],
    shell_ops: { txt2img: true, inpaint: true, remove_bg: true, edit_instruct: false }, ...over,
  }
}

describe('sizePresets', () => {
  it('offers square, portrait and landscape when the op declares width and height', () => {
    const p = sizePresets(TXT2IMG)
    expect(p.map(s => s.id)).toEqual(['square', 'portrait', 'landscape'])
    expect(p[0]).toMatchObject({ label: 'Square', width: 1024, height: 1024 })
    expect(p[1].height).toBeGreaterThan(p[1].width)
    expect(p[2].width).toBeGreaterThan(p[2].height)
  })

  it('clamps every preset into the declared bounds', () => {
    const small: CraftOp = { ...TXT2IMG, params: [
      { name: 'width', type: 'int', min: 256, max: 768 }, { name: 'height', type: 'int', min: 256, max: 768 },
    ] }
    for (const s of sizePresets(small)) {
      expect(s.width).toBeLessThanOrEqual(768)
      expect(s.height).toBeLessThanOrEqual(768)
    }
  })

  it('offers nothing when the op has no size params (the server would refuse them)', () => {
    expect(sizePresets({ ...TXT2IMG, params: [{ name: 'prompt', type: 'str' }] })).toEqual([])
    expect(sizePresets(null)).toEqual([])
  })
})

describe('optionFields', () => {
  it('lists every declared knob except the prompt and the size pair, with a kind', () => {
    const f = optionFields(TXT2IMG)
    expect(f.map(x => x.name)).toEqual(['count', 'model', 'steps', 'seed', 'negative_prompt', 'hires'])
    expect(f.find(x => x.name === 'model')).toMatchObject({ kind: 'choice', choices: ['auto', 'photo', 'anime'], label: 'Model' })
    expect(f.find(x => x.name === 'steps')).toMatchObject({ kind: 'number', min: 1, max: 60, label: 'Steps' })
    expect(f.find(x => x.name === 'negative_prompt')).toMatchObject({ kind: 'text', label: 'Avoid' })
    expect(f.find(x => x.name === 'hires')).toMatchObject({ kind: 'toggle' })
    expect(f.find(x => x.name === 'count')).toMatchObject({ label: 'Images' })
  })

  it('never offers a media input or an unknown type', () => {
    const op: CraftOp = { ...TXT2IMG, params: [{ name: 'image', type: 'image' }, { name: 'blob', type: 'json' }, { name: 'lora', type: 'str' }] }
    expect(optionFields(op).map(x => x.name)).toEqual(['lora'])
    expect(optionFields(op)[0].label).toBe('LoRA')
  })
})

describe('buildGenerateParams', () => {
  it('sends only the prompt when nothing was changed: the server defaults apply', () => {
    expect(buildGenerateParams('  a fox  ', {}, TXT2IMG)).toEqual({ params: { prompt: 'a fox' } })
  })

  it('refuses an empty prompt without a request', () => {
    expect(buildGenerateParams('   ', {}, TXT2IMG)).toEqual({ refusal: 'Type what to make first.' })
  })

  it('sends changed options, drops defaults, blanks and undeclared keys', () => {
    const built = buildGenerateParams('a fox', {
      steps: 40, seed: -1, model: 'anime', negative_prompt: '', width: 832, height: 1216, sampler: 'x', hires: false,
    }, TXT2IMG)
    expect(built).toEqual({ params: { prompt: 'a fox', steps: 40, model: 'anime', width: 832, height: 1216 } })
  })

  it('clamps a typed number into the declared bounds and rounds an int', () => {
    expect(buildGenerateParams('a', { steps: 500 }, TXT2IMG)).toEqual({ params: { prompt: 'a', steps: 60 } })
    expect(buildGenerateParams('a', { steps: 12.7 }, TXT2IMG)).toEqual({ params: { prompt: 'a', steps: 13 } })
    expect(buildGenerateParams('a', { steps: 'abc' }, TXT2IMG)).toEqual({ params: { prompt: 'a' } })
  })

  it('works before the catalogue answered (only the prompt goes)', () => {
    expect(buildGenerateParams('a', { steps: 40 }, null)).toEqual({ params: { prompt: 'a' } })
  })
})

describe('sizeValues / optionsSummary', () => {
  it('maps a preset to its width and height', () => {
    expect(sizeValues('portrait', TXT2IMG)).toEqual({ width: 832, height: 1216 })
    expect(sizeValues('nope', TXT2IMG)).toEqual({})
  })

  it('reads in one glance: size, then count, then how many other knobs moved', () => {
    expect(DEFAULT_SIZE).toBe('square')
    expect(optionsSummary({}, TXT2IMG)).toBe('Square')
    expect(optionsSummary({ width: 1216, height: 832 }, TXT2IMG)).toBe('Landscape')
    expect(optionsSummary({ width: 1216, height: 832, count: 4 }, TXT2IMG)).toBe('Landscape · 4 images')
    expect(optionsSummary({ count: 2, steps: 40, model: 'anime' }, TXT2IMG)).toBe('Square · 2 images · +2')
    expect(optionsSummary({ width: 700, height: 300 }, TXT2IMG)).toBe('700×300')
  })

  it('says Options when the op has nothing to set', () => {
    expect(optionsSummary({}, { ...TXT2IMG, params: [{ name: 'prompt', type: 'str' }] })).toBe('Options')
  })
})

describe('serviceStatus', () => {
  it('is ready when the catalogue says the engine serves txt2img', () => {
    expect(serviceStatus(catalogue(), null, null).state).toBe('ready')
  })

  it('is offline when the engine is not live or does not serve generation', () => {
    expect(serviceStatus(catalogue({ live: false }), null, null)).toMatchObject({ state: 'offline' })
    expect(serviceStatus(catalogue({ shell_ops: { txt2img: false } }), null, null).state).toBe('offline')
    expect(serviceStatus(catalogue(), null, null).text).toBe('')
    expect(serviceStatus(catalogue({ live: false }), null, null).text).toMatch(/offline/i)
  })

  it('is offline when the studio did not load, in the server words', () => {
    const s = serviceStatus(null, 'The studio did not answer (TypeError: fetch failed).', null)
    expect(s.state).toBe('offline')
    expect(s.text).toMatch(/did not answer/)
  })

  it('is busy after a run the engine could not take, and ready again after a success', () => {
    expect(serviceStatus(catalogue(), null, { ok: false, error_code: 'engine_unavailable', credits_charged: 0, media: [] }).state).toBe('busy')
    expect(serviceStatus(catalogue(), null, { ok: false, error_code: 'engine_unavailable', credits_charged: 0, media: [] }).text)
      .toMatch(/busy or offline.*Nothing was charged/)
    const silent = serviceStatus(catalogue(), null, { ok: false, transport: true, credits_charged: 0, media: [] })
    expect(silent.state).toBe('busy')
    // A run that never answered may still finish: never claim nothing was charged.
    expect(silent.text).toMatch(/did not answer/)
    expect(silent.text).not.toMatch(/Nothing was charged/)
    expect(serviceStatus(catalogue(), null, { ok: true, credits_charged: 1, media: [] }).state).toBe('ready')
    // A refusal that is about the CALLER (credits) is not the engine being down.
    expect(serviceStatus(catalogue(), null, { ok: false, error_code: 'insufficient_credits', credits_charged: 0, media: [] }).state).toBe('ready')
  })

  it('is loading before the catalogue answers', () => {
    expect(serviceStatus(null, null, null).state).toBe('loading')
  })
})

describe('isEngineDownCode', () => {
  it('names the engine-side failure codes', () => {
    for (const c of ['engine_unavailable', 'engine_busy', 'engine_error', 'engine_timeout', 'timeout', 'gpu_unavailable']) {
      expect(isEngineDownCode(c)).toBe(true)
    }
    for (const c of ['insufficient_credits', 'territory', 'bad_params', undefined]) expect(isEngineDownCode(c)).toBe(false)
  })
})

describe('keyboardInset', () => {
  it('is how much of the layout the on-screen keyboard covers', () => {
    expect(keyboardInset(844, 844, 0)).toBe(0)
    expect(keyboardInset(844, 508, 0)).toBe(336)
    expect(keyboardInset(844, 508, 20)).toBe(316)
  })

  it('ignores toolbar wobble under 80 px and never goes negative', () => {
    expect(keyboardInset(844, 790, 0)).toBe(0)
    expect(keyboardInset(844, 900, 0)).toBe(0)
    expect(keyboardInset(0, 0, 0)).toBe(0)
  })
})

describe('gridColumns', () => {
  it('two big tiles on a phone, more as the window widens', () => {
    expect(gridColumns(0)).toBe(2)
    expect(gridColumns(390)).toBe(2)
    expect(gridColumns(600)).toBe(3)
    expect(gridColumns(844)).toBe(4)
  })
})

describe('saveName', () => {
  it('names the file after the image and its real type', () => {
    expect(saveName({ id: 7, op: 'txt2img' }, 'image/png')).toBe('aither-image-7.png')
    expect(saveName({ id: 7, op: 'txt2img' }, 'image/jpeg')).toBe('aither-image-7.jpg')
    expect(saveName({ id: 7, op: 'txt2img' }, 'image/webp')).toBe('aither-image-7.webp')
    expect(saveName({ id: 7, op: 'remove_bg' }, '')).toBe('aither-image-7.png')
  })
})

describe('shortCost', () => {
  it('is a few words a phone can show next to Generate', () => {
    expect(shortCost({ ok: true, credits: 150, units: 1 }, 150)).toBe('150 credits')
    expect(shortCost({ ok: true, credits: 0 }, 150)).toBe('Free')
    expect(shortCost(null, 150)).toBe('from 150 credits')
    expect(shortCost(null, null)).toBe('')
    expect(shortCost({ ok: false, error: 'Not sold in your region.' }, 150)).toBe('Not sold in your region.')
  })
})
