'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BeadSpace } from '@aitherium/bead-space/react'
import type { BeadData, BeadNode } from '@aitherium/bead-space'
import {
  COMPUTE_CLUSTER_ORDER,
  fromAgentActivity,
  fromBacklogTriage,
  fromComputePool,
  fromConstellation,
  fromEcosystem,
  fromDevices,
  fromFleet,
  fromMeshRouting,
  fromRegistry,
  fromScopeGraph,
  fromTaskHub,
  type AgentTaskRecord,
  type ComputePoolRecord,
  type ConstellationRecord,
  type EcosystemBrickRecord,
  type DeviceRecord,
  type FleetServiceRecord,
  type RegistryEntryRecord,
  type RoutingTraceRecord,
  type ScopeGraphRecord,
  type TriageRunRecord,
} from '@aitherium/bead-space'
import '@aitherium/bead-space/bead-space.css'
import { useAuth } from '../hooks'
import Tooltip from '../ui/Tooltip'

export interface BeadSpacePanelProps {
  apiBase?: string
}

type DataSource =
  | 'work'
  | 'agents'
  | 'fleet'
  | 'constellation'
  | 'compute'
  | 'scope'
  | 'registry'
  | 'mesh'
  | 'mine'
  | 'triage'
  | 'ecosystem'

interface SourceConfig {
  label: string
  endpoint: string | null
  hint: string
  /**
   * Every source needs one. None of these endpoints speak BeadData natively — they return
   * their own domain shape, and the adapters in @aitherium/bead-space translate. A source
   * without an adapter silently renders an empty universe.
   */
  adapt: (payload: any) => BeadData
  /**
   * Pins legend/colour order for this source. Without it the engine orders clusters by
   * SIZE, which assigns colours by how many rows a bucket happens to hold — that is how the
   * debt view gave P2 (the largest bucket) alarm-red and P0 green.
   */
  clusterOrder?: string[]
}

/** Payloads arrive as an array, or wrapped under a key. Accept both rather than guess. */
function unwrap(payload: any, ...keys: string[]): any[] {
  if (Array.isArray(payload)) return payload
  for (const key of keys) {
    const value = payload?.[key]
    if (Array.isArray(value)) return value
    // A map keyed by name (services.yaml style) — carry the key in as `name`.
    if (value && typeof value === 'object') {
      return Object.entries(value).map(([name, entry]) => ({ name, ...(entry as object) }))
    }
  }
  return []
}

/*
 * Paths are RELATIVE to apiBase. Two traps are baked into this map, both found live:
 *
 * 1. DOUBLED PATH — apiBase already carries `/api`. An endpoint starting with `/api`
 *    produced `/api/api/tasks/graph`.
 * 2. INVENTED ROUTES — the first version pointed at `/tasks/graph`, `/fleet/graph`,
 *    `/constellation/graph`. NONE of those exist; only `/api/services` did. Four of five
 *    tabs could never have loaded. Every path below was verified against
 *    AitherVeil/src/app/api/**\/route.ts before being written here.
 */
