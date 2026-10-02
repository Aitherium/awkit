/**
 * The DesktopShell's account chip: the desktop must say who is signed in, and give
 * an anonymous visitor a door in (owner, 2026-10-01: "AITHERDESKTOP DOESNT SHOW ME
 * AS SIGNED IN ... THERE IS NOWHERE TO EVEN SIGN IN").
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { AccountChip, accountInitials, type DesktopIdentity } from '../account-chip'

function identity(over: Partial<DesktopIdentity> = {}): DesktopIdentity {
  return {
    account: null,
    loading: false,
    onSignIn: jest.fn(),
    onSignOut: jest.fn(),
    onOpenAccount: jest.fn(),
    onOpenDevices: jest.fn(),
    ...over,
  }
}

describe('AccountChip', () => {
  it('offers an anonymous visitor a Sign in button that starts the host flow', () => {
    const id = identity()
    render(<AccountChip identity={id} />)
    const chip = screen.getByTestId('desktop-account-chip')
    expect(chip.getAttribute('data-signed-in')).toBe('false')
    expect(chip.textContent).toContain('Sign in')
    fireEvent.click(chip)
    expect(id.onSignIn).toHaveBeenCalledTimes(1)
  })

  it('never flashes Sign in while the session is still restoring', () => {
    render(<AccountChip identity={identity({ loading: true })} />)
    const chip = screen.getByTestId('desktop-account-chip')
    expect(chip.getAttribute('data-signed-in')).toBe('loading')
    expect(screen.queryByText('Sign in')).toBeNull()
  })

  it('names the signed-in account and opens a menu with Account, Devices, Sign out', () => {
    const id = identity({ account: { name: 'David Parker', email: 'd@example.com' } })
    render(<AccountChip identity={id} />)
    const chip = screen.getByTestId('desktop-account-chip')
    expect(chip.getAttribute('data-signed-in')).toBe('true')
    expect(chip.getAttribute('aria-label')).toBe('Signed in as David Parker')
    expect(chip.textContent).toContain('DP')
    expect(screen.queryByTestId('desktop-account-menu')).toBeNull()

    fireEvent.click(chip)
    const menu = screen.getByTestId('desktop-account-menu')
    expect(menu.textContent).toContain('d@example.com')
    const items = screen.getAllByRole('menuitem').map(b => b.textContent || '')
    expect(items.map(t => t.split('awdk')[0].trim())).toEqual(['Account', 'Devices', 'Sign out'])

    fireEvent.click(screen.getByRole('menuitem', { name: /Devices/ }))
    expect(id.onOpenDevices).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('desktop-account-menu')).toBeNull()

    fireEvent.click(chip)
    fireEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }))
    expect(id.onSignOut).toHaveBeenCalledTimes(1)
  })

  it('closes the menu on Escape and on an outside click', () => {
    render(<div><span data-testid="outside" /><AccountChip identity={identity({ account: { name: 'x' } })} /></div>)
    fireEvent.click(screen.getByTestId('desktop-account-chip'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('desktop-account-menu')).toBeNull()
    fireEvent.click(screen.getByTestId('desktop-account-chip'))
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByTestId('desktop-account-menu')).toBeNull()
  })

  it('omits menu items the host did not supply', () => {
    render(<AccountChip identity={identity({ account: { name: 'x' }, onOpenDevices: undefined, onOpenAccount: undefined })} />)
    fireEvent.click(screen.getByTestId('desktop-account-chip'))
    expect(screen.getAllByRole('menuitem').map(b => (b.textContent || '').trim())).toEqual(['Sign out'])
  })

  it('derives initials', () => {
    expect(accountInitials('David Parker')).toBe('DP')
    expect(accountInitials('wizzense')).toBe('W')
    expect(accountInitials('a.b.c')).toBe('AC')
    expect(accountInitials('  ')).toBe('?')
  })
})
