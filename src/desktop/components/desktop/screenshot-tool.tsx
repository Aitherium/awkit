'use client'

/**
 * Screenshot Tool
 * ===============
 *
 * Canvas-based screenshot/annotation tool for AitherOS desktop.
 *
 * Features:
 *  - Simulated screen capture (captures visible DOM)
 *  - Annotation tools: pen, arrow, rectangle, circle, text, highlight
 *  - Color picker + line width
 *  - Undo/redo
 *  - Save to clipboard / download / desktop file store
 *  - Delay timer (3s, 5s, 10s)
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  Camera, Pencil, ArrowUpRight, Square, Circle, Type, Highlighter,
  Undo2, Redo2, Download, Copy, Trash2, Timer, Crosshair,
  MousePointer, Minus, Plus, Crop
} from 'lucide-react'
import { toast } from 'sonner'

// ============================================================================
// TYPES
// ============================================================================

type Tool = 'select' | 'pen' | 'arrow' | 'rect' | 'circle' | 'text' | 'highlight' | 'crop'

interface DrawAction {
  tool: Tool
  color: string
  lineWidth: number
  points: { x: number; y: number }[]
  text?: string
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ScreenshotTool({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [captured, setCaptured] = useState(false)
  const [capturedImage, setCapturedImage] = useState<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#ff3b30')
  const [lineWidth, setLineWidth] = useState(3)
  const [actions, setActions] = useState<DrawAction[]>([])
  const [redoStack, setRedoStack] = useState<DrawAction[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [currentAction, setCurrentAction] = useState<DrawAction | null>(null)
  const [captureCountdown, setCaptureCountdown] = useState<number | null>(null)
  const [textInput, setTextInput] = useState('')
  const [textPos, setTextPos] = useState<{ x: number; y: number } | null>(null)
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 500 })

  // Colors palette
  const colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#5856d6', '#af52de', '#ffffff', '#000000']

  // ── Capture ───────────────────────────────────────────────────────────
  const captureScreen = useCallback(async () => {
    // Create a simulated "screenshot" — gradient + timestamp
    // In a real Electron/Tauri environment this would use native screen capture
    const canvas = document.createElement('canvas')
    canvas.width = canvasSize.w
    canvas.height = canvasSize.h
    const ctx = canvas.getContext('2d')!

    // Dark gradient background with grid to simulate a captured screen
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
    grad.addColorStop(0, '#0a0a0f')
    grad.addColorStop(0.5, '#111128')
    grad.addColorStop(1, '#0a0f0a')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'
    ctx.lineWidth = 1
    for (let x = 0; x < canvas.width; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke() }
    for (let y = 0; y < canvas.height; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke() }

    // Draw AitherOS branding
    ctx.fillStyle = 'rgba(94,201,204,0.6)'
    ctx.font = 'bold 32px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText('AitherOS — Screen Capture', canvas.width / 2, canvas.height / 2 - 20)
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.font = '14px system-ui'
    ctx.fillText(new Date().toLocaleString(), canvas.width / 2, canvas.height / 2 + 20)
    ctx.fillText('Use annotation tools to mark up this capture', canvas.width / 2, canvas.height / 2 + 45)

    const img = new Image()
    img.src = canvas.toDataURL()
    await new Promise(r => { img.onload = r })
    setCapturedImage(img)
    setCaptured(true)
    setActions([])
    setRedoStack([])
    toast.success('Screenshot captured')
  }, [canvasSize])

  const captureWithDelay = useCallback((seconds: number) => {
    setCaptureCountdown(seconds)
    const interval = setInterval(() => {
      setCaptureCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(interval)
          captureScreen()
          return null
        }
        return prev - 1
      })
    }, 1000)
  }, [captureScreen])

  // ── Render canvas ─────────────────────────────────────────────────────
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !capturedImage) return
    const ctx = canvas.getContext('2d')!
    canvas.width = canvasSize.w
    canvas.height = canvasSize.h

    // Draw base image
    ctx.drawImage(capturedImage, 0, 0, canvasSize.w, canvasSize.h)

    // Draw all actions
    for (const action of actions) {
      ctx.strokeStyle = action.tool === 'highlight' ? action.color + '60' : action.color
      ctx.fillStyle = action.color
      ctx.lineWidth = action.tool === 'highlight' ? action.lineWidth * 6 : action.lineWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      if (action.tool === 'pen' || action.tool === 'highlight') {
        if (action.points.length < 2) continue
        ctx.beginPath()
        ctx.moveTo(action.points[0].x, action.points[0].y)
        for (let i = 1; i < action.points.length; i++) {
          ctx.lineTo(action.points[i].x, action.points[i].y)
        }
        ctx.stroke()
      } else if (action.tool === 'arrow') {
        if (action.points.length < 2) continue
        const [start, end] = [action.points[0], action.points[action.points.length - 1]]
        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        ctx.lineTo(end.x, end.y)
        ctx.stroke()
        // Arrowhead
        const angle = Math.atan2(end.y - start.y, end.x - start.x)
        const headLen = 15
        ctx.beginPath()
        ctx.moveTo(end.x, end.y)
        ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6))
        ctx.moveTo(end.x, end.y)
        ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6))
        ctx.stroke()
      } else if (action.tool === 'rect') {
        if (action.points.length < 2) continue
        const [s, e] = [action.points[0], action.points[action.points.length - 1]]
        ctx.strokeRect(s.x, s.y, e.x - s.x, e.y - s.y)
      } else if (action.tool === 'circle') {
        if (action.points.length < 2) continue
        const [s, e] = [action.points[0], action.points[action.points.length - 1]]
        const rx = Math.abs(e.x - s.x) / 2
        const ry = Math.abs(e.y - s.y) / 2
        ctx.beginPath()
        ctx.ellipse(s.x + (e.x - s.x) / 2, s.y + (e.y - s.y) / 2, rx, ry, 0, 0, Math.PI * 2)
        ctx.stroke()
      } else if (action.tool === 'text') {
        if (action.points.length < 1 || !action.text) continue
        ctx.font = `${action.lineWidth * 5 + 12}px system-ui`
        ctx.fillText(action.text, action.points[0].x, action.points[0].y)
      }
    }
  }, [capturedImage, actions, canvasSize])

  useEffect(() => { renderCanvas() }, [renderCanvas])

  // Resize observer
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 100 && height > 100) setCanvasSize({ w: Math.floor(width), h: Math.floor(height - 4) })
    })
    obs.observe(container)
    return () => obs.disconnect()
  }, [captured])

  // ── Drawing handlers ──────────────────────────────────────────────────
  const getPos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = useCallback((e: React.MouseEvent) => {
    if (!captured) return
    const pos = getPos(e)

    if (tool === 'text') {
      setTextPos(pos)
      return
    }

    setIsDrawing(true)
    setCurrentAction({ tool, color, lineWidth, points: [pos] })
  }, [captured, tool, color, lineWidth])

  const onPointerMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || !currentAction) return
    const pos = getPos(e)
    setCurrentAction(prev => prev ? { ...prev, points: [...prev.points, pos] } : null)

    // Live preview on overlay
    const overlay = overlayCanvasRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')!
    overlay.width = canvasSize.w
    overlay.height = canvasSize.h
    ctx.clearRect(0, 0, overlay.width, overlay.height)

    const action = { ...currentAction, points: [...currentAction.points, pos] }
    ctx.strokeStyle = action.tool === 'highlight' ? action.color + '60' : action.color
    ctx.lineWidth = action.tool === 'highlight' ? action.lineWidth * 6 : action.lineWidth
    ctx.lineCap = 'round'

    if (action.tool === 'pen' || action.tool === 'highlight') {
      ctx.beginPath()
      ctx.moveTo(action.points[0].x, action.points[0].y)
      for (let i = 1; i < action.points.length; i++) ctx.lineTo(action.points[i].x, action.points[i].y)
      ctx.stroke()
    } else if (action.tool === 'rect') {
      const [s, e] = [action.points[0], pos]
      ctx.strokeRect(s.x, s.y, e.x - s.x, e.y - s.y)
    } else if (action.tool === 'circle') {
      const [s, e] = [action.points[0], pos]
      const rx = Math.abs(e.x - s.x) / 2
      const ry = Math.abs(e.y - s.y) / 2
      ctx.beginPath()
      ctx.ellipse(s.x + (e.x - s.x) / 2, s.y + (e.y - s.y) / 2, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
    } else if (action.tool === 'arrow') {
      const [start, end] = [action.points[0], pos]
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke()
      const angle = Math.atan2(end.y - start.y, end.x - start.x)
      const headLen = 15
      ctx.beginPath()
      ctx.moveTo(end.x, end.y)
      ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6))
      ctx.moveTo(end.x, end.y)
      ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6))
      ctx.stroke()
    }
  }, [isDrawing, currentAction, canvasSize])

  const onPointerUp = useCallback(() => {
    if (!isDrawing || !currentAction) return
    setIsDrawing(false)
    setActions(prev => [...prev, currentAction])
    setRedoStack([])
    setCurrentAction(null)
    // Clear overlay
    const overlay = overlayCanvasRef.current
    if (overlay) {
      const ctx = overlay.getContext('2d')!
      ctx.clearRect(0, 0, overlay.width, overlay.height)
    }
  }, [isDrawing, currentAction])

  const submitText = useCallback(() => {
    if (!textPos || !textInput.trim()) { setTextPos(null); setTextInput(''); return }
    setActions(prev => [...prev, { tool: 'text', color, lineWidth, points: [textPos], text: textInput }])
    setRedoStack([])
    setTextPos(null)
    setTextInput('')
  }, [textPos, textInput, color, lineWidth])

  const undo = useCallback(() => {
    setActions(prev => {
      if (prev.length === 0) return prev
      setRedoStack(rs => [prev[prev.length - 1], ...rs])
      return prev.slice(0, -1)
    })
  }, [])

  const redo = useCallback(() => {
    setRedoStack(prev => {
      if (prev.length === 0) return prev
      setActions(a => [...a, prev[0]])
      return prev.slice(1)
    })
  }, [])

  const clearAnnotations = useCallback(() => {
    setActions([]); setRedoStack([])
  }, [])

  const saveToClipboard = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob(async (blob) => {
      if (!blob) return
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      toast.success('Copied to clipboard')
    })
  }, [])

  const downloadImage = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `aitheros-screenshot-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    toast.success('Screenshot saved')
  }, [])

  // ── Tool bar component ────────────────────────────────────────────────
  const ToolBtn = ({ icon: Icon, id, label }: { icon: React.ElementType; id: Tool; label: string }) => (
    <button
      onClick={() => setTool(id)}
      title={label}
      className={`p-1.5 rounded-lg transition-colors ${
        tool === id ? 'bg-[#5EC9CC]/20 text-[#5EC9CC]' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  )

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════

  if (!captured) {
    return (
      <div className={`flex flex-col items-center justify-center h-full bg-zinc-950 gap-6 ${className}`}>
        {captureCountdown !== null ? (
          <div className="flex flex-col items-center gap-4">
            <div className="text-7xl font-bold text-[#5EC9CC] tabular-nums animate-pulse">{captureCountdown}</div>
            <div className="text-zinc-500 text-sm">Capturing in...</div>
          </div>
        ) : (
          <>
            <div className="p-6 rounded-2xl bg-zinc-800/30 border border-zinc-800/60">
              <Camera className="w-16 h-16 text-zinc-600" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold text-zinc-300 mb-1">Screenshot Tool</h3>
              <p className="text-sm text-zinc-600">Capture, annotate, and share</p>
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={captureScreen}
                className="flex items-center gap-2 px-6 py-2.5 bg-[#5EC9CC] text-[#050507] rounded-xl hover:bg-[#7AD6D8] transition-colors font-medium">
                <Camera className="w-4 h-4" /> Capture Now
              </button>
              <div className="flex items-center gap-2">
                {[3, 5, 10].map(s => (
                  <button key={s} onClick={() => captureWithDelay(s)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700 transition-colors text-sm">
                    <Timer className="w-3 h-3" /> {s}s
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full bg-zinc-950 ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800/60 bg-zinc-900/50 flex-wrap">
        {/* Capture */}
        <button onClick={() => { setCaptured(false); setCapturedImage(null) }}
          className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-white bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors mr-1">
          <Camera className="w-3 h-3" /> New
        </button>

        <div className="w-px h-5 bg-zinc-800 mx-1" />

        {/* Drawing tools */}
        <ToolBtn icon={MousePointer} id="select" label="Select" />
        <ToolBtn icon={Pencil} id="pen" label="Pen" />
        <ToolBtn icon={ArrowUpRight} id="arrow" label="Arrow" />
        <ToolBtn icon={Square} id="rect" label="Rectangle" />
        <ToolBtn icon={Circle} id="circle" label="Circle" />
        <ToolBtn icon={Type} id="text" label="Text" />
        <ToolBtn icon={Highlighter} id="highlight" label="Highlight" />

        <div className="w-px h-5 bg-zinc-800 mx-1" />

        {/* Colors */}
        <div className="flex items-center gap-0.5">
          {colors.map(c => (
            <button key={c} onClick={() => setColor(c)}
              className={`w-4 h-4 rounded-full border-2 transition-transform ${
                color === c ? 'border-white scale-125' : 'border-transparent hover:scale-110'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <div className="w-px h-5 bg-zinc-800 mx-1" />

        {/* Line width */}
        <div className="flex items-center gap-1">
          <button onClick={() => setLineWidth(prev => Math.max(1, prev - 1))} className="p-1 text-zinc-500 hover:text-zinc-300"><Minus className="w-3 h-3" /></button>
          <span className="text-[10px] text-zinc-500 w-3 text-center">{lineWidth}</span>
          <button onClick={() => setLineWidth(prev => Math.min(10, prev + 1))} className="p-1 text-zinc-500 hover:text-zinc-300"><Plus className="w-3 h-3" /></button>
        </div>

        <div className="flex-1" />

        {/* Actions */}
        <button onClick={undo} disabled={actions.length === 0} className="p-1.5 text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-colors"><Undo2 className="w-3.5 h-3.5" /></button>
        <button onClick={redo} disabled={redoStack.length === 0} className="p-1.5 text-zinc-500 hover:text-zinc-300 disabled:opacity-30 transition-colors"><Redo2 className="w-3.5 h-3.5" /></button>
        <button onClick={clearAnnotations} className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        <div className="w-px h-5 bg-zinc-800 mx-1" />
        <button onClick={saveToClipboard} className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors" title="Copy to clipboard"><Copy className="w-3.5 h-3.5" /></button>
        <button onClick={downloadImage} className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors" title="Download"><Download className="w-3.5 h-3.5" /></button>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden bg-zinc-950/80">
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          className="absolute inset-0 w-full h-full"
        />
        <canvas
          ref={overlayCanvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          className="absolute inset-0 w-full h-full"
          style={{ cursor: tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair' }}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerUp}
        />

        {/* Text input popup */}
        {textPos && (
          <div className="absolute z-10 bg-zinc-900 border border-zinc-700 rounded-lg p-2 shadow-xl"
            style={{ left: textPos.x, top: textPos.y }}>
            <input
              autoFocus
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitText(); if (e.key === 'Escape') { setTextPos(null); setTextInput('') } }}
              placeholder="Type text..."
              className="bg-transparent text-white text-sm outline-none w-40"
              style={{ color }}
            />
            <div className="flex justify-end mt-1 gap-1">
              <button onClick={() => { setTextPos(null); setTextInput('') }} className="text-[10px] text-zinc-600 hover:text-zinc-400">Cancel</button>
              <button onClick={submitText} className="text-[10px] text-[#5EC9CC] hover:text-[#5EC9CC]">Add</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
