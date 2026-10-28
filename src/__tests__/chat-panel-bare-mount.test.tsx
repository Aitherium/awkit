/**
 * ChatPanel mounted BARE, the way the Veil tenant desktop's PanelApp renders it (no
 * conversationId, no onNewConversation). Live on a tenant desktop 2026-10-27 one
 * question got the answer twice: the stream committed the reply, then called the
 * missing onNewConversation, the TypeError landed in the stream's catch, and the
 * catch committed the reply a second time. Runs under AitherVeil's jest.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ChatPanel from '../panels/ChatPanel'

function sseResponse(events: object[]): Response {
  const text = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')
  const bytes = new TextEncoder().encode(text)
  let sent = false
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    json: async () => ({}),
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined }
          sent = true
          return { done: false, value: bytes }
        },
      }),
    },
  } as unknown as Response
}

function installFetch() {
  const turns: Array<{ conversation_id?: string }> = []
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/api/chat/aither') && init?.method === 'POST') {
      turns.push(JSON.parse(String(init.body)))
      return sseResponse([
        { type: 'meta', conversation_id: 'conv-1', sources: [] },
        { type: 'content', text: '4.' },
        { type: 'done', content: '4.', conversation_id: 'conv-1' },
      ])
    }
    if (u.includes('llm-health')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, usable: true }) } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
  })
  return turns
}

async function ask(text: string) {
  const box = screen.getByRole('textbox')
  fireEvent.change(box, { target: { value: text } })
  await act(async () => {
    fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' })
    for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0))
  })
}

describe('ChatPanel without a host (Veil PanelApp)', () => {
  beforeEach(() => {
    window.localStorage.setItem('app:chat-engine', 'aitherchat')
    ;(window as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame =
      (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('shows one answer for one question, and turn two continues the conversation', async () => {
    const turns = installFetch()
    await act(async () => { render(<ChatPanel />) })

    await ask('What is 2+2?')
    expect(screen.getAllByText('What is 2+2?')).toHaveLength(1)
    expect(screen.getAllByText('4.')).toHaveLength(1)

    await ask('And 3+3?')
    expect(turns).toHaveLength(2)
    expect(turns[0].conversation_id).toBeUndefined()
    expect(turns[1].conversation_id).toBe('conv-1')
  })
})
