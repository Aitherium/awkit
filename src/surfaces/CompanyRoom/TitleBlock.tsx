'use client'

/**
 * The title block — where a drawing signs itself.
 *
 * Holds who is present (people and the agents rostered to speak up), the
 * ambient tuning stated in plain numbers, and whatever a summons brought back.
 * It is the only persistent chrome in the room.
 */

import { useCallback, useRef, useState } from 'react'
import type { AmbientTuning, RoomAgent, RoomPerson } from './useRoom'

const WIDTH_KEY = 'aither_room_block_w'

/**
 * Drag handle for the block's width.
 *
 * The column was `minmax(260px, 340px)` — a fixed range a user could not change.
 * It now reads `--room-block-w` off the `.room` grid, which this sets inline and
 * persists per visitor.
 *
 * Pointer events (not mouse events) so a touch drag works on the PWA, with
 * setPointerCapture so the drag survives the cursor leaving the 7px handle —
 * without capture a fast drag detaches and the column sticks mid-resize.
 * Keyboard arrows resize too: a mouse-only control is unreachable for anyone
 * navigating by keyboard.
 */
function BlockGrip() {
  const [dragging, setDragging] = useState(false)
  const roomRef = useRef<HTMLElement | null>(null)

  const apply = useCallback((width: number) => {
    const room = roomRef.current
    if (!room) return
    // The grid clamps to 240px..60%; store the raw request so a later wider
    // viewport can honour it rather than baking in today's window size.
    room.style.setProperty('--room-block-w', `${Math.round(width)}px`)
    try {
      localStorage.setItem(WIDTH_KEY, String(Math.round(width)))
    } catch {
      // Private mode / storage disabled — resizing still works for this session.
      // Deliberately not silent about intent: there is nothing to recover here.
    }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const room = e.currentTarget.closest('.room') as HTMLElement | null
    if (!room) return
    roomRef.current = room
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    e.preventDefault()
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging || !roomRef.current) return
    // Width is the distance from the pointer to the room's RIGHT edge, so the
    // block tracks the cursor exactly regardless of where the room starts.
    apply(roomRef.current.getBoundingClientRect().right - e.clientX)
  }, [dragging, apply])

  const end = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return
    setDragging(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }, [dragging])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const room = e.currentTarget.closest('.room') as HTMLElement | null
    if (!room) return
    roomRef.current = room
    const current = parseInt(
      getComputedStyle(room).getPropertyValue('--room-block-w') || '320', 10,
    )
    apply((Number.isNaN(current) ? 320 : current) + (e.key === 'ArrowLeft' ? 24 : -24))
    e.preventDefault()
  }, [apply])

  return (
    <button
      type="button"
      className="room-grip"
      data-dragging={dragging}
      aria-label="Resize the title block. Use the left and right arrow keys."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    />
  )
}

interface TitleBlockProps {
  people: RoomPerson[]
  agents: RoomAgent[]
  ambient: AmbientTuning
  onDismissAgent: (agent: string) => void
  /** Narrow screens keep the block as a drawer; a summons slides it up. */
  open?: boolean
  children?: React.ReactNode
}

export default function TitleBlock({
  people, agents, ambient, onDismissAgent, open = false, children,
}: TitleBlockProps) {
  const humans = people.filter((p) => !p.is_agent)
  const online = humans.filter((p) => p.online !== false).length

  return (
    <aside className="room-block" data-open={open}>
      <BlockGrip />
      {children}

      <section className="room-block-section">
        <h3>
          <span>In the room</span>
          <span className="room-block-count">{online}/{humans.length || 0}</span>
        </h3>
        <ul className="room-roll">
          {humans.length === 0 && (
            <li className="room-note">Just you so far. Invite someone from the directory.</li>
          )}
          {humans.map((p) => (
            <li
              key={p.nick}
              className="room-member"
              data-kind="person"
              data-online={p.online !== false}
            >
              <span className="room-member-mark" aria-hidden="true" />
              <span className="room-member-name">{p.nick}</span>
              {p.status && <span className="room-member-role">{p.status}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="room-block-section">
        <h3>
          <span>Listening in</span>
          <span className="room-block-count">{agents.length}</span>
        </h3>
        <ul className="room-roll">
          {agents.length === 0 && (
            <li className="room-note">
              No agents are rostered here, so nobody will speak up on their own. Type{' '}
              <code>@</code> to see who you can bring in.
            </li>
          )}
          {agents.map((a) => (
            <li
              key={a.nick}
              className="room-member"
              data-kind="agent"
              data-online={a.online !== false}
            >
              <span className="room-member-mark" aria-hidden="true" />
              <span className="room-member-name">{a.nick}</span>
              <button
                type="button"
                className="room-dismiss"
                onClick={() => onDismissAgent(a.nick.toLowerCase())}
                aria-label={`Send ${a.nick} away`}
              >
                Send away
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="room-block-section">
        <h3><span>How they join in</span></h3>
        {ambient.enabled ? (
          <div className="room-ambient">
            <div className="room-ambient-row">
              <span>Speaks up</span>
              <span>{Math.round((ambient.response_probability ?? 0) * 100)}% of the time</span>
            </div>
            <div className="room-ambient-row">
              <span>At most</span>
              <span>{ambient.max_responders ?? 1} at once</span>
            </div>
            <div className="room-ambient-row">
              <span>Then waits</span>
              <span>{ambient.cooldown_seconds ?? 0}s</span>
            </div>
          </div>
        ) : (
          <p className="room-ambient room-ambient-off">
            Agents answer only when you address them directly.
          </p>
        )}
      </section>
    </aside>
  )
}