const SOURCES: Record<DataSource, SourceConfig> = {
  work: {
    label: 'Work',
    endpoint: '/tasks',
    hint: 'Tasks and blockers',
    // ⚠️ TaskHub is IN-MEMORY — a Genesis restart empties it, and it has no blocker field
    // (parent/child only). An empty Work tab is frequently the truth, not a bug.
    adapt: (p) => fromTaskHub(unwrap(p, 'tasks', 'items', 'data')),
  },
  agents: {
    label: 'Agents',
    endpoint: '/agent-activity',
    hint: 'Agent swarm at work — live task activity',
    // TaskHub tasks filtered to agent-related work. Each task becomes a planet,
    // agents own planets they're actively executing. Empty when no tasks in-flight.
    adapt: (p) => fromAgentActivity(unwrap(p, 'tasks', 'items', 'data') as AgentTaskRecord[]),
  },
  fleet: {
    label: 'Fleet',
    endpoint: '/services',
    hint: 'Services and health',
    adapt: (p) => fromFleet(unwrap(p, 'services', 'items', 'data') as FleetServiceRecord[]),
  },
  ecosystem: {
    label: 'Aither World',
    // Served by AitherVeil/src/app/api/ecosystem/route.ts, written in the SAME
    // change as this entry. This file's own header records four of five sources
    // once pointing at endpoints that did not exist; the fix is to write the
    // route first and check it, not to trust the name.
    endpoint: '/ecosystem',
    hint: 'The public bricks around AitherOS — what a stranger can adopt',
    adapt: (p) => fromEcosystem(unwrap(p, 'bricks', 'items', 'data') as EcosystemBrickRecord[]),
  },
  constellation: {
    label: 'Constellation',
    endpoint: '/constellation',
    hint: 'Agent roster and activity',
    adapt: (p) => fromConstellation(p as ConstellationRecord),
  },
  compute: {
    label: 'Compute',
    // AitherMesh's node registry via Veil. NOTE the sibling `/compute` (no `/pool`) returns
    // fabric health, NOT nodes — adapting that one yields an empty universe.
    endpoint: '/compute/pool',
    hint: 'GPU pool, VRAM and what is serving',
    adapt: (p) => fromComputePool(p as ComputePoolRecord),
    clusterOrder: COMPUTE_CLUSTER_ORDER,
  },
  scope: {
    label: 'Scope',
    // Served by the scope/[...path] catch-all, which proxies to Genesis /scope/graph/unified.
    endpoint: '/scope/graph/unified',
    hint: 'Dependencies and complexity',
    adapt: (p) => fromScopeGraph(p as ScopeGraphRecord, { clusterBy: 'group' }),
  },
  registry: {
    label: 'Registry',
    endpoint: '/services/registry',
    hint: 'Service catalogue and versions',
    adapt: (p) => fromRegistry(unwrap(p, 'services', 'items') as RegistryEntryRecord[]),
  },
  mesh: {
    label: 'Mesh',
    // Served by AitherVeil/src/app/api/mesh/routing/route.ts, which streams the
    // coordinator's routing-trace log. Endpoints are planets, meshes are galaxies,
    // agent hops are links, and every node's meta says which layers/experts/GPUs it
    // served — the LLM's mind, across the fabric.
    endpoint: '/mesh/routing',
    hint: 'AitherNet routing — who served which layers/experts, agent hops between meshes',
    adapt: (p) =>
      fromMeshRouting(unwrap(p, 'traces', 'records', 'items', 'data') as RoutingTraceRecord[]),
  },
  mine: {
    label: 'Mine',
    // The authenticated user's enrolled endpoints. Served by the host app's
    // GET /api/devices (a tenant agent's devices router). The adapt below is the
    // owner-less default; the component re-resolves it with the signed-in
    // user's display name so their ship orbits their own hardware.
    endpoint: '/devices',
    hint: 'Your hardware — endpoints you enrolled, alive right now',
    adapt: (p) => fromDevices(unwrap(p, 'devices', 'items') as DeviceRecord[]),
  },
  triage: {
    label: 'Backlog Triage',
    // The autonomous GitHub PR/issue sweep. Served by
    // AitherVeil/src/app/api/backlog-triage/route.ts (scheduler execution history;
    // each run carries the tick report in action_result). Consecutive runs link
    // `related`; a closed-7-PRs run is a 'done' planet, a dry-run run stays 'open'.
    endpoint: '/backlog-triage',
    hint: 'GitHub PR/issue sweep — every run, what it closed vs held for humans',
    adapt: (p) => fromBacklogTriage(unwrap(p, 'runs', 'executions') as TriageRunRecord[]),
  },
}

/**
 * Custom hook for sources that need adapter transformation.
 * Fetches raw graph data and transforms it using the appropriate adapter.
 */
