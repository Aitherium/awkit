/**
 * Teacher materials, grouped by lesson. Two lessons with the same five handouts read as one
 * list printed twice on the owner's phone (2026-10-18): each lesson is its own group, each
 * title once per lesson, in the order the server sent (newest first).
 */
import { groupMaterials, type MaterialItem } from '../classroomApi'

const lesson = (id: string, topic: string): MaterialItem[] =>
  ['Lesson plan', 'Tier A activity', 'Tier B activity', 'Tier C activity', 'Family letter']
    .map((title, i) => ({ id: `${id}-${i}`, lesson_id: id, topic, title }))

test('two lessons with the same handouts are two groups, not one doubled list', () => {
  const g = groupMaterials([...lesson('l2', 'Fractions'), ...lesson('l1', 'Place value')])
  expect(g.map((x) => x.topic)).toEqual(['Fractions', 'Place value'])
  expect(g.map((x) => x.items.length)).toEqual([5, 5])
})

test('a title repeated inside one lesson is shown once', () => {
  const g = groupMaterials([...lesson('l1', 'Fractions'), { id: 'dup', lesson_id: 'l1', title: 'lesson plan ' }])
  expect(g).toHaveLength(1)
  expect(g[0].items).toHaveLength(5)
})

test('items with no lesson id still group, and an empty list is empty', () => {
  expect(groupMaterials([{ id: 'a', title: 'Map' }, { id: 'b', title: 'Map' }])[0].items).toHaveLength(1)
  expect(groupMaterials([])).toEqual([])
})
