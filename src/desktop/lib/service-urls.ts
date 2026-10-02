/**
 * Service URL Configuration
 *
 * Provides centralized URL management that properly handles:
 * - Docker environment (container hostnames)
 * - Local development (localhost)
 * - Server-side vs Client-side detection
 *
 * IMPORTANT: All ports are derived from services.yaml via service-config.ts
 * This ensures a single source of truth for service configuration.
 *
 * IMPORTANT: This file must work both on server (Next.js API routes) and client (browser).
 * - Server-side: Can use Docker container hostnames or localhost based on DOCKER_CONTAINER env
 * - Client-side: MUST use localhost (browser can't resolve Docker hostnames)
 */

import { getServicePort } from './service-config'
import { isLocalNetworkHost } from './is-local-network-host'

// ============================================================================
// ENVIRONMENT DETECTION
// ============================================================================

/**
 * Check if we're running in a Docker container (server-side only)
 * Client-side always returns false since browser can't use container hostnames
 */
export function isDockerEnvironment(): boolean {
  // Browser always uses localhost - can't resolve container names
  if (typeof window !== 'undefined') {
    return false
  }

  // Server-side: check environment variables (support multiple formats)
  return (
    process.env.DOCKER_CONTAINER === '1' ||
    process.env.DOCKER_CONTAINER === 'true' ||
    process.env.IS_DOCKER === 'true' ||
    process.env.DOCKER === 'true'
  )
}

/**
 * Check if we're in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development'
}

// ============================================================================
// SERVICE PORT MAPPINGS - DERIVED FROM services.yaml
// ============================================================================

/**
 * Helper to get port with fallback for external services not in services.yaml
 */
function getPort(service: string, fallback: number): number {
  return getServicePort(service) ?? fallback
}

/**
 * Service ports derived from services.yaml (single source of truth)
 * Fallback values are only used for external services not defined in services.yaml
 */
