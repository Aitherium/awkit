/**
 * ModelBrowser: image and voice models are discoverable, and every card states
 * its licence (tenant ask 2026-10-28: the tenant downloads image/voice/vision models
 * onto its own appliance the way it does language models).
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import ModelBrowser, { KNOWN_CATEGORIES, categoryOptions, formatBytes } from '../ModelBrowser'

describe('ModelBrowser media categories', () => {
  it('always offers image and voice, then any extra category the data has', () => {
    expect(KNOWN_CATEGORIES).toEqual(expect.arrayContaining(['image', 'voice', 'vision']))
    const opts = categoryOptions([{ category: 'chat' }, { category: 'orchestrator' }])
    expect(opts.slice(0, KNOWN_CATEGORIES.length)).toEqual(KNOWN_CATEGORIES)
    expect(opts).toContain('orchestrator')
    expect(new Set(opts).size).toBe(opts.length)
  })

  it('formats download sizes in decimal units', () => {
    expect(formatBytes(9731112222)).toBe('9.7 GB')
    expect(formatBytes(330000000)).toBe('330.0 MB')
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(null)).toBe('')
  })

  it('shows the licence and the download command on appliance cards', async () => {
    const models = [
      {
        id: 'kokoro-82m', name: 'Kokoro 82M (text-to-speech)', provider: 'hexgrad',
        category: 'voice', subcategory: 'tts', parameters: '', vram_gb: 0,
        context_length: 0, license: 'Apache-2.0', description: '', source: 'appliance',
        status: 'downloadable', size_bytes: 330341000,
        download_command: 'bash models/fetch-models.sh --model kokoro-82m',
      },
      {
        id: 'mystery', name: 'Mystery', provider: 'x', category: 'chat', parameters: '',
        vram_gb: 0, context_length: 0, license: '', description: '', source: 'platform',
      },
    ]
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ models, platform_available: false }),
    })
    ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock

    render(<ModelBrowser hardwareProfile="none" />)

    await waitFor(() => expect(screen.getByText('Kokoro 82M (text-to-speech)')).toBeTruthy())
    const licences = screen.getAllByTestId('model-license').map(n => n.textContent)
    expect(licences).toEqual(['Licence: Apache-2.0', 'Licence: not recorded'])
    expect(screen.getByText('bash models/fetch-models.sh --model kokoro-82m')).toBeTruthy()
    expect(screen.getByText('Text to speech')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toMatch(/platform catalog is unreachable/)
  })
})
