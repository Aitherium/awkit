/**
 * The Sprite in the classroom's nest is the child's own creature in the sprites-v2 vector art
 * (owner, 2026-10-15: the old hand-drawn blob was one of the "old ugly sprites").
 */
import { render, screen } from '@testing-library/react'
import KidClassroom from '../panels/KidClassroom'

describe('KidClassroom nest Sprite', () => {
  it('draws the child\'s species in the v2 vector art', () => {
    render(<KidClassroom views={{ nest: <div /> }} sprite={{ name: 'Pip', species: 'owl' }} />)
    const nests = screen.getAllByTestId('nest-sprite')
    expect(nests.length).toBeGreaterThan(0)
    for (const n of nests) {
      expect(n.getAttribute('data-look')).toBe('vector')
      expect(n.querySelector('svg')!.getAttribute('data-species')).toBe('owl')
    }
  })

  it('draws their own design when the card carries it, and sleeps at goodnight', () => {
    render(<KidClassroom views={{ nest: <div /> }} minutesLeft={0} sprite={{ name: 'Pip', species: 'fox', design: { species: 'dragon', palette: 'berry' } }} />)
    const svg = screen.getByTestId('nest-sprite').querySelector('svg')!
    expect(svg.getAttribute('data-species')).toBe('dragon')
    expect(svg.getAttribute('data-expression')).toBe('sleepy')
  })

  it('with no Sprite yet the nest still holds a v2 creature, never the old blob', () => {
    const { container } = render(<KidClassroom views={{ nest: <div /> }} />)
    expect(screen.getAllByTestId('nest-sprite')[0].querySelector('svg')!.getAttribute('data-species')).toBe('sprout')
    expect(container.querySelector('.kc-blink')).toBeNull()
  })
})
