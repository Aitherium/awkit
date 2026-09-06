'use client'

/**
 * The command line — the room's only input.
 *
 * There is no nav, so this one field carries three intents: say something,
 * address an agent with `@`, or summon a context surface with `/`. The palette
 * appears while you are typing a summons and steps aside the moment the token
 * is complete.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { matchAgents, matchSummons, parseInput, type Summons, type SummonsId } from './summons'
import Tooltip from '../../ui/Tooltip'

interface RoomComposerProps {
  agents: string[]
  busy?: boolean
  onSay: (text: string) => void
  onSummon: (summons: Summons, query: string) => void
  /**
   * Summons the host app cannot honour (e.g. 'on-device' with no worker
   * factory). Hidden from the palette so the list stays honest — a summons
   * that opens an empty shell is worse than one that does not exist.
   */
  hiddenSummons?: SummonsId[]
}

export default function RoomComposer({ agents, busy, onSay, onSummon, hiddenSummons }: RoomComposerProps) {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const summonsMatches = useMemo(
    () => matchSummons(value).filter((s) => !hiddenSummons?.includes(s.id)),
    [value, hiddenSummons],
  )
  const agentMatches = useMemo(() => matchAgents(value, agents), [value, agents])
  const options = summonsMatches.length ? summonsMatches : agentMatches
  const open = options.length > 0

  useEffect(() => { setCursor(0) }, [value])

  // Auto-grow, capped by CSS max-height.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const choose = (index: number) => {
    const picked = options[index]
    if (!picked) return
    const token = typeof picked === 'string' ? `@${picked}` : picked.token
    setValue(`${token} `)
    inputRef.current?.focus()
  }

  const submit = () => {
    const parsed = parseInput(value)
    if (!parsed.text && parsed.kind !== 'summon') return
    if (parsed.kind === 'summon' && parsed.summons) {
      onSummon(parsed.summons, parsed.text)
    } else {
      onSay(parsed.text)
    }
    setValue('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => (c + 1) % options.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => (c - 1 + options.length) % options.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        choose(cursor)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setValue('')
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const parsed = parseInput(value)
  const prompt =
    parsed.kind === 'summon' ? 'summon' :
    parsed.kind === 'address' ? `to ${parsed.agent}` :
    'say'

  return (
    <div className="room-command" data-tour="composer">
      {open && (
        <div className="room-palette" role="listbox" aria-label="Summons">
          {options.map((opt, i) => {
            const isAgent = typeof opt === 'string'
            return (
              <Tooltip
                key={isAgent ? opt : opt.id}
                label={isAgent ? `@${opt} answers directly` : opt.hint}
                block
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  data-kind={isAgent ? 'agent' : 'summons'}
                  className="room-palette-item"
                  onMouseDown={(e) => { e.preventDefault(); choose(i) }}
                >
                  <span className="room-palette-token">{isAgent ? `@${opt}` : opt.token}</span>
                  <span className="room-palette-label">{isAgent ? `Ask ${opt}` : opt.label}</span>
                  <span className="room-palette-hint">{isAgent ? 'answers directly' : opt.hint}</span>
                </button>
              </Tooltip>
            )
          })}
        </div>
      )}

      <div className="room-command-inner">
        <Tooltip label="Say something, or type / to summon documents, data, mail, the fleet — and /space for the universe">
          <span className="room-prompt">{prompt}</span>
        </Tooltip>
        <textarea
          ref={inputRef}
          className="room-input"
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Say something, @ an agent, or / to bring something in"
          aria-label="Say something in the room"
        />
        <button
          type="button"
          className="room-send"
          onClick={submit}
          disabled={!value.trim() || busy}
        >
          {busy ? 'Sending' : 'Send'}
        </button>
      </div>
    </div>
  )
}
