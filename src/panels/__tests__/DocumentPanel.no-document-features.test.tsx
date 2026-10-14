/**
 * A tenant backend that does not advertise document_projects /
 * document_versions in /api/config/embed `features` (most host apps)
 * ignores project= and on_duplicate=, so the panel offers neither: no project
 * field, no Replace / Keep both on a same-name 409, no background flag.
 * Separate file so useConfig's module-level cache starts empty.
 */
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'

import DocumentPanel from '../DocumentPanel'

function mockFetch() {
  const forms: FormData[] = []
  ;(global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    const u = String(url)
    const reply = (status: number, body: unknown) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body })
    if (u.endsWith('/api/config/embed')) return reply(200, { accepted_types: ['.pdf', '.txt'], features: ['upload', 'chat'] })
    if (u.endsWith('/api/documents') && method === 'GET') return reply(200, [])
    if (u.endsWith('/api/documents/upload')) {
      forms.push(init?.body as FormData)
      return reply(409, { detail: "Document 'Script.pdf' already exists." })
    }
    return reply(404, { detail: 'not mocked' })
  })
  return forms
}

describe('DocumentPanel on a backend without document features', () => {
  it('shows no project field and no Replace / Keep both', async () => {
    const forms = mockFetch()
    render(<DocumentPanel />)
    await screen.findByText(/PDF, TXT, up to 90 MB per file/)
    expect(screen.queryByTestId('document-project-input')).toBeNull()

    fireEvent.drop(screen.getByTestId('document-dropzone'), { dataTransfer: { files: [new File(['x'], 'Script.pdf')] } })
    const results = await screen.findByTestId('upload-results')
    await within(results).findByText(/already exists/)
    expect(within(results).queryByText('Replace')).toBeNull()
    expect(within(results).queryByText('Keep both')).toBeNull()
    expect(forms[0].get('background')).toBeNull()
    expect(forms[0].get('project')).toBeNull()
  })
})
