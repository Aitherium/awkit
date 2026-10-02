'use client'

/**
 * NeuralMinimap
 * =============
 * 
 * A small, live neural-field minimap rendered as the desktop wallpaper.
 * Shows service nodes as glowing dots with animated connection lines.
 * 
 * Click to expand into a full-screen overlay of the NeuralField.
 * The minimap renders a simplified canvas version (no overlays/panels)
 * to stay lightweight as a background element.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Maximize2, Activity } from 'lucide-react'
import { useServices, type ServiceDef } from '../../lib/services-loader'
import { isDemoMode } from '../../lib/utils'

// ============================================================================
// TYPES
// ============================================================================

interface MinimapNode {
  id: string
  name: string
  x: number
  y: number
  layer: number
  status: 'online' | 'offline' | 'degraded' | 'unknown'
  radius: number
  color: string
}

interface MinimapConnection {
  from: MinimapNode
  to: MinimapNode
  active: boolean
}

// Layer colors (matches NeuralField)
const LAYER_COLORS: Record<number, string> = {
  [-1]: '#f43f5e',
  [0]: '#5EC9CC',
  [1]: '#06b6d4',
  [2]: '#22c55e',
  [3]: '#3b82f6',
  [4]: '#f59e0b',
  [5]: '#ec4899',
  [6]: '#14b8a6',
  [7]: '#5EC9CC',
  [8]: '#ef4444',
  [9]: '#84cc16',
  [10]: '#5EC9CC',
}

const GROUP_TO_LAYER: Record<string, number> = {
  bootloader: -1,
  infrastructure: 0,
  core: 1,
  perception: 2,
  cognition: 3,
  memory: 4,
  agents: 5,
  gpu: 6,
  autonomic: 7,
  automation: 7,
  security: 8,
  mesh: 8,
  training: 9,
  evolution: 9,
  creative: 9,
  communication: 7,
  social: 5,
  mcp: 1,
  ui: 10,
  default: 1,
}

// Demo services for when backend is unavailable
const DEMO_SERVICES: MinimapNode[] = (() => {
  const layers = [
    { layer: -1, names: ['Genesis'] },
    { layer: 0, names: ['Pulse', 'Watch', 'Chronicle'] },
    { layer: 1, names: ['Node', 'Nexus', 'Strata', 'Registry'] },
    { layer: 2, names: ['Sense', 'Vision', 'Voice'] },
    { layer: 3, names: ['Mind', 'Reasoning', 'Cortex', 'Faculties', 'Demiurge'] },
    { layer: 4, names: ['Spirit', 'Atlas', 'Lyra'] },
    { layer: 5, names: ['Agents', 'Hera', 'Vera', 'Saga'] },
    { layer: 6, names: ['LLM', 'Ollama'] },
    { layer: 7, names: ['Scheduler', 'Autonomic', 'Flux'] },
    { layer: 8, names: ['Secrets', 'Inspector', 'Sentinel'] },
    { layer: 9, names: ['Trainer', 'Evolution'] },
    { layer: 10, names: ['Veil', 'Portal'] },
  ]
  const nodes: MinimapNode[] = []
  layers.forEach(l => {
    l.names.forEach((name, i) => {
      nodes.push({
        id: name.toLowerCase(),
        name,
        x: 0, y: 0,
        layer: l.layer,
        status: Math.random() > 0.2 ? 'online' : Math.random() > 0.5 ? 'degraded' : 'offline',
        radius: 3,
        color: LAYER_COLORS[l.layer] || '#5EC9CC',
      })
    })
  })
  return nodes
})()

// ============================================================================
// MINIMAP CANVAS RENDERER
// ============================================================================

function useMinimapCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  nodes: MinimapNode[],
  connections: MinimapConnection[],
  opacity: number,
) {
  const animFrameRef = useRef<number>()
  const timeRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || nodes.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Layout: arrange nodes in concentric arcs by layer
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const maxRadius = Math.min(canvas.width, canvas.height) * 0.42

    // Group nodes by layer
    const layerGroups = new Map<number, MinimapNode[]>()
    nodes.forEach(n => {
      const arr = layerGroups.get(n.layer) || []
      arr.push(n)
      layerGroups.set(n.layer, arr)
    })

    const sortedLayers = Array.from(layerGroups.keys()).sort((a, b) => a - b)
    const layerCount = sortedLayers.length

    // Position nodes
    sortedLayers.forEach((layer, layerIdx) => {
      const ring = ((layerIdx + 1) / (layerCount + 1)) * maxRadius
      const group = layerGroups.get(layer)!
      group.forEach((node, nodeIdx) => {
        const angle = (nodeIdx / group.length) * Math.PI * 2 - Math.PI / 2
        node.x = centerX + Math.cos(angle) * ring
        node.y = centerY + Math.sin(angle) * ring
        node.radius = Math.max(2, 4 - layerIdx * 0.15)
      })
    })

    // Build connections (some dependency links)
    const conns: MinimapConnection[] = []
    const allNodes = Array.from(layerGroups.values()).flat()
    for (let i = 0; i < allNodes.length; i++) {
      // Connect to 1-2 nodes in adjacent layers
      const node = allNodes[i]
      const nextLayer = sortedLayers[sortedLayers.indexOf(node.layer) + 1]
      if (nextLayer !== undefined) {
        const nextGroup = layerGroups.get(nextLayer)
        if (nextGroup && nextGroup.length > 0) {
          const target = nextGroup[i % nextGroup.length]
          conns.push({ from: node, to: target, active: node.status === 'online' && target.status === 'online' })
        }
      }
    }

    // Animation loop
    const draw = () => {
      timeRef.current += 0.008
      const t = timeRef.current

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.globalAlpha = opacity

      // Draw connections
      conns.forEach(conn => {
        ctx.beginPath()
        ctx.moveTo(conn.from.x, conn.from.y)

        // Curved connection
        const midX = (conn.from.x + conn.to.x) / 2 + Math.sin(t + conn.from.x * 0.01) * 8
        const midY = (conn.from.y + conn.to.y) / 2 + Math.cos(t + conn.from.y * 0.01) * 8
        ctx.quadraticCurveTo(midX, midY, conn.to.x, conn.to.y)

        ctx.strokeStyle = conn.active
          ? `rgba(94,201,204, ${0.08 + Math.sin(t * 2 + conn.from.x * 0.1) * 0.04})`
          : 'rgba(100, 100, 100, 0.03)'
        ctx.lineWidth = conn.active ? 0.8 : 0.3
        ctx.stroke()

        // Animated pulse dot along active connections
        if (conn.active) {
          const progress = (Math.sin(t * 1.5 + conn.from.x * 0.05) + 1) / 2
          const px = conn.from.x + (conn.to.x - conn.from.x) * progress
          const py = conn.from.y + (conn.to.y - conn.from.y) * progress
          ctx.beginPath()
          ctx.arc(px, py, 1.2, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(94,201,204, ${0.3 + Math.sin(t * 3) * 0.15})`
          ctx.fill()
        }
      })

      // Draw nodes
      allNodes.forEach(node => {
        const pulse = Math.sin(t * 2 + node.x * 0.03 + node.y * 0.02)

        // Outer glow
        const gradient = ctx.createRadialGradient(
          node.x, node.y, 0,
          node.x, node.y, node.radius * 4,
        )
        const baseColor = node.color
        gradient.addColorStop(0, `${baseColor}${node.status === 'online' ? '40' : '15'}`)
        gradient.addColorStop(1, `${baseColor}00`)
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.radius * 4, 0, Math.PI * 2)
        ctx.fillStyle = gradient
        ctx.fill()

        // Core dot
        ctx.beginPath()
        const r = node.radius + (node.status === 'online' ? pulse * 0.5 : 0)
        ctx.arc(node.x, node.y, Math.max(1, r), 0, Math.PI * 2)
        ctx.fillStyle = node.status === 'online'
          ? baseColor
          : node.status === 'degraded'
            ? '#f59e0b'
            : 'rgba(100, 100, 100, 0.4)'
        ctx.globalAlpha = opacity * (node.status === 'online' ? 0.8 : 0.4)
        ctx.fill()
        ctx.globalAlpha = opacity
      })

      // Central glow (brain)
      const centralGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 30)
      centralGradient.addColorStop(0, `rgba(94,201,204, ${0.06 + Math.sin(t) * 0.03})`)
      centralGradient.addColorStop(1, 'rgba(94,201,204, 0)')
      ctx.beginPath()
      ctx.arc(centerX, centerY, 30, 0, Math.PI * 2)
      ctx.fillStyle = centralGradient
      ctx.fill()

      animFrameRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [canvasRef, nodes, connections, opacity])
}

// ============================================================================
// EXPANDED NEURAL FIELD OVERLAY
// ============================================================================

function ExpandedOverlay({ onClose }: { onClose: () => void }) {
  const NeuralField = useMemo(() => {
    return React.lazy(() =>
      import('@/components/dashboard/infrastructure/neural-field').then(m => ({
        default: m.NeuralField,
      }))
    )
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <React.Suspense
        fallback={
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#5EC9CC] mr-3" />
            <span className="text-zinc-500">Loading Neural Field...</span>
          </div>
        }
      >
        <NeuralField
          isOpen={true}
          onClose={onClose}
          showControls={true}
          autoRefresh={true}
        />
      </React.Suspense>
    </motion.div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface NeuralMinimapProps {
  className?: string
}

export function NeuralMinimap({ className }: NeuralMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [nodes, setNodes] = useState<MinimapNode[]>(DEMO_SERVICES)
  const [connections] = useState<MinimapConnection[]>([])
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [isHovered, setIsHovered] = useState(false)

  // Resize observer
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setDimensions({ width: Math.floor(width), height: Math.floor(height) })
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Update canvas size
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = dimensions.width
    canvas.height = dimensions.height
  }, [dimensions])

  // Fetch real service data when available
  useEffect(() => {
    if (isDemoMode()) return

    const fetchServices = async () => {
      try {
        const res = await fetch('/api/services/health')
        if (!res.ok) return

        const data = await res.json()
        if (data.services && Array.isArray(data.services)) {
          const mapped: MinimapNode[] = data.services.map((svc: any) => {
            const layer = GROUP_TO_LAYER[svc.group?.toLowerCase()] ?? GROUP_TO_LAYER.default
            return {
              id: svc.name?.toLowerCase() || svc.id,
              name: svc.displayName || svc.name || svc.id,
              x: 0,
              y: 0,
              layer,
              status: svc.status || 'unknown',
              radius: 3,
              color: LAYER_COLORS[layer] || '#5EC9CC',
            }
          })
          if (mapped.length > 0) setNodes(mapped)
        }
      } catch (_e) {
        // Keep demo nodes
      }
    }

    fetchServices()
    const interval = setInterval(fetchServices, 30000)
    return () => clearInterval(interval)
  }, [])

  // Render minimap
  useMinimapCanvas(canvasRef, nodes, connections, 0.2)

  return (
    <>
      {/* Minimap background layer — pointer-events-none so desktop icons/clicks work normally */}
      <div
        ref={containerRef}
        className={`absolute inset-0 pointer-events-none ${className || ''}`}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ imageRendering: 'auto' }}
        />
      </div>

      {/* Small expand button in bottom-right corner (above taskbar) */}
      <motion.button
        onClick={() => setIsExpanded(true)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="absolute bottom-4 right-4 z-[10] flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
          bg-black/40 hover:bg-black/60 backdrop-blur-md border border-white/10 hover:border-[#5EC9CC]/30
          text-white/40 hover:text-white/80 transition-all duration-200 cursor-pointer group"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="Expand Neural Field"
      >
        <Activity className="w-3 h-3 text-[#5EC9CC]/60 group-hover:text-[#5EC9CC]" />
        <span className="text-[10px] font-medium">Neural Field</span>
        <Maximize2 className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </motion.button>

      {/* Expanded overlay */}
      <AnimatePresence>
        {isExpanded && (
          <ExpandedOverlay onClose={() => setIsExpanded(false)} />
        )}
      </AnimatePresence>
    </>
  )
}
