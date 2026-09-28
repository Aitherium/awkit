/**
 * Shared fetch helpers for the Aither Academy panels (Genesis router
 * `/api/v1/academy/*`, AitherGenesis/routers/academy.py).
 *
 * A failed call surfaces as an Error carrying the router's `detail` — the panels
 * render it, never an empty list, so a 401/403/503 cannot read as "no classes".
 */

export const ACADEMY_API = '/api/v1/academy'

export interface AcademyClass {
  id: string
  name: string
  grade_level?: string | null
  subject?: string | null
  status?: string
  lessons_published?: number
  student_count?: number
}

/** A non-2xx router answer. `status` lets a panel tell 404 (not set up yet) from a failure. */
export class AcademyHttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function academyFetch<T>(
  apiBase: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  if (res.status === 204) return undefined as T
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : res.statusText
    throw new AcademyHttpError(res.status, `HTTP ${res.status}: ${detail}`)
  }
  return body as T
}

export async function listClasses(apiBase: string): Promise<AcademyClass[]> {
  const data = await academyFetch<{ classes?: AcademyClass[] }>(apiBase, '/classes')
  return data?.classes ?? []
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`
}

/** Path segment encoder: an id can never walk the URL. */
export const seg = (value: string): string => encodeURIComponent(value)

export interface AcademyArtifact {
  id: string
  kind?: string
  tier?: string | null
  title?: string
  filename?: string
  created_at?: string
}

export interface AcademyLesson {
  id: string
  topic: string
  grade_level?: string | null
  tiers?: string[]
  status: string
  generation?: string
  created_at?: string
  published_at?: string | null
  artifacts?: AcademyArtifact[]
}

export interface AcademySite {
  class_id: string
  github_repo?: string | null
  domain?: string | null
  theme?: string | null
  status: string
  created_at?: string
  updated_at?: string
}

// -- Alias-only student names ------------------------------------------------
// The router stores first names / aliases only (<= 40 characters). A panel
// refuses anything that looks like a full name or an email before it is sent.
export function aliasProblem(name: string): string | null {
  const n = name.trim()
  if (!n) return 'name is required'
  if (n.length > 40) return 'first name or alias only (max 40 characters)'
  if (/\s/.test(n)) return 'first name or alias only (no surname)'
  if (n.includes('@')) return 'no email addresses'
  return null
}

export interface StudentImportRow {
  name: string
  proficiency_level?: 'below' | 'at' | 'above'
  accommodations: string[]
}

const TIER_TO_PROFICIENCY: Record<string, 'below' | 'at' | 'above'> = {
  a: 'below', b: 'at', c: 'above', below: 'below', at: 'at', above: 'above',
}

/**
 * Parse a pasted CSV of `name, tier, accommodations` (accommodations separated
 * by `;`). Tier A/B/C maps to proficiency below/at/above; a `name` header row is
 * skipped. Rows with a bad alias or tier land in `errors` and are never sent.
 */
export function parseStudentCsv(text: string): { rows: StudentImportRow[]; errors: string[] } {
  const rows: StudentImportRow[] = []
  const errors: string[] = []
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  lines.forEach((line, i) => {
    const cells = line.split(',').map((c) => c.trim())
    if (i === 0 && cells[0].toLowerCase() === 'name') return
    const [name = '', tier = '', acc = ''] = cells
    const problem = aliasProblem(name)
    if (problem) {
      errors.push(`line ${i + 1}: ${problem}`)
      return
    }
    let proficiency: 'below' | 'at' | 'above' | undefined
    if (tier) {
      proficiency = TIER_TO_PROFICIENCY[tier.toLowerCase()]
      if (!proficiency) {
        errors.push(`line ${i + 1}: tier must be A, B, C, below, at or above`)
        return
      }
    }
    rows.push({
      name,
      proficiency_level: proficiency,
      accommodations: acc ? acc.split(';').map((a) => a.trim()).filter(Boolean) : [],
    })
  })
  return { rows, errors }
}
