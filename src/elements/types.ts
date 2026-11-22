import type { ComponentType } from 'react'

export type ElementCategory =
  | 'buttons'
  | 'toggles'
  | 'loaders'
  | 'cards'
  | 'inputs'
  | 'checkboxes'
  | 'radios'
  | 'tooltips'
  | 'badges'
  | 'progress'

export interface ElementMeta {
  id: string
  title: string
  category: ElementCategory
  tags: string[]
}

export type ElementEntry = ElementMeta & { Component: ComponentType; code: string }
