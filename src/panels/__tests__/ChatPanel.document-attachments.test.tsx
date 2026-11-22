/**
 * An assistant answer grounded in a whole document returns that document
 * (`documents` on the chat response / stream meta + done events). The chat
 * shows an "Open <file>" link to the tenant-scoped download route.
 * Regression: 2026-10-29, the owner: "it should also return the doc and let the
 * user open it."
 */
import { render, screen } from '@testing-library/react'
import { DocumentAttachments, documentAttachments } from '../ChatPanel'

const V7 = {
  doc_id: '48bf1aec-cb95-4519-9412-1ad894370bf1',
  filename: 'GARG_V7_transcript.docx',
  url: '/api/documents/48bf1aec-cb95-4519-9412-1ad894370bf1/download',
  label: 'Open GARG_V7_transcript.docx',
}

describe('DocumentAttachments', () => {
  it('renders an Open button linking to the document download route', () => {
    render(<DocumentAttachments documents={[V7]} />)
    const link = screen.getByRole('link', { name: /Open GARG_V7_transcript\.docx/ })
    expect(link.getAttribute('href')).toMatch(/\/api\/documents\/48bf1aec-cb95-4519-9412-1ad894370bf1\/download$/)
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('renders nothing without documents', () => {
    const { container } = render(<DocumentAttachments documents={[]} />)
    expect(container.innerHTML).toBe('')
    const none = render(<DocumentAttachments />)
    expect(none.container.innerHTML).toBe('')
  })
})

describe('documentAttachments', () => {
  it('drops malformed entries and links that leave the app API', () => {
    expect(documentAttachments([
      V7,
      { doc_id: 'x', filename: 'evil.docx', url: 'https://evil.example/x' },
      { filename: 'no-id.docx', url: '/api/documents/y/download' },
      null,
    ])).toEqual([V7])
    expect(documentAttachments(undefined)).toEqual([])
  })
})
