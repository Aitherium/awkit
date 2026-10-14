/**
 * KidClassroom: the child's home is one room (kids-suite S4).
 *  - every room object opens its own view, and "My room" comes back;
 *  - today's three glow (one learning, one story, one make-or-play); opening one dims it,
 *    the learning one dims only when the server says today's learning is done; when all
 *    three are done the room says so and nothing glows;
 *  - "All done" rests the room; the guardian's daily cap says goodnight (no countdown);
 *  - an object with no view is not drawn; a deep link opens its object first;
 *  - the Easel is the room's own and sends nothing.
 */
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import KidClassroom, { ROOM_OBJECT_IDS, todaysThree, type RoomObjectId } from '../KidClassroom'

const DAY = new Date(2026, 9, 14, 16, 0)
const now = () => DAY

function allViews(): Partial<Record<RoomObjectId, React.ReactNode>> {
  const v: Partial<Record<RoomObjectId, React.ReactNode>> = {}
  for (const id of ROOM_OBJECT_IDS) if (id !== 'easel') v[id] = <div data-testid={`content-${id}`}>{id} inside</div>
  return v
}

function glowing(): string[] {
  return ROOM_OBJECT_IDS.filter((id) => screen.queryByTestId(`room-${id}`)?.getAttribute('data-glow') === '1')
}

beforeEach(() => { window.localStorage.clear() })

describe('the room', () => {
  it('draws all nine objects and every one opens its own view', () => {
    const speak = jest.fn()
    const opened: string[] = []
    render(<KidClassroom name="Athena" views={allViews()} now={now} speak={speak} onOpen={(id) => opened.push(id)} />)
    expect(screen.getByTestId('kid-classroom')).toBeTruthy()
    expect(screen.getByTestId('room-hello').textContent).toBe('Hi, Athena!')
    for (const id of ROOM_OBJECT_IDS) {
      fireEvent.click(screen.getByTestId(`room-${id}`))
      expect(screen.getByTestId(`room-view-${id}`)).toBeTruthy()
      if (id === 'easel') expect(screen.getByTestId('easel-canvas')).toBeTruthy()
      else expect(screen.getByTestId(`content-${id}`).textContent).toBe(`${id} inside`)
      fireEvent.click(screen.getByTestId('room-back'))
      expect(screen.getByTestId('kid-classroom')).toBeTruthy()
    }
    expect(opened).toEqual([...ROOM_OBJECT_IDS])
    // every tap is read aloud: almost nothing to read
    expect(speak).toHaveBeenCalledWith('Story time!')
  })

  it('an object with no view is not drawn (no dead buttons); the Easel always is', () => {
    render(<KidClassroom views={{ door: <div />, toychest: <div /> }} now={now} />)
    expect(screen.queryByTestId('room-bookshelf')).toBeNull()
    expect(screen.queryByTestId('room-window')).toBeNull()
    expect(screen.getByTestId('room-door')).toBeTruthy()
    expect(screen.getByTestId('room-easel')).toBeTruthy()
  })

  it('a deep link opens its object first', () => {
    render(<KidClassroom views={allViews()} initialObject="mailbox" now={now} />)
    expect(screen.getByTestId('room-view-mailbox')).toBeTruthy()
  })
})

