/**
 * The Sprite reads its own lines aloud only when it may: the guardian's lock, the Sprite's
 * chat-off switch (always wins) and the child's own mute (only while unlocked). The
 * voice is the tutor's /me/say door, so the child never names a voice. Runs under
 * AitherVeil's jest (its roots include awkit/src).
 */
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  QUIET_RULE, asVoiceRule, childMayToggle, readChildMuted, spriteMaySpeak, writeChildMuted,
} from '../panels/spriteVoice'

const spoken: string[] = []
jest.mock('../panels/learnVoice', () => ({
  createLearnVoice: () => Object.assign((t: string) => { spoken.push(t) }, { prefetch: () => undefined }),
}))

// eslint-disable-next-line import/first
import KidQuestPanel from '../panels/KidQuestPanel'

describe('spriteVoice rules', () => {
  it('chat-off and a muted lock silence it; an on lock overrides the child mute', () => {
    expect(spriteMaySpeak({ lock: 'none', chatOff: false }, false)).toBe(true)
    expect(spriteMaySpeak({ lock: 'none', chatOff: false }, true)).toBe(false)
    expect(spriteMaySpeak({ lock: 'on', chatOff: false }, true)).toBe(true)
    expect(spriteMaySpeak({ lock: 'muted', chatOff: false }, false)).toBe(false)
    expect(spriteMaySpeak({ lock: 'on', chatOff: true }, false)).toBe(false)
    expect(childMayToggle({ lock: 'none', chatOff: false })).toBe(true)
    expect(childMayToggle({ lock: 'on', chatOff: false })).toBe(false)
  })

  it('anything unexpected from the server is the quiet rule', () => {
    expect(asVoiceRule(null)).toEqual(QUIET_RULE)
    expect(asVoiceRule({ voice: { lock: 'loud' } })).toEqual({ lock: 'muted', chatOff: false })
    expect(asVoiceRule({ voice: { lock: 'none', chat_off: true } })).toEqual({ lock: 'none', chatOff: true })
  })

  it('the child mute is a per-device setting', () => {
    writeChildMuted(true)
    expect(readChildMuted()).toBe(true)
    writeChildMuted(false)
    expect(readChildMuted()).toBe(false)
  })
})

const ITEM = { item_id: 'it-1', skill_id: 'm', tts_text: 'What is 8 plus 5?', prompt_text: '8 + 5 = ?', input: 'number' }

function installFetch(lock: string, chatOff = false) {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    let r: { status: number; body: unknown } = { status: 404, body: {} }
    if (url.endsWith('/me')) r = { status: 200, body: { alias: 'X', grade: 2, choices: ['space'] } }
    else if (url.endsWith('/me/sprite-body')) r = { status: 200, body: { granted: false, voice: { lock, chat_off: chatOff } } }
    else if (url.endsWith('/me/quest/start')) r = { status: 200, body: { quest_id: 'q1', items_total: 2, item: ITEM } }
    else if (url.endsWith('/me/quest/q1/answer')) {
      r = { status: 200, body: { feedback: 'yay', say: 'Yay!', next_item: ITEM, break: false, done: false,
        progress: { done: 1, total: 2 }, sprite_event: { say: 'I learned make-ten!' } } }
    }
    return { status: r.status, ok: r.status < 300, json: async () => r.body } as unknown as Response
  })
}

async function answerOnce() {
  await screen.findByTestId('home-screen')
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^start (?!my lesson)/i })[0]) })
  await screen.findByTestId('item-screen')
  for (const ch of '13') fireEvent.click(screen.getByRole('button', { name: ch }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'go' })) })
  await screen.findByTestId('sprite-event')
}

describe('KidQuestPanel reads the Sprite line', () => {
  beforeEach(() => { spoken.length = 0; writeChildMuted(false) })

  it('speaks it after the feedback when the guardian lets the Sprite talk', async () => {
    installFetch('on')
    render(<KidQuestPanel apiBase="/api/tutor" />)
    await answerOnce()
    await waitFor(() => expect(spoken).toContain('Yay!. I learned make-ten!'))
  })

  it('stays quiet for a muted lock, for chat-off, and for the child mute', async () => {
    for (const [lock, chatOff, childMute] of [['muted', false, false], ['on', true, false], ['none', false, true]] as const) {
      spoken.length = 0
      writeChildMuted(childMute)
      installFetch(lock, chatOff)
      const view = render(<KidQuestPanel apiBase="/api/tutor" />)
      await answerOnce()
      await waitFor(() => expect(spoken).toContain('Yay!'))
      expect(spoken.join(' ')).not.toContain('make-ten')
      view.unmount()
    }
  })
})
