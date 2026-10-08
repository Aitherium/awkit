/**
 * speakable: no web voice reads stage directions, emoji or markdown aloud. The vectors are
 * the same as dev/tests/test_speakable.py and the Android SpeakableCheck.
 */
import { actionsIn, speakable } from '../panels/speakable'

const VECTORS: Array<[string, string]> = [
  ['*blinks* *bounces* 🐾 Hi Athena!', 'Hi Athena!'],
  ['Hi! *waves* Want to learn?', 'Hi! Want to learn?'],
  ['That is *so* cool.', 'That is so cool.'],
  ["(giggles) Let's count!", "Let's count!"],
  ['[waves happily] Hello there.', 'Hello there.'],
  ['_yawns_ Good morning.', 'Good morning.'],
  ['What is (5 + 5)?', 'What is (5 + 5)?'],
  ['**Great job!** You did it 🎉🎉', 'Great job! You did it'],
  ['# Title\n- one\n- two', 'Title one two'],
  ['snake_case and 2*3 stay', 'snake_case and 2*3 stay'],
  ['👍🏽 nice', 'nice'],
  ['*blinks*', ''],
  ['', ''],
]

describe('speakable', () => {
  it.each(VECTORS)('%j is said as %j', (raw, said) => {
    expect(speakable(raw)).toBe(said)
  })

  it('keeps the actions for the body', () => {
    expect(actionsIn('*blinks* *bounces* 🐾 Hi Athena!')).toEqual(['blinks', 'bounces'])
    expect(actionsIn('That is *so* cool.')).toEqual([])
    expect(actionsIn('What is (5 + 5)?')).toEqual([])
  })
})
