/**
 * The summons grammar — what replaces navigation.
 *
 * In a room-as-home shell there are no destinations. You type, and what you
 * need arrives beside the conversation:
 *
 *   plain text   → said in the room; ambient agents may answer on their own
 *   @agent ...   → addressed to one agent, who is expected to answer
 *   /summons ... → opens a context surface in the title block, said to nobody
 *
 * Only summons whose backend actually exists are registered here. A summons
 * that opens an empty shell is worse than a summons that does not exist, so
 * this list stays honest: every entry below is bound to a live endpoint.
 */

export type SummonsId =
  | 'docs'
  | 'data'
  | 'find'
  | 'mail'
  | 'fleet'
  | 'people'
  | 'notes'
  // 'bead-space' was referenced by ContextSurface's Exclude<> and by a comment claiming it
  // "renders BeadSpacePanel" BEFORE it was ever a member of this union — so the Exclude
  // silently removed nothing and no summons existed. Declared here for real now.
  | 'bead-space'
  // On-device WebGPU model (Bonsai). No backend at all — the "live endpoint"
  // rule is satisfied differently: CompanyRoom only offers it when the host
  // app supplies a worker factory (see matchSummons's `enabled` filter).
  | 'on-device'
  // The Six Pillars lanes. CompanyRoom has rendered <PillarLanes /> from a
  // `case 'pillars':` since it was written, but the id was never a member of
  // this union -- so `tsc` failed TS2678 ("not comparable to type SummonsId"),
  // portal-kit produced no dist/, and every `awkit/*` import in Veil went
  // unresolved. Exactly the mistake the bead-space note above records, one
  // surface later.
  | 'pillars'
  // Self-service hardware (the MyHardwarePanel). Backed by the host app's
  // `/api/devices` router; CompanyRoom only offers it when the host opts in
  // via `enableHardware` (same enabled-filter rule as on-device).
  | 'hardware'

export interface Summons {
  id: SummonsId
  /** What you type. */
  token: string
  /** Imperative, in the user's vocabulary — never the system's. */
  label: string
  /** One line, shown in the palette. Says what arrives, not what it is. */
  hint: string
  /** Whether the summons uses the trailing text as a query. */
  takesQuery: boolean
}

export const SUMMONS: Summons[] = [
  { id: 'find',   token: '/find',   label: 'Search everything',   hint: 'Ask across every document the room has read',  takesQuery: true },
  { id: 'docs',   token: '/docs',   label: 'Open documents',      hint: 'Resumes, project sheets, proposals',           takesQuery: true },
  { id: 'data',   token: '/data',   label: 'Open the data',       hint: 'Staff and projects pulled out of the files',   takesQuery: true },
  { id: 'people', token: '/people', label: 'See who is here',     hint: 'Everyone in the workspace, and who is on',     takesQuery: false },
  { id: 'mail',   token: '/mail',   label: 'Open the inbox',      hint: 'Shared mail for the workspace',                takesQuery: false },
  { id: 'fleet',  token: '/fleet',  label: 'Check the fleet',     hint: 'Agents, endpoints, and what is answering',     takesQuery: false },
  { id: 'notes',  token: '/notes',  label: 'Open the room notes', hint: 'Documents this room is writing together',      takesQuery: false },
  { id: 'bead-space', token: '/space', label: 'See the work as a universe', hint: 'Tasks, services, agents, GPU pool and code scope as planets', takesQuery: false },
  { id: 'on-device', token: '/local', label: 'Chat on this device', hint: 'A small model runs in your browser — private, free, works offline', takesQuery: false },
  { id: 'pillars', token: '/pillars', label: 'Watch the six pillars', hint: 'What the platform is sensing, deciding and doing, in lanes', takesQuery: false },
  { id: 'hardware', token: '/hardware', label: 'Bring your own hardware', hint: 'Download the CLI, enrol your machine, run your own agent', takesQuery: false },
]

export interface ParsedInput {
  kind: 'say' | 'summon' | 'address'
  /** The text to send, or the query for a summons. */
  text: string
  summons?: Summons
  /** Agent nick, for `@agent` form. */
  agent?: string
}

const BY_TOKEN = new Map(SUMMONS.map((s) => [s.token, s]))

/**
 * Parse a composer line into an intent. Pure — unit-testable, and the single
 * place the grammar is defined.
 */
export function parseInput(raw: string): ParsedInput {
  const value = raw.trim()
  if (!value) return { kind: 'say', text: '' }

  if (value.startsWith('/')) {
    const [head, ...rest] = value.split(/\s+/)
    const summons = BY_TOKEN.get(head.toLowerCase())
    if (summons) {
      return { kind: 'summon', summons, text: rest.join(' ').trim() }
    }
    // Unknown slash command: say it rather than swallowing it silently.
    return { kind: 'say', text: value }
  }

  if (value.startsWith('@')) {
    const [head, ...rest] = value.split(/\s+/)
    const agent = head.slice(1).trim()
    if (agent) return { kind: 'address', agent, text: value }
  }

  return { kind: 'say', text: value }
}

/**
 * Summons matching the partial token the user is typing, for the palette.
 * Returns [] when the input is not a summons attempt.
 */
export function matchSummons(raw: string): Summons[] {
  const value = raw.trimStart()
  if (!value.startsWith('/')) return []
  const head = value.split(/\s+/)[0].toLowerCase()
  // Once a complete token is followed by a space, the palette steps aside.
  if (BY_TOKEN.has(head) && /\s/.test(value)) return []
  return SUMMONS.filter((s) => s.token.startsWith(head))
}

/** Agent nicks matching a partial `@` mention, for the palette. */
export function matchAgents(raw: string, agents: string[]): string[] {
  const value = raw.trimStart()
  if (!value.startsWith('@')) return []
  const head = value.split(/\s+/)[0].slice(1).toLowerCase()
  if (/\s/.test(value)) return []
  return agents.filter((a) => a.toLowerCase().startsWith(head))
}
