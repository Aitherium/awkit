/**
 * Service Configuration - Reads from services.yaml
 * 
 * This module reads service ports directly from AitherOS/config/services.yaml
 * which is the single source of truth.
 */

import { parse } from 'yaml'

// Client-side fallback to avoid breaking UI that imports this
const CLIENT_FALLBACKS: Record<string, number> = {
    'genesis': 8001,
    'sensorybuffer': 8129,
    'chronicle': 8121,
    'secrets': 8111,
    'pulse': 8081,
    'watch': 8082,
    'strata': 8136,
    'nexus': 8122,
    'identity': 8112,
    'flux': 8117,
    'veil': 3000,
    'moltroad': 8195,
    'sense': 8096,
    'reflex': 8086,
    'reasoning': 8093,
    'orchestrator': 8001,  // Absorbed into Genesis
    'intent': 8001,        // Absorbed into Genesis
    'faculties': 8138,
    'demiurge': 8140,
    'chain': 8099,
    'mind': 8088,
    'sentry': 8127,
    'inspector': 8134,
    'vision': 8084,
    'voice': 8084,
    'portal': 8085,
    'will': 8097,
    'cortex': 8139,
    'microscheduler': 8150,
    'node': 8090,
    'judge': 8164,
    'flow': 8165,
    'context': 8098,
    'search': 8114,
    'safety': 8105,
    'mesh': 8125,
    'recover': 8115,
    'persona': 8116,
    'atlas': 8778,
    'directory': 8214
}

export interface ServiceConfig {
    port: number
    healthPath: string
    description?: string
    module?: string
    group?: string
}

// Cache the parsed services
let servicesCache: Record<string, ServiceConfig> | null = null

/**
 * Find services.yaml path - works from AitherVeil directory
 */
function getServicesYamlPath(): string {
    if (typeof window !== 'undefined') {
        throw new Error('Service config cannot be read on client side')
    }

    try {
        // Use eval('require') to hide fs/path from webpack/turbopack analysis
        // This prevents the bundler from trying to resolve 'fs' on the client side
        const req = eval('require')
        const path = req('path')
        const fs = req('fs')

        // Try relative to AitherVeil/src/lib -> ../../config/services.yaml
        const possiblePaths = [
            path.resolve(process.cwd(), 'config', 'services.yaml'),                  // Standalone Docker (/app/config/)
            path.resolve(process.cwd(), 'AitherOS', 'config', 'services.yaml'),      // Docker with full repo (/app/AitherOS/config/)
            path.resolve(process.cwd(), '..', 'config', 'services.yaml'),            // From AitherVeil (../config/)
            path.resolve(__dirname, '..', '..', '..', '..', 'config', 'services.yaml'), // From lib folder
            path.resolve(__dirname, '..', '..', 'config', 'services.yaml'),          // From src/lib -> src/../config
        ]

        for (const p of possiblePaths) {
            try {
                fs.readFileSync(p)
                return p
            } catch (_e) {
                // Try next path
            }
        }
        
        // Return first one as fallback for error message or undefined
        return possiblePaths[0]
    } catch (e) {
        return ''
    }
}

/**
 * Load and parse services.yaml
 */
function loadServicesYaml(): Record<string, ServiceConfig> {
    if (servicesCache) {
        return servicesCache
    }

    // Client-side handling
    if (typeof window !== 'undefined') {
        const clientConfig: Record<string, ServiceConfig> = {}
        for (const [k, v] of Object.entries(CLIENT_FALLBACKS)) {
            clientConfig[k] = { port: v, healthPath: '/health', group: 'shim' }
        }
        servicesCache = clientConfig
        return clientConfig
    }

    try {
        const fs = require('fs')
        const filePath = getServicesYamlPath()
        
        if (!filePath) {
            console.warn('[ServiceConfig] Could not locate services.yaml')
            return {}
        }
        
        const fileContent = fs.readFileSync(filePath, 'utf8')
        const data = parse(fileContent)
        
        const config: Record<string, ServiceConfig> = {}
        
        if (data && data.services) {
            for (const [name, svc] of Object.entries(data.services) as [string, any][]) {
                // Normalize keys
                const key = name.toLowerCase().replace('aither', '')
                const entry: ServiceConfig = {
                    port: svc.port || 8080,
                    healthPath: svc.health_path || '/health',
                    description: svc.description,
                    module: svc.module,
                    group: svc.group
                }
                config[key] = entry
                
                // Also store by full name
                if (name.toLowerCase() !== key) {
                    config[name.toLowerCase()] = entry
                }
                
                // Process aliases - absorbed services resolve to parent
                if (Array.isArray(svc.aliases)) {
                    for (const alias of svc.aliases) {
                        const aliasKey = String(alias).toLowerCase().replace('aither', '')
                        if (!config[aliasKey]) {
                            config[aliasKey] = entry
                        }
                        const fullAliasKey = String(alias).toLowerCase()
                        if (fullAliasKey !== aliasKey && !config[fullAliasKey]) {
                            config[fullAliasKey] = entry
                        }
                    }
                }
            }
        }
        
        console.log(`[ServiceConfig] Loaded ${Object.keys(config).length} services from services.yaml`)
        servicesCache = config
        return config
    } catch (error) {
        console.error('[ServiceConfig] Failed to load services.yaml:', error)
        return {}
    }
}


/**
 * Get all services
 */
export function getServices(): Record<string, ServiceConfig> {
    return loadServicesYaml()
}

/**
 * Get service URL by name
 * Checks environment variable overrides first (Docker-compatible),
 * then falls back to localhost.
 */
export function getServiceUrl(service: string): string {
    // Check environment variable override first (e.g. AITHERRELAY_URL, AITHERGENESIS_URL)
    const envVarName = `AITHER${service.toUpperCase()}_URL`
    const envUrl = typeof process !== 'undefined' ? process.env[envVarName] : undefined
    if (envUrl) return envUrl

    const services = loadServicesYaml()
    const key = service.toLowerCase()
    const config = services[key]

    if (config) {
        return `http://localhost:${config.port}`
    }

    // Fall back to CLIENT_FALLBACKS (handles aliases like 'intent' even when YAML read fails)
    const fallbackPort = CLIENT_FALLBACKS[key]
    if (fallbackPort) {
        return `http://localhost:${fallbackPort}`
    }

    console.warn(`[ServiceConfig] Unknown service: ${service}`)
    return `http://localhost:8080`
}

/**
 * Get service port by name
 */
export function getServicePort(service: string): number | undefined {
    const services = loadServicesYaml()
    const key = service.toLowerCase()
    return services[key]?.port ?? CLIENT_FALLBACKS[key]
}

/**
 * Get service config by name
 */
export function getServiceConfig(service: string): ServiceConfig | undefined {
    const services = loadServicesYaml()
    return services[service.toLowerCase()]
}

// For backwards compatibility - lazy loaded
export const SERVICES = new Proxy({} as Record<string, ServiceConfig>, {
    get(_, prop: string) {
        const services = loadServicesYaml()
        return services[prop.toLowerCase()]
    },
    ownKeys() {
        return Object.keys(loadServicesYaml())
    },
    getOwnPropertyDescriptor(_, prop: string) {
        const services = loadServicesYaml()
        if (prop.toLowerCase() in services) {
            return { enumerable: true, configurable: true, value: services[prop.toLowerCase()] }
        }
        return undefined
    }
})
