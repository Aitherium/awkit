'use client'

/**
 * KnowledgeGraphCanvas — d3-force + Canvas2D knowledge graph visualization
 *
 * Replicates the AitherScope (scope-view.ts) d3-force pattern for React.
 * Renders document nodes colored by freshness grade with interactive
 * pan/zoom, node drag, and click-to-inspect.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
  type Simulation,
} from 'd3-force'

// ── Types ────────────────────────────────────────────────────────────

export interface KnowledgeNode {
  id: string
  name: string
  freshness: number
  grade: string
  is_orphan: boolean
}

export interface KnowledgeEdge {
  source: string
  target: string
  type: string
}

export interface KnowledgeGraphCanvasProps {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  heatmapMode?: 'freshness' | 'none'
  width?: number
  height?: number
  onNodeClick?: (node: KnowledgeNode) => void
  onNodeDoubleClick?: (node: KnowledgeNode) => void
  className?: string
}

// ── Internal sim types ───────────────────────────────────────────────

interface SimNode extends SimulationNodeDatum {
  data: KnowledgeNode
  radius: number
  color: string
  glowColor: string
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  data: KnowledgeEdge
  color: string
  dashed: boolean
}

// ── Color maps ───────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, { fill: string; glow: string }> = {
  A: { fill: '#10b981', glow: '#34d399' },
  B: { fill: '#06b6d4', glow: '#22d3ee' },
  C: { fill: '#f59e0b', glow: '#fbbf24' },
  D: { fill: '#f97316', glow: '#fb923c' },
  F: { fill: '#ef4444', glow: '#f87171' },
}

const FRESHNESS_GRADIENT = (score: number): { fill: string; glow: string } => {
  if (score >= 0.8) return { fill: '#10b981', glow: '#34d399' }
  if (score >= 0.6) return { fill: '#22c55e', glow: '#4ade80' }
  if (score >= 0.4) return { fill: '#eab308', glow: '#facc15' }
  if (score >= 0.2) return { fill: '#f97316', glow: '#fb923c' }
  return { fill: '#ef4444', glow: '#f87171' }
}

const EDGE_COLORS: Record<string, string> = {
  references: 'rgba(99, 102, 241, 0.5)',
  cites: 'rgba(16, 185, 129, 0.5)',
  links_to: 'rgba(148, 163, 184, 0.4)',
  duplicates: 'rgba(239, 68, 68, 0.6)',
  member_of: 'rgba(139, 92, 246, 0.4)',
}

const ORPHAN_GLOW = '#ef4444'

// ── Component ────────────────────────────────────────────────────────

export default function KnowledgeGraphCanvas({
  nodes,
  edges,
  heatmapMode = 'freshness',
  width: propWidth,
  height: propHeight,
  onNodeClick,
  onNodeDoubleClick,
  className,
}: KnowledgeGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const simNodesRef = useRef<SimNode[]>([])
  const simLinksRef = useRef<SimLink[]>([])
  const transformRef = useRef({ x: 0, y: 0, k: 1 })
  const dragRef = useRef<{ node: SimNode | null; active: boolean }>({ node: null, active: false })
  const panRef = useRef<{ active: boolean; startX: number; startY: number }>({ active: false, startX: 0, startY: 0 })
  const animRef = useRef(0)
  const [hoveredNode, setHoveredNode] = useState<KnowledgeNode | null>(null)
  const [canvasSize, setCanvasSize] = useState({ w: propWidth || 800, h: propHeight || 600 })

  // Resize observer
  useEffect(() => {
    if (propWidth && propHeight) {
      setCanvasSize({ w: propWidth, h: propHeight })
      return
    }
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) setCanvasSize({ w: width, h: height })
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [propWidth, propHeight])

  // Build simulation
  useEffect(() => {
    if (!nodes.length) return

    const nodeMap = new Map<string, SimNode>()
    const simNodes: SimNode[] = nodes.map((n) => {
      const colors = heatmapMode === 'freshness'
        ? FRESHNESS_GRADIENT(n.freshness)
        : (GRADE_COLORS[n.grade] || GRADE_COLORS.C)
      const sn: SimNode = {
        data: n,
        radius: Math.max(6, Math.min(20, 8 + n.freshness * 12)),
        color: colors.fill,
        glowColor: n.is_orphan ? ORPHAN_GLOW : colors.glow,
      }
      nodeMap.set(n.id, sn)
      return sn
    })

    const simLinks: SimLink[] = edges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        source: nodeMap.get(e.source)!,
        target: nodeMap.get(e.target)!,
        data: e,
        color: EDGE_COLORS[e.type] || 'rgba(148, 163, 184, 0.3)',
        dashed: e.type === 'duplicates',
      }))

    simNodesRef.current = simNodes
    simLinksRef.current = simLinks

    const sim = forceSimulation<SimNode>(simNodes)
      .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.data.id).distance(80).strength(0.3))
      .force('charge', forceManyBody<SimNode>().strength(-120))
      .force('center', forceCenter(canvasSize.w / 2, canvasSize.h / 2))
      .force('collide', forceCollide<SimNode>().radius((d) => d.radius + 4))
      .alphaDecay(0.02)

    sim.on('tick', () => draw())
    simRef.current = sim

    return () => {
      sim.stop()
      cancelAnimationFrame(animRef.current)
    }
  }, [nodes, edges, heatmapMode, canvasSize.w, canvasSize.h])

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { w, h } = canvasSize
    const dpr = window.devicePixelRatio || 1
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.scale(dpr, dpr)

    const t = transformRef.current
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, w, h)

    ctx.save()
    ctx.translate(t.x, t.y)
    ctx.scale(t.k, t.k)

    // Edges
    for (const link of simLinksRef.current) {
      const s = link.source as SimNode
      const tgt = link.target as SimNode
      if (s.x == null || tgt.x == null) continue
      ctx.beginPath()
      ctx.strokeStyle = link.color
      ctx.lineWidth = 1.2
      if (link.dashed) ctx.setLineDash([4, 4])
      else ctx.setLineDash([])
      ctx.moveTo(s.x, s.y!)
      ctx.lineTo(tgt.x, tgt.y!)
      ctx.stroke()
    }
    ctx.setLineDash([])

    // Nodes
    for (const node of simNodesRef.current) {
      if (node.x == null || node.y == null) continue

      // Glow for orphans
      if (node.data.is_orphan) {
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2)
        ctx.fillStyle = `${ORPHAN_GLOW}33`
        ctx.fill()
      }

      // Node circle
      ctx.beginPath()
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
      ctx.fillStyle = node.color
      ctx.fill()
      ctx.strokeStyle = node.glowColor
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Label
      ctx.fillStyle = '#e2e8f0'
      ctx.font = '10px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      const label = node.data.name.length > 20 ? node.data.name.slice(0, 18) + '...' : node.data.name
      ctx.fillText(label, node.x, node.y + node.radius + 12)
    }

    ctx.restore()
  }, [canvasSize])

  // Mouse → canvas coords
  const canvasToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const t = transformRef.current
    return {
      x: (clientX - rect.left - t.x) / t.k,
      y: (clientY - rect.top - t.y) / t.k,
    }
  }, [])

  const findNode = useCallback((wx: number, wy: number): SimNode | null => {
    for (const n of simNodesRef.current) {
      if (n.x == null || n.y == null) continue
      const dx = n.x - wx, dy = n.y! - wy
      if (dx * dx + dy * dy < (n.radius + 4) * (n.radius + 4)) return n
    }
    return null
  }, [])

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const { x, y } = canvasToWorld(e.clientX, e.clientY)
    const node = findNode(x, y)
    if (node) {
      dragRef.current = { node, active: true }
      node.fx = node.x
      node.fy = node.y
      simRef.current?.alphaTarget(0.3).restart()
    } else {
      panRef.current = { active: true, startX: e.clientX - transformRef.current.x, startY: e.clientY - transformRef.current.y }
    }
  }, [canvasToWorld, findNode])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragRef.current.active && dragRef.current.node) {
      const { x, y } = canvasToWorld(e.clientX, e.clientY)
      dragRef.current.node.fx = x
      dragRef.current.node.fy = y
      return
    }
    if (panRef.current.active) {
      transformRef.current.x = e.clientX - panRef.current.startX
      transformRef.current.y = e.clientY - panRef.current.startY
      draw()
      return
    }
    const { x, y } = canvasToWorld(e.clientX, e.clientY)
    const node = findNode(x, y)
    setHoveredNode(node?.data ?? null)
    const canvas = canvasRef.current
    if (canvas) canvas.style.cursor = node ? 'pointer' : 'grab'
  }, [canvasToWorld, findNode, draw])

  const handleMouseUp = useCallback(() => {
    if (dragRef.current.active && dragRef.current.node) {
      dragRef.current.node.fx = null
      dragRef.current.node.fy = null
      simRef.current?.alphaTarget(0)
    }
    dragRef.current = { node: null, active: false }
    panRef.current.active = false
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    const { x, y } = canvasToWorld(e.clientX, e.clientY)
    const node = findNode(x, y)
    if (node && onNodeClick) onNodeClick(node.data)
  }, [canvasToWorld, findNode, onNodeClick])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const { x, y } = canvasToWorld(e.clientX, e.clientY)
    const node = findNode(x, y)
    if (node && onNodeDoubleClick) onNodeDoubleClick(node.data)
  }, [canvasToWorld, findNode, onNodeDoubleClick])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const t = transformRef.current
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    t.x = mx - (mx - t.x) * delta
    t.y = my - (my - t.y) * delta
    t.k *= delta
    t.k = Math.max(0.1, Math.min(5, t.k))
    draw()
  }, [draw])

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 400, background: '#0f172a', borderRadius: 8, overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
      />
      {hoveredNode && (
        <div style={{
          position: 'absolute', top: 8, right: 8, background: '#1e293b', color: '#e2e8f0',
          padding: '8px 12px', borderRadius: 6, fontSize: 12, maxWidth: 220, pointerEvents: 'none',
          border: '1px solid #334155',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{hoveredNode.name}</div>
          <div>Freshness: {(hoveredNode.freshness * 100).toFixed(0)}% ({hoveredNode.grade})</div>
          {hoveredNode.is_orphan && <div style={{ color: '#ef4444', marginTop: 2 }}>Orphan (no inbound refs)</div>}
        </div>
      )}
      {!nodes.length && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#64748b', fontSize: 14,
        }}>
          No graph data. Run an audit first.
        </div>
      )}
    </div>
  )
}