export const SERVICE_PORTS = {
  // Core Services (from services.yaml)
  genesis: getPort('genesis', 8001),
  node: getPort('node', 8090),
  pulse: getPort('pulse', 8081),
  watch: getPort('watch', 8082),
  voice: getPort('voice', 8084),
  vision: getPort('vision', 8084),
  portal: getPort('portal', 8085),
  reflex: getPort('reflex', 8086),
  spirit: getPort('spirit', 8087),
  spiritmem: getPort('spirit', 8087), // Alias
  mind: getPort('mind', 8088),

  // Intelligence
  flow: getPort('flow', 8165),
  tag: getPort('tag', 8092),
  reasoning: getPort('reasoning', 8093),
  enviro: getPort('conduit', 8094), // Conduit handles env
  conduit: getPort('conduit', 8094),
  autonomic: getPort('autonomic', 8095),
  sense: getPort('sense', 8096),
  will: getPort('will', 8097),
  context: getPort('context', 8098),
  chain: getPort('chain', 8099),

  // Memory & Processing
  parallel: getPort('parallel', 8100),
  workingmemory: getPort('workingmemory', 8101),
  force: getPort('force', 8102),
  accel: getPort('accel', 8103),
  persona: getPort('persona', 8116),
  safety: getPort('safety', 8105),
  prism: getPort('prism', 8106),
  trainer: getPort('trainer', 8106),
  canvas: getPort('canvas', 8108),
  scheduler: getPort('scheduler', 8109),
  acta: getPort('acta', 8206),
  demand: getPort('genesis', 8001),  // Demand absorbed into Genesis

  // Security & Management
  secrets: getPort('secrets', 8111),
  identity: getPort('identity', 8117),  // Identity is a compound sub-service of SecurityCore
  search: getPort('search', 8114),
  recover: getPort('recover', 8115),
  flux: getPort('flux', 8117),
  llm: getPort('llm', 8118),
  exo: getPort('exo', 8119),
  vllm: getPort('vllm', 8120),
  gateway: getPort('gateway', 8777),
  chronicle: getPort('chronicle', 8121),
  nexus: getPort('nexus', 8122),
  scope: getPort('genesis', 8001),  // Scope absorbed into Genesis
  exonodes: getPort('exonodes', 8124),
  mesh: getPort('mesh', 8125),
  comet: getPort('comet', 8126),
  deployer: getPort('comet', 8126), // Alias for comet
  sentry: getPort('sentry', 8127),
  intent: getPort('genesis', 8001),  // Intent absorbed into Genesis
  sensorybuffer: getPort('sensorybuffer', 8129),
  daydream: getPort('daydream', 8130),
  sandbox: getPort('sandbox', 8131),
  browser: getPort('browser', 8132),
  evolution: getPort('evolution', 8106),
  inspector: getPort('inspector', 8134),
  aithernet: getPort('aithernet', 8135),
  strata: getPort('strata', 8136),
  documentation: getPort('documentation', 8137),
  faculties: getPort('faculties', 8138),
  cortex: getPort('genesis', 8001),  // Cortex absorbed into Genesis
  demiurge: getPort('demiurge', 8140),
  timesense: getPort('timesense', 8141),
  workspace: getPort('workspace', 8142),
  terminal: getPort('terminal', 8143),
  lsp: getPort('lsp', 8144),
  git: getPort('git', 8145),
  innerlife: getPort('innerlife', 8146),
  consciousnessintegration: getPort('consciousnessintegration', 8147),
  star: getPort('star', 8106),
  registry: getPort('registry', 8149),
  microscheduler: getPort('microscheduler', 8150),
  executive: getPort('executive', 8151),
  harvest: getPort('harvest', 8106),
  axiom: getPort('axiom', 8153),
  testing: getPort('genesis', 8001),  // Testing absorbed into Genesis
  chaos: getPort('chaos', 8160),
  guard: getPort('guard', 8162),
  graph: getPort('graph', 8196),
  darkfactory: getPort('darkfactory', 8211),
  automatedactions: getPort('automatedactions', 8163),
  jail: getPort('jail', 8169),
  judge: getPort('judge', 8164),
  learning: getPort('learning', 8106),
  compute: getPort('compute', 8168),
  kernelforge: getPort('kernelforge', 8173),
  desktopbridge: getPort('desktopbridge', 8174),
  eval: getPort('genesis', 8001),  // Eval absorbed into Genesis

  // Social Services (SMS → CommunicationCore, Moltroad → SocialHub)
  sms: getPort('sms', 8205),
  moltroad: getPort('moltroad', 8195),
  aither: getPort('aithersocial', 8192),
  aitherfeedgenerator: getPort('aitherfeedgenerator', 8192),
  linkedin: getPort('linkedin', 8187),
  mcpcanvas: getPort('mcpcanvas', 8189),
  prometheus: getPort('prometheus', 8190), // Formerly Realm
  mail: getPort('mail', 8191),
  realmpulse: getPort('realmpulse', 8193),
  socialunified: getPort('socialunified', 8192),
  codegraph: getPort('codegraph', 8194),
  reviewservice: getPort('genesis', 8001),  // ReviewService absorbed into Genesis
  knowledgediffer: getPort('knowledgediffer', 8197),
  mcpvision: getPort('mcpvision', 8294),
  mcpmind: getPort('mcpmind', 8288),
  mcpmemory: getPort('mcpmemory', 8295),

  // Agents
  aeon: getPort('aeon', 8765),
  council: getPort('aeon', 8765), // Alias for Aeon
  a2a: getPort('a2a', 8766),
  orchestrator: getPort('genesis', 8001), // Orchestrator absorbed into Genesis
  forge3d: getPort('forge3d', 8784),
  meshgen: getPort('meshgen', 8788),
  forge: getPort('forge', 8768),
  saga: getPort('saga', 8770),
  infraagent: getPort('infraagent', 8771),
  automationagent: getPort('automationagent', 8772),
  aitheragent: getPort('aitheragent', 8773),
  director: getPort('director', 8774),
  servicesmanageragent: getPort('servicesmanageragent', 8775),
  genesisagent: getPort('genesisagent', 8776),
  atlas: getPort('atlas', 8778), // Formerly Prometheus
  lyra: getPort('lyra', 8779),
  assistant: getPort('genesis', 8001),  // Assistant (formerly Companion) absorbed into Genesis
  vera: getPort('vera', 8781),
  hera: getPort('hera', 8782),
  skills: getPort('genesis', 8001),  // Skills absorbed into Genesis

  // Communication
  relay: getPort('relay', 8205),

  // External services (not in services.yaml - hardcoded fallbacks)
  comfyui: 8188,
  ollama: 11434,
  redis: 6379,
  postgres: 5432,
  veil: getPort('veil', 3000),
} as const

