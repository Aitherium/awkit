/**
 * greetingForHour: one time-of-day word for every surface that greets (the Home window
 * and the executive briefing), from the reader's hour.
 */
import { greetingForHour } from './greeting'

describe('greetingForHour', () => {
  it('names the part of the reader\'s day, boundaries included', () => {
    expect(greetingForHour(0)).toBe('Working late')
    expect(greetingForHour(4)).toBe('Working late')
    expect(greetingForHour(5)).toBe('Good morning')
    expect(greetingForHour(11)).toBe('Good morning')
    expect(greetingForHour(12)).toBe('Good afternoon')
    expect(greetingForHour(17)).toBe('Good afternoon')
    expect(greetingForHour(18)).toBe('Good evening')
    expect(greetingForHour(20)).toBe('Good evening')
    expect(greetingForHour(23)).toBe('Good evening')
  })

  it('never guesses a part of the day from a value that is not an hour', () => {
    expect(greetingForHour(Number.NaN)).toBe('Hello')
  })
})