function useAdaptedBeadData(
  url: string | null,
  adapt: (payload: any) => BeadData,
  { intervalMs = 15_000 }: { intervalMs?: number } = {},
): { data: BeadData; error: Error | null; loading: boolean } {
  const [data, setData] = useState<BeadData>({ nodes: [], links: [] })
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(url !== null)
  const lastPayload = useRef<string>('')

  useEffect(() => {
    if (!url) return
    let cancelled = false
    const controller = new AbortController()

    async function poll() {
      try {
        // credentials: the 'mine' source is session-authenticated (a 401 must
        // surface as an error, not as an empty sky).
        const response = await fetch(url!, { signal: controller.signal, credentials: 'include' })
        if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
        const text = await response.text()
        if (cancelled) return
        if (text !== lastPayload.current) {
          lastPayload.current = text
          const parsed = JSON.parse(text)
          /*
           * These portal routes answer failures with BOTH an error field AND an empty
           * collection — verified live 2026-07-25:
           *   /api/services          {"success":false,"error":"spawn pwsh ENOENT","services":[]}
           *   /api/services/registry {"success":false,"error":"awnode returned 404","services":[]}
           *   /api/tasks            {"error":"HTTP 404","tasks":[]}
           * A consumer that reads only the collection renders an empty universe and the user
           * concludes "there is no work" when the truth is "nothing could be read". Refuse to
           * paint an empty sky over a failure.
           */
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            if (parsed.success === false || typeof parsed.error === 'string') {
              throw new Error(String(parsed.error ?? 'source reported failure'))
            }
          }
          // An adapter that throws on an unexpected shape must surface as an ERROR, not as
          // an empty universe — "the shape changed" and "there is no work" must not look
          // identical to the user.
          const transformed = adapt(parsed)
          setData({ nodes: transformed.nodes ?? [], links: transformed.links ?? [] })
        }
        setError(null)
      } catch (cause) {
        if (cancelled || (cause as Error).name === 'AbortError') return
        setError(cause instanceof Error ? cause : new Error(String(cause)))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void poll()
    const timer = window.setInterval(poll, intervalMs)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [url, adapt, intervalMs])

  return { data, error, loading }
}

export default function BeadSpacePanel({
  apiBase = '/api',
}: BeadSpacePanelProps) {
  const [source, setSource] = useState<DataSource>('work')
  const [selectedNode, setSelectedNode] = useState<BeadNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const auth = useAuth()
  // The 'mine' source re-resolves its adapter with the signed-in owner so their
  // ship orbits their own planets; the static config falls back to owner-less.
  const ownerName = auth.user?.display_name || null
  const sourceConfig = useMemo(() => {
    const cfg = SOURCES[source]
    if (source !== 'mine') return cfg
    return {
      ...cfg,
      adapt: (p: unknown) =>
        fromDevices(unwrap(p, 'devices', 'items') as DeviceRecord[], { owner: ownerName }),
    }
  }, [source, ownerName])

  const endpoint = sourceConfig.endpoint ? `${apiBase}${sourceConfig.endpoint}` : null

  // ONE path for every source. None of these endpoints speak BeadData natively, so the
  // previous two-hook split just meant the non-adapted sources fed raw domain JSON to the
  // renderer and drew nothing.
  const {
    data,
    error: fetchError,
    loading: dataLoading,
  } = useAdaptedBeadData(endpoint, sourceConfig.adapt, { intervalMs: 15_000 })

  useEffect(() => {
    setLoading(dataLoading)
  }, [dataLoading])

  useEffect(() => {
    if (fetchError) {
      setError(fetchError.message)
    } else {
      setError('')
    }
  }, [fetchError])

  const handleSelectNode = useCallback((node: BeadNode | null) => {
    setSelectedNode(node)
  }, [])

  const handleSourceChange = (newSource: DataSource) => {
    setSource(newSource)
    setSelectedNode(null)
  }

  const isEmpty = !loading && data.nodes.length === 0

  return (
    <div
      data-tour="bead-space"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Tooltip label="The universe — every task, service, agent and GPU pool is a planet; your own hardware gets a planet with a ship orbiting it">
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Universe</h2>
        </Tooltip>
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginLeft: 'auto',
            fontSize: 13,
          }}
        >
          {(Object.entries(SOURCES) as Array<[DataSource, SourceConfig]>).map(
            ([key, cfg]) => {
              const tabBtn = (
                <button
                  key={key}
                  onClick={() => handleSourceChange(key)}
                  style={{
                    padding: '6px 12px',
                    border: source === key ? '1px solid #3b82f6' : '1px solid #d1d5db',
                    borderRadius: 4,
                    background: source === key ? '#eff6ff' : '#fff',
                    color: source === key ? '#3b82f6' : '#6b7280',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: source === key ? 600 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  {cfg.label}
                </button>
              )
              // Only the Mine tab explains itself; the others are self-evident
              // and a bubble over the whole tab row would be noise.
              return key === 'mine'
                ? <Tooltip key={key} label={cfg.hint}>{tabBtn}</Tooltip>
                : tabBtn
            }
          )}
        </div>
      </div>

      {/* Hint */}
      <div
        style={{
          padding: '8px 16px',
          background: '#f9fafb',
          borderBottom: '1px solid #f3f4f6',
          fontSize: 12,
          color: '#6b7280',
        }}
      >
        {sourceConfig.hint}
      </div>

      {/* Canvas + Details */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          gap: 0,
        }}
      >
        {/* Canvas */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            borderRight: selectedNode ? '1px solid #e5e7eb' : 'none',
          }}
        >
          {error && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 10,
                margin: '12px',
                padding: '12px',
                background: '#fef2f2',
                color: '#dc2626',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}

          {isEmpty && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: '#9ca3af',
                fontSize: 14,
              }}
            >
              No data available for {sourceConfig.label}
            </div>
          )}

          {!isEmpty && (
            <BeadSpace
              // Remount per source: these are different universes, and carrying planet
              // positions / orbit phase across a source switch reads as the old graph
              // melting into the new one. It also lets clusterOrder take effect, since the
              // engine reads it at construction.
              key={source}
              data={data}
              style={{ height: '100%' }}
              onSelect={handleSelectNode}
              assetRoot="/assets/kenney-simple-space"
              clusterOrder={sourceConfig.clusterOrder}
            />
          )}
        </div>

        {/* Details panel */}
        {selectedNode && (
          <div
            style={{
              // Was a non-shrinking 280px. The room summons this into the title
              // block, whose wide floor is 380px — so the details pane took 280 of
              // it and left ~100px for the universe it is meant to annotate.
              // Shrinks with the surface now, and never below readable.
              flex: '0 1 280px',
              minWidth: 180,
              overflow: 'auto',
              borderLeft: '1px solid #e5e7eb',
              padding: '16px',
              background: '#fff',
            }}
          >
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                {selectedNode.title}
              </h3>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {selectedNode.id}
              </div>
            </div>

            {selectedNode.href && (
              <div style={{ marginBottom: 12 }}>
                <a
                  href={selectedNode.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    padding: '6px 12px',
                    background: '#3b82f6',
                    color: '#fff',
                    textDecoration: 'none',
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Open
                </a>
              </div>
            )}

            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 4 }}>
                  STATUS
                </div>
                <div
                  style={{
                    padding: '4px 8px',
                    background:
                      selectedNode.status === 'done'
                        ? '#dcfce7'
                        : selectedNode.status === 'blocked'
                          ? '#fee2e2'
                          : selectedNode.status === 'in_progress'
                            ? '#dbeafe'
                            : '#fef3c7',
                    color:
                      selectedNode.status === 'done'
                        ? '#166534'
                        : selectedNode.status === 'blocked'
                          ? '#991b1b'
                          : selectedNode.status === 'in_progress'
                            ? '#0c4a6e'
                            : '#92400e',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 500,
                    display: 'inline-block',
                  }}
                >
                  {selectedNode.status}
                </div>
              </div>

              {selectedNode.cluster && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 4 }}>
                    CLUSTER
                  </div>
                  <div style={{ fontSize: 13 }}>{selectedNode.cluster}</div>
                </div>
              )}

              {selectedNode.assignee && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 4 }}>
                    ASSIGNED TO
                  </div>
                  <div style={{ fontSize: 13 }}>{selectedNode.assignee}</div>
                </div>
              )}

              {selectedNode.createdAt && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 4 }}>
                    CREATED
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {new Date(selectedNode.createdAt).toLocaleString()}
                  </div>
                </div>
              )}

              {selectedNode.stateStartedAt && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 4 }}>
                    STATE CHANGED
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {new Date(selectedNode.stateStartedAt).toLocaleString()}
                  </div>
                </div>
              )}

              {selectedNode.meta && Object.keys(selectedNode.meta).length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 4 }}>
                    METADATA
                  </div>
                  <pre
                    style={{
                      fontSize: 11,
                      color: '#6b7280',
                      background: '#f9fafb',
                      padding: '8px',
                      borderRadius: 4,
                      overflow: 'auto',
                      margin: 0,
                    }}
                  >
                    {JSON.stringify(selectedNode.meta, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedNode(null)}
              style={{
                marginTop: 16,
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                background: '#fff',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