export type ServiceName = keyof typeof SERVICE_PORTS

/**
 * Compound service path prefixes.
 * Sub-services absorbed into a compound share a port but mount on a prefix.
 */
const COMPOUND_PREFIXES: Partial<Record<ServiceName, string>> = {
  trainer: '/trainer',
  evolution: '/evolution',
  harvest: '/harvest',
  learning: '/learning',
  star: '/star',
  sms: '/sms',
  moltroad: '/moltroad',
  aither: '/aither',
  aitherfeedgenerator: '/bskyfeed',
}

// Docker container hostname mapping - generates hostname from service name
function getDockerHostname(service: string): string {
  // Services that run on host machine (NOT in Docker)
  const hostServices = ['ollama', 'comfyui', 'moltroad']
  if (hostServices.includes(service.toLowerCase())) {
    return 'host.docker.internal'
  }

  const compoundServices: Record<string, string> = {
    identity: 'aitheros-security-core',
    flux: 'aitheros-security-core',
  }
  if (service.toLowerCase() in compoundServices) {
    return compoundServices[service.toLowerCase()]
  }

  // External infrastructure services
  const infraServices: Record<string, string> = {
    redis: 'redis',
    postgres: 'postgres',
  }
  if (service.toLowerCase() in infraServices) {
    return infraServices[service.toLowerCase()]
  }
  // Standard Aither services - compose network uses aitheros-{service}
  return `aitheros-${service.toLowerCase()}`
}

// Build Docker hostnames dynamically from SERVICE_PORTS keys
const DOCKER_HOSTNAMES: Record<ServiceName, string> = Object.fromEntries(
  Object.keys(SERVICE_PORTS).map(service => [service, getDockerHostname(service)])
) as Record<ServiceName, string>

// ============================================================================
// URL GENERATION
// ============================================================================

/**
 * Get the HTTP URL for a service
 * @param service - The service name
 * @param forClientSide - If true, always returns localhost (for browser use)
 */
export function getServiceUrl(service: ServiceName, forClientSide = false): string {
  const port = SERVICE_PORTS[service]
  const prefix = COMPOUND_PREFIXES[service] ?? ''

  // Check for environment variable override first
  const envVarName = `AITHER${service.toUpperCase()}_URL`
  const envUrl = typeof process !== 'undefined' ? process.env[envVarName] : undefined
  if (envUrl) {
    return envUrl
  }

  // Client-side (browser) always uses localhost
  if (forClientSide || typeof window !== 'undefined') {
    return `http://localhost:${port}${prefix}`
  }

  // Server-side: use Docker hostname if in Docker, else localhost
  if (isDockerEnvironment()) {
    const hostname = DOCKER_HOSTNAMES[service]
    return `http://${hostname}:${port}${prefix}`
  }

  return `http://localhost:${port}${prefix}`
}

/**
 * Get the WebSocket URL for a service
 * @param service - The service name
 * @param path - Optional path (e.g., '/ws', '/stream')
 * @param forClientSide - If true, always returns localhost
 */
export function getServiceWsUrl(service: ServiceName, path = '/ws', forClientSide = false): string {
  const port = SERVICE_PORTS[service]

  // Client-side always uses localhost
  if (forClientSide || typeof window !== 'undefined') {
    return `ws://localhost:${port}${path}`
  }

  // Server-side: use Docker hostname if in Docker
  if (isDockerEnvironment()) {
    const hostname = DOCKER_HOSTNAMES[service]
    return `ws://${hostname}:${port}${path}`
  }

  return `ws://localhost:${port}${path}`
}

