/**
 * Types for `awnix mesh status --json` and the console's mesh routes.
 *
 * Lives beside MeshPanel until the console gap folds MeshStatus into appliance/types.ts
 * (hand-off). The client is described STRUCTURALLY (MeshClient) so the panel works with
 * today's ApplianceClient (getJson + action) and with a later getMesh()/meshAction().
 * Shapes mirror /var/lib/awnix/mesh/status.json schema 1 verbatim; nothing here holds a
 * token -- the status document never contains one.
 */

export type MeshState =
  | 'unjoined'
  | 'pending'
  | 'joined'
  | 'refused'
  | 'offline'
  | 'left'
  | 'error'

export interface MeshPeer {
  node_id: string | null
  hostname: string | null
  endpoint: string
  allowed_ips: string[]
  /** The first endpoint peer routes the tenant's endpoint-less peers. */
  hub: boolean
}

export interface MeshGpu {
  vendor: string
  model: string
  /** null when the driver does not report it (unified memory); never guessed. */
  vram_gb: number | null
}

export interface MeshCapabilities {
  arch: string
  cpu_model: string
  cpu_count: number
  mem_gb: number
  gpus: MeshGpu[]
  accelerators: string[]
  node_type: 'gpu_node' | 'agent'
}

export interface MeshStatus {
  schema: 1
  state: MeshState
  node_id: string | null
  compute_node_id: string | null
  overlay_ip: string | null
  overlay_cidr: string | null
  portal: string | null
  tenant_id: string | null
  iface: string | null
  peers: MeshPeer[]
  registered: boolean
  capabilities: MeshCapabilities | null
  node_type: string | null
  expires_at: string | null
  heartbeat_at: string | null
  checked_at: string | null
  detail: string | null
  /** Added by `status`, not stored: the overlay interface exists right now. */
  iface_up?: boolean
  /** Added by `status`: a join is waiting for the network. */
  pending?: boolean
}

/** Same states the appliance client maps HTTP outcomes to (402/409/423/501/503). */
export type MeshApiState =
  | 'ok'
  | 'refused'
  | 'unavailable'
  | 'not-entitled'
  | 'locked'
  | 'not-an-appliance'
  | 'error'

export interface MeshApiResult<T> {
  state: MeshApiState
  status: number
  data: T | null
  detail?: string
  exit?: number | null
  stdoutTail?: string
}

export type MeshActionVerb = 'mesh-join' | 'mesh-leave' | 'mesh-retry'

export interface MeshActionBody {
  /** Sent once over the console's same-origin POST; the CLI reads it from stdin. */
  token?: string
}

/** What MeshPanel needs from a client. ApplianceClient satisfies it structurally. */
export interface MeshClient {
  getJson<T>(path: string): Promise<MeshApiResult<T>>
  action(verb: MeshActionVerb, body?: MeshActionBody): Promise<MeshApiResult<unknown>>
  /** Optional dedicated read, once the console client grows one. */
  getMesh?(): Promise<MeshApiResult<MeshStatus>>
}

export const MESH_STATUS_PATH = '/api/appliance/mesh'

/** The console's action allowlist pattern for mesh-join (appliance-web-api). */
export const MESH_TOKEN_RE = /^[A-Za-z0-9._-]{16,4096}$/