describe("today's three", () => {
  it('picks one learning, one story and one make-or-play from what the room offers', () => {
    expect(todaysThree(new Set(ROOM_OBJECT_IDS))).toEqual(['door', 'bookshelf', 'easel'])
    expect(todaysThree(new Set<RoomObjectId>(['door', 'mailbox', 'toychest']))).toEqual(['door', 'mailbox', 'toychest'])
    expect(todaysThree(new Set<RoomObjectId>(['wall']))).toEqual([])
  })

  it('glow, dim as they are done, and the room says so when all three are', () => {
    const { rerender } = render(<KidClassroom views={allViews()} now={now} />)
    expect(glowing()).toEqual(['door', 'bookshelf', 'easel'])
    fireEvent.click(screen.getByTestId('room-bookshelf'))
    fireEvent.click(screen.getByTestId('room-back'))
    fireEvent.click(screen.getByTestId('room-easel'))
    fireEvent.click(screen.getByTestId('room-back'))
    // opening the Door is not "learning done": only the server says that
    fireEvent.click(screen.getByTestId('room-door'))
    fireEvent.click(screen.getByTestId('room-back'))
    expect(glowing()).toEqual(['door'])
    expect(screen.queryByTestId('room-all-three-done')).toBeNull()
    rerender(<KidClassroom views={allViews()} now={now} learnedToday />)
    expect(glowing()).toEqual([])
    expect(screen.getByTestId('room-all-three-done').textContent).toBe('That’s everything for today!')
  })

  it("remembers today's marks per child, and forgets them tomorrow", () => {
    const first = render(<KidClassroom views={allViews()} storageKey="athena" now={now} />)
    fireEvent.click(screen.getByTestId('room-bookshelf'))
    first.unmount()
    const again = render(<KidClassroom views={allViews()} storageKey="athena" now={now} />)
    expect(glowing()).toEqual(['door', 'easel'])
    again.unmount()
    render(<KidClassroom views={allViews()} storageKey="alexander" now={now} />)
    expect(glowing()).toEqual(['door', 'bookshelf', 'easel'])
  })
})

describe('a natural end, never compulsion', () => {
  it('"All done" rests the room and "Back to my room" wakes it', () => {
    render(<KidClassroom name="Alexander" views={allViews()} now={now} />)
    fireEvent.click(screen.getByTestId('all-done'))
    expect(screen.getByTestId('room-resting').textContent).toContain('All done! See you next time, Alexander.')
    fireEvent.click(screen.getByTestId('room-wake'))
    expect(screen.getByTestId('room-door')).toBeTruthy()
  })

  it("at the guardian's daily cap the room says goodnight: no objects, no countdown", () => {
    render(<KidClassroom name="Athena" spriteName="Pip" views={allViews()} minutesLeft={0} initialObject="toychest" now={now} />)
    const night = screen.getByTestId('room-goodnight')
    expect(night.textContent).toContain('Goodnight, Athena!')
    expect(night.textContent).toContain('Pip is yawning')
    expect(night.textContent).not.toMatch(/\d/)
    for (const id of ROOM_OBJECT_IDS) expect(screen.queryByTestId(`room-${id}`)).toBeNull()
  })

  it('never shows a streak, a score or a timer', () => {
    render(<KidClassroom name="Athena" views={allViews()} minutesLeft={12} now={now} />)
    const room = screen.getByTestId('kid-classroom').cloneNode(true) as HTMLElement
    room.querySelectorAll('style').forEach((n) => n.remove())
    const text = room.textContent || ''
    expect(text).not.toMatch(/streak|score|points|minutes|\d/i)
  })
})

describe('the Easel', () => {
  it('paints on this device and fetches nothing', () => {
    const fetchSpy = jest.fn()
    ;(global as unknown as { fetch: unknown }).fetch = fetchSpy
    const pen = { lineTo: jest.fn(), moveTo: jest.fn(), beginPath: jest.fn(), stroke: jest.fn(), fillRect: jest.fn(),
      strokeStyle: '', fillStyle: '', lineWidth: 0, lineCap: '', lineJoin: '' }
    const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(pen as unknown as CanvasRenderingContext2D)
    render(<KidClassroom views={allViews()} initialObject="easel" now={now} />)
    const canvas = screen.getByTestId('easel-canvas')
    act(() => {
      fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1, buttons: 1 })
      fireEvent.pointerMove(canvas, { clientX: 40, clientY: 30, pointerId: 1, buttons: 1 })
      fireEvent.pointerUp(canvas, { pointerId: 1 })
    })
    expect(pen.lineTo).toHaveBeenCalled()
    expect(pen.strokeStyle).toBe('#faa2c1')
    fireEvent.click(screen.getByTestId('paint-4fc3f7'))
    expect(screen.getByTestId('paint-4fc3f7').getAttribute('aria-checked')).toBe('true')
    const fills = pen.fillRect.mock.calls.length
    fireEvent.click(screen.getByTestId('easel-clear'))
    expect(pen.fillRect.mock.calls.length).toBe(fills + 1)
    expect(fetchSpy).not.toHaveBeenCalled()
    getContext.mockRestore()
  })
})