// ============================================================================
// PRE-BUILT SERVICE URL OBJECTS
// ============================================================================

/**
 * Get all service URLs for server-side use
 * These URLs adapt based on Docker environment
 */
export function getServerUrls() {
  return {
    node: getServiceUrl('node'),
    pulse: getServiceUrl('pulse'),
    watch: getServiceUrl('watch'),
    chronicle: getServiceUrl('chronicle'),
    flux: getServiceUrl('flux'),
    cortex: getServiceUrl('cortex'),
    context: getServiceUrl('context'),
    sense: getServiceUrl('sense'),
    secrets: getServiceUrl('secrets'),
    llm: getServiceUrl('llm'),
    reasoning: getServiceUrl('reasoning'),
    mind: getServiceUrl('mind'),
    strata: getServiceUrl('strata'),
    scheduler: getServiceUrl('scheduler'),
    recover: getServiceUrl('recover'),
    sensorybuffer: getServiceUrl('sensorybuffer'),
    daydream: getServiceUrl('daydream'),
    timesense: getServiceUrl('timesense'),
    innerlife: getServiceUrl('innerlife'),
    reflex: getServiceUrl('reflex'),
    comfyui: getServiceUrl('comfyui'),
    ollama: getServiceUrl('ollama'),
    atlas: getServiceUrl('atlas'),
    prometheus: getServiceUrl('prometheus'),
    acta: getServiceUrl('acta'),
  }
}

/**
 * Get all service URLs for client-side use
 * These always use localhost since browser can't resolve Docker hostnames
 */
export function getClientUrls() {
  return {
    node: getServiceUrl('node', true),
    pulse: getServiceUrl('pulse', true),
    watch: getServiceUrl('watch', true),
    chronicle: getServiceUrl('chronicle', true),
    flux: getServiceUrl('flux', true),
    cortex: getServiceUrl('cortex', true),
    context: getServiceUrl('context', true),
    sense: getServiceUrl('sense', true),
    secrets: getServiceUrl('secrets', true),
    llm: getServiceUrl('llm', true),
    reasoning: getServiceUrl('reasoning', true),
    mind: getServiceUrl('mind', true),
    strata: getServiceUrl('strata', true),
    scheduler: getServiceUrl('scheduler', true),
    recover: getServiceUrl('recover', true),
    sensorybuffer: getServiceUrl('sensorybuffer', true),
    daydream: getServiceUrl('daydream', true),
    timesense: getServiceUrl('timesense', true),
    innerlife: getServiceUrl('innerlife', true),
    reflex: getServiceUrl('reflex', true),
    comfyui: getServiceUrl('comfyui', true),
    ollama: getServiceUrl('ollama', true),
    atlas: getServiceUrl('atlas', true),
    prometheus: getServiceUrl('prometheus', true),
    acta: getServiceUrl('acta', true),
  }
}

/**
 * Get WebSocket URLs for real-time connections (client-side)
 */
export function getWebSocketUrls() {
  return {
    pulse: getServiceWsUrl('pulse', '/ws', true),
    watch: getServiceWsUrl('watch', '/ws', true),
    chronicle: getServiceWsUrl('chronicle', '/stream', true),
    flux: getServiceWsUrl('flux', '/ws/ui', true),
    atlas: getServiceWsUrl('atlas', '/ws', true),
    prometheus: getServiceWsUrl('prometheus', '/ws', true),
    context: getServiceWsUrl('context', '/ws', true),
  }
}

// ============================================================================
// EXPORTS FOR COMMON USE CASES
// ============================================================================

// For API routes (server-side), check environment
export const CORTEX_URL = typeof window === 'undefined'
  ? (process.env.AITHER_CORTEX_URL || getServiceUrl('cortex'))
  : '/api/cortex'

export const FLUX_URL = typeof window === 'undefined'
  ? (process.env.AITHERFLUX_URL || getServiceUrl('flux'))
  : '/api/flux'

// Note: Client-side (browser) uses SERVICE_PORTS which is derived from services.yaml at build time
export const WATCH_URL = typeof window === 'undefined'
  ? (process.env.AITHERWATCH_URL || getServiceUrl('watch'))
  : `http://localhost:${SERVICE_PORTS.watch}`

