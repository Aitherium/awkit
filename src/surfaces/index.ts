/**
 * Surfaces — the agent-first shell.
 *
 * A surface is not a panel. Panels are destinations you navigate between; the
 * 92-entry panel registry is what made these apps feel like a filing cabinet
 * with a chat window bolted on. A surface is a place you stay, and everything
 * else is summoned into it.
 *
 * The Company Room is the home surface. Documents, data, mail, people and the
 * fleet arrive beside the conversation via the summons grammar (`summons.ts`)
 * rather than replacing it.
 */

export { default as CompanyRoom } from './CompanyRoom/CompanyRoom'
export type { CompanyRoomProps, CompanyRoomHandle } from './CompanyRoom/CompanyRoom'

export { default as ContextSurface, DEFAULT_ENDPOINTS } from './CompanyRoom/ContextSurface'
export type { ContextEndpoints } from './CompanyRoom/ContextSurface'

export { default as RoomComposer } from './CompanyRoom/RoomComposer'
export { default as TitleBlock } from './CompanyRoom/TitleBlock'

export { useRoom } from './CompanyRoom/useRoom'
export type {
  AmbientTuning, RoomAgent, RoomMessage, RoomPerson, RoomState,
} from './CompanyRoom/useRoom'

export { SUMMONS, matchAgents, matchSummons, parseInput } from './CompanyRoom/summons'
export type { ParsedInput, Summons, SummonsId } from './CompanyRoom/summons'

// New surfaces
export { default as MailSurface } from './Mail/MailSurface'
export { useMail, type MailMessage } from './Mail/useMail'
export type { MailSurfaceProps } from './Mail/MailSurface'

export { default as FleetSurface } from './Fleet/FleetSurface'
export { useFleet } from './Fleet/useFleet'
export type {
  ServiceStatus, RoomAgent as FleetRoomAgent, WorkforceAgent, FleetState,
} from './Fleet/useFleet'

export { default as NotesSurface } from './Notes/NotesSurface'
export type { NotesSurfaceProps, RoomNote } from './Notes/NotesSurface'
