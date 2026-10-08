/**
 * Window controls on a phone vs a desktop (owner, 2026-10-07: "AitherDesktop on the
 * phone -- the red/yellow/green icons are so big and stupid looking").
 *
 * globals.css gives every touch-screen <button> a 44px min-height/width. When the
 * colored dot WAS the button, that made three 44px circles. The dot is now an inner
 * <span> that keeps its 12px size, and a phone gets one compact close instead.
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('../agent-sidebar', () => ({
  AgentToggleButton: () => null,
  AgentSidebar: () => null,
}))

import { DesktopWindow, MOBILE_MAX_WIDTH } from '../desktop-window'

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    return {
      matches: max ? width <= Number(max[1]) : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
  }) as unknown as typeof window.matchMedia
}

function renderWindow(over: Partial<React.ComponentProps<typeof DesktopWindow>> = {}) {
  const props = {
    id: 'w1',
    title: 'Chat',
    position: { x: 10, y: 10 },
    size: { width: 600, height: 400 },
    isMinimized: false,
    isMaximized: false,
    isFocused: true,
    zIndex: 1,
    onFocus: jest.fn(),
    onClose: jest.fn(),
    onMinimize: jest.fn(),
    onMaximize: jest.fn(),
    onRestore: jest.fn(),
    onPositionChange: jest.fn(),
    onSizeChange: jest.fn(),
    ...over,
  }
  render(<DesktopWindow {...props}><div>body</div></DesktopWindow>)
  return props
}

const controls = () => Array.from(document.querySelectorAll('[data-window-control]'))

describe('DesktopWindow controls', () => {
  it('a phone gets ONE compact close and no minimize/maximize', () => {
    setViewport(412)
    const props = renderWindow()
    expect(controls().map(c => c.getAttribute('data-window-control'))).toEqual(['close'])
    const close = screen.getByRole('button', { name: 'Close window' })
    // No colored circle anywhere: the phone close is an icon, not a dot.
    expect(close.className).not.toMatch(/rounded-full|bg-red/)
    expect(document.querySelector('[class*="bg-red-500"], [class*="bg-yellow-500"], [class*="bg-green-500"]')).toBeNull()
    fireEvent.click(close)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('the phone threshold is the shared MOBILE_MAX_WIDTH', () => {
    setViewport(MOBILE_MAX_WIDTH)
    renderWindow()
    expect(controls()).toHaveLength(1)
  })

  it('a desktop keeps three 12px dots, painted on an inner span, not on the button', () => {
    setViewport(1440)
    const props = renderWindow()
    const btns = controls()
    expect(btns.map(c => c.getAttribute('data-window-control'))).toEqual(['close', 'minimize', 'maximize'])
    for (const b of btns) {
      // The button carries no size or color, so the 44px touch floor only grows
      // the invisible hit area.
      expect(b.className).not.toMatch(/\b(w-3|h-3|rounded-full|bg-)/)
      const dot = b.querySelector('span')!
      expect(dot.className).toMatch(/\bw-3\b/)
      expect(dot.className).toMatch(/\bh-3\b/)
      expect(dot.className).toMatch(/rounded-full/)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Minimize window' }))
    expect(props.onMinimize).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Maximize window' }))
    expect(props.onMaximize).toHaveBeenCalledTimes(1)
  })
})