export const PULSE_URL = typeof window === 'undefined'
  ? (process.env.AITHERPULSE_URL || getServiceUrl('pulse'))
  : `http://localhost:${SERVICE_PORTS.pulse}`

export const CHRONICLE_URL = typeof window === 'undefined'
  ? (process.env.AITHERCHRONICLE_URL || getServiceUrl('chronicle'))
  : `http://localhost:${SERVICE_PORTS.chronicle}`

// Social services
export const MOLTROAD_URL = typeof window === 'undefined'
  ? (process.env.MOLTROAD_URL || process.env.MOLTROAD_SERVICE_URL || getServiceUrl('moltroad'))
  : `http://localhost:${SERVICE_PORTS.moltroad}`

// AitherKnowledgeGraph — Unified Graph (Code/Social/Memory)
export const KNOWLEDGE_GRAPH_URL = typeof window === 'undefined'
  ? (process.env.AITHERKNOWLEDGE_GRAPH_URL || getServiceUrl('graph'))
  : `http://localhost:${SERVICE_PORTS.graph}`

// ACTA (Aither Credit & Token Authority) - agent marketplace & billing gateway
export const ACTA_URL = typeof window === 'undefined'
  ? (process.env.AITHERACTA_URL || getServiceUrl('acta'))
  : `http://localhost:${SERVICE_PORTS.acta}`

// AitherRelay — IRC-style chat relay
export const RELAY_URL = typeof window === 'undefined'
  ? (process.env.AITHERRELAY_URL || getServiceUrl('relay'))
  : `http://localhost:${SERVICE_PORTS.relay}`

// WebSocket URL for chat — client-side only, constructed from RELAY_URL
//
// Strategy:
//   Explicit env var (NEXT_PUBLIC_RELAY_WS_URL) always wins — used for
//     static/demo deployments pointing directly to wss://irc.aitherium.com/ws/chat
//   Local dev (localhost / LAN)  →  ws://<host>:8205/ws/chat   (direct to relay)
//   Docker/production (ws-proxy available) →  wss://<same-origin>/ws/chat
//     Veil's ws-proxy-server.js intercepts the upgrade and forwards to
//     CommunicationCore on the Docker network.
export function getRelayWsUrl(): string {
  if (typeof window === 'undefined') {
    return `ws://localhost:${SERVICE_PORTS.relay}/ws/chat`
  }

  const host = window.location.hostname
  const isLocal = isLocalNetworkHost(host)

  // Local development / local Docker — always use direct port to CommunicationCore.
  // This takes priority over the baked-in env var because the external relay
  // (e.g. irc.aitherium.com) may be unreachable from a local network.
  if (isLocal) {
    return `ws://${host}:${SERVICE_PORTS.relay}/ws/chat`
  }

  // Explicit override — baked in at build time via NEXT_PUBLIC_RELAY_WS_URL
  // (e.g. wss://irc.aitherium.com/ws/chat for the public demo/static site)
  const envUrl = process.env.NEXT_PUBLIC_RELAY_WS_URL
  if (envUrl) return envUrl

  // Production — same-origin WebSocket through Veil's ws-proxy
  // This works through any reverse proxy / tunnel that forwards to Veil.
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/chat`
}

export const RELAY_WS_URL = getRelayWsUrl()

// ============================================================================
// HELPER FOR GETTING HOST - works in Docker and locally
// ============================================================================

/**
 * Get the appropriate host for connecting to services on the host machine.
 * In Docker: returns 'host.docker.internal'
 * Locally: returns 'localhost'
 */
export function getHost(): string {
  if (typeof window !== 'undefined') {
    return 'localhost'
  }
  return isDockerEnvironment() ? 'host.docker.internal' : 'localhost'
}

/**
 * Build a URL for a service running on the host machine.
 * Automatically handles Docker vs local environment.
 * @param port - The port number
 * @param path - Optional path (default: '')
 */
export function getHostUrl(port: number, path = ''): string {
  const host = getHost()
  return `http://${host}:${port}${path}`
}
