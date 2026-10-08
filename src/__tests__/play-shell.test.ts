/**
 * awkit lib/playShell: the same Play rule as Veil's lib/aither-shell.
 */
import { isPlayShell, openCheckout, PLAY_NO_PURCHASE } from '../lib/playShell'

const base = 'Mozilla/5.0 (Linux; Android 17; wv) Chrome/141.0'

describe('playShell', () => {
  it('knows the Play build from the GitHub build and a browser', () => {
    expect(isPlayShell(`${base} AitherAndroid/0.3.8 Play`)).toBe(true)
    expect(isPlayShell(`${base} AitherAndroid/0.3.8`)).toBe(false)
    expect(isPlayShell(`${base} Player/1.0`)).toBe(false)
  })

  it('opens no checkout in the Play build and one elsewhere', () => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null)
    expect(openCheckout('https://checkout.stripe.com/x', { ua: `${base} AitherAndroid/0.3.8 Play`, newTab: true })).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(openCheckout('https://checkout.stripe.com/x', { ua: base, newTab: true })).toBe(true)
    expect(open).toHaveBeenCalledWith('https://checkout.stripe.com/x', '_blank')
    open.mockRestore()
    expect(PLAY_NO_PURCHASE).not.toMatch(/aitherium\.com|browser/i)
  })
})
