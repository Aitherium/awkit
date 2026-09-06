export type { AuthState, UserInfo } from './hooks/useAuth'
export type { AppConfig } from './hooks/useConfig'

export interface Message {
  id?: string
  content: string
  nick?: string
  sender?: string
  timestamp?: string
  created_at?: string
}

export interface Channel {
  name: string
  topic?: string
  mode?: string
  member_count?: number
}

export interface DMPartner {
  nick: string
  last_message?: string
  last_at?: string
}

export interface Group {
  id: string
  name: string
  members: string[]
  created_by?: string
}

export interface User {
  nick: string
  is_agent?: boolean
  status?: string
  email?: string
  online?: boolean
}
