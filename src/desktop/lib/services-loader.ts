/**
 * AitherOS Services Loader - Single Source of Truth
 * 
 * Loads services directly from services.yaml (static file in public/).
 * All components should use this instead of hardcoding service arrays.
 * 
 * Usage:
 *   const { services, loading, error } = useServices();
 *   // or for one-time load:
 *   const services = await loadServicesYaml();
 */

import { parse as parseYaml } from 'yaml';

// ============================================================================
// TYPES
// ============================================================================

export interface ServiceDef {
  name: string;
  port: number;
  group: string;
  type: 'service' | 'agent' | 'external' | 'mcp' | 'framework' | 'protocol';
  enabled?: boolean;
  description?: string;
  module?: string;
  depends_on?: string[];
  endpoints?: Record<string, string>;
  config_keys?: Record<string, string>;
  features?: string[];
  integrates_with?: string[];
  boot_tier?: number;
  path?: string;
  logs?: string;
  docs?: string;
  pain_sensors?: Record<string, number>;
  layer?: number | null;
}

// ============================================================================
// YAML LOADER
// ============================================================================

let cachedServices: ServiceDef[] | null = null;
let loadPromise: Promise<ServiceDef[]> | null = null;

/**
 * Load and parse services from services.yaml
 * Results are cached after first load
 */
export async function loadServicesYaml(): Promise<ServiceDef[]> {
  // Return cached if available
  if (cachedServices) {
    return cachedServices;
  }

  // Return existing promise if loading
  if (loadPromise) {
    return loadPromise;
  }

  // Start loading — fetch from server-side API route which reads canonical
  // services.yaml from disk (works in all deployment modes)
  loadPromise = (async () => {
    try {
      // Primary: server-side API that reads services.yaml from disk
      const response = await fetch('/api/services/yaml');

      if (!response.ok) {
        console.warn('[ServicesLoader] API route returned', response.status, '— trying static fallback');
        return await loadFromStaticFallback();
      }

      const data = await response.json();
      const services: ServiceDef[] = (data.services || []).map((s: any) => ({
        ...s,
        type: s.type as ServiceDef['type'],
      }));

      console.log(`[ServicesLoader] Loaded ${services.length} services from API`);
      cachedServices = services;
      return services;

    } catch (error) {
      console.warn('[ServicesLoader] API fetch failed, trying static fallback:', error);
      return await loadFromStaticFallback();
    }
  })();

  /**
   * Fallback: try the static YAML file from public/data/ (dev mode only)
   */
  async function loadFromStaticFallback(): Promise<ServiceDef[]> {
    try {
      const response = await fetch('/data/service-directory.yaml');
      if (!response.ok) {
        console.error('[ServicesLoader] Static fallback also failed:', response.status);
        return [];
      }

      const text = await response.text();
      // Verify it's actually YAML, not an HTML page (catch-all route)
      if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
        console.error('[ServicesLoader] Static fallback returned HTML instead of YAML — route interception detected');
        return [];
      }

      const data = parseYaml(text) as { services?: Record<string, any> };
      const services: ServiceDef[] = [];

      for (const [name, config] of Object.entries(data.services || {})) {
        if (!config || !config.port || config.port <= 0) continue;
        if (config.enabled === false) continue;

        const group = config.group || 'core';
        const module = config.module || '';
        const nameLower = name.toLowerCase();

        let type: ServiceDef['type'] = 'service';
        if (nameLower.startsWith('mcp') || group === 'mcp') type = 'mcp';
        else if (module === 'uvicorn' || nameLower === 'canvas') type = 'external';
        else if (module?.includes('agents') || nameLower.includes('agent') ||
          ['orchestrator', 'demiurge', 'director', 'assistant', 'council', 'saga', 'forge', 'a2a',
            'intent', 'lyra', 'atlas', 'executive', 'testing', 'aeon'].includes(nameLower)) type = 'agent';

        services.push({
          name,
          port: config.port,
          group,
          type: config.type || type,
          enabled: config.enabled !== false,
          description: config.description || name,
          module,
          depends_on: config.depends_on || [],
          endpoints: config.endpoints || {},
          config_keys: config.config_keys || {},
          features: config.features || [],
          integrates_with: config.integrates_with || [],
          boot_tier: config.boot_tier,
          path: config.path,
          logs: config.logs,
          docs: config.docs,
          pain_sensors: config.pain_sensors || {},
        });
      }

      console.log(`[ServicesLoader] Loaded ${services.length} services from static YAML fallback`);
      cachedServices = services;
      return services;
    } catch (error) {
      console.error('[ServicesLoader] All loading methods failed:', error);
      return [];
    }
  }

  return loadPromise;
}

/**
 * Get services synchronously (returns cached or empty array)
 * Use loadServicesYaml() for async loading with proper waiting
 */
export function getServicesSync(): ServiceDef[] {
  return cachedServices || [];
}

/**
 * Clear the cache (useful for hot reload in dev)
 */
export function clearServicesCache(): void {
  cachedServices = null;
  loadPromise = null;
}

/**
 * Get a service by name (case-insensitive)
 */
export function getServiceByName(name: string): ServiceDef | undefined {
  const services = getServicesSync();
  const nameLower = name.toLowerCase();
  return services.find(s => s.name.toLowerCase() === nameLower);
}

/**
 * Get a service by port
 */
export function getServiceByPort(port: number): ServiceDef | undefined {
  const services = getServicesSync();
  return services.find(s => s.port === port);
}

/**
 * Get services by group
 */
export function getServicesByGroup(group: string): ServiceDef[] {
  const services = getServicesSync();
  return services.filter(s => s.group === group);
}

// ============================================================================
// REACT HOOK
// ============================================================================

import { useState, useEffect } from 'react';

export function useServices() {
  const [services, setServices] = useState<ServiceDef[]>(cachedServices || []);
  const [loading, setLoading] = useState(!cachedServices);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (cachedServices) {
      setServices(cachedServices);
      setLoading(false);
      return;
    }

    loadServicesYaml()
      .then(setServices)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  return { services, loading, error };
}
