'use client'

/**
 * Image Viewer
 * ============
 *
 * Full-featured image viewer for AitherOS desktop.
 *
 * Features:
 *  - Open images from file store or URL
 *  - Zoom in/out, fit, actual size
 *  - Pan (drag when zoomed)
 *  - Rotate (90° increments)
 *  - Flip horizontal / vertical
 *  - Slideshow mode
 *  - Image metadata display
 *  - Grid gallery of loaded images
 *  - Drag & drop support
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  ZoomIn, ZoomOut, Maximize2, RotateCw, RotateCcw, FlipHorizontal,
  FlipVertical, Play, Pause, ChevronLeft, ChevronRight, Image,
  Grid3X3, Info, Download, Copy, Upload, X, Minimize2
} from 'lucide-react'
import { toast } from 'sonner'

// ============================================================================
// TYPES
// ============================================================================

interface ViewerImage {
  id: string
  name: string
  src: string
  width?: number
  height?: number
  size?: number
  type?: string
}

// ============================================================================
// SAMPLE IMAGES (placeholder gallery)
// ============================================================================

const SAMPLE_IMAGES: ViewerImage[] = [
  { id: '1', name: 'AitherOS Wallpaper', src: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0a0a1a"/><stop offset="50%" stop-color="#1a0a2e"/><stop offset="100%" stop-color="#0a1a0a"/></linearGradient></defs><rect fill="url(#g)" width="800" height="600"/><text x="400" y="300" text-anchor="middle" fill="rgba(94,201,204,0.5)" font-size="48" font-family="system-ui">AitherOS</text></svg>`) },
  { id: '2', name: 'Gradient', src: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff6b6b"/><stop offset="50%" stop-color="#feca57"/><stop offset="100%" stop-color="#48dbfb"/></linearGradient></defs><rect fill="url(#g)" width="800" height="600"/></svg>`) },
  { id: '3', name: 'Mesh Pattern', src: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect fill="#111" width="800" height="600"/><g stroke="rgba(94,201,204,0.15)" stroke-width="1">${Array.from({length:40},(_,i)=>`<line x1="${i*20}" y1="0" x2="${i*20}" y2="600"/>`).join('')}${Array.from({length:30},(_,i)=>`<line x1="0" y1="${i*20}" x2="800" y2="${i*20}"/>`).join('')}</g><circle cx="400" cy="300" r="100" fill="none" stroke="rgba(94,201,204,0.3)" stroke-width="2"/></svg>`) },
]

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ImageViewer({ className = '' }: { className?: string }) {
  const [images, setImages] = useState<ViewerImage[]>(SAMPLE_IMAGES)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [view, setView] = useState<'single' | 'gallery'>('single')
  const [showInfo, setShowInfo] = useState(false)
  const [slideshow, setSlideshow] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const current = images[currentIndex] || null

  // ── Slideshow ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!slideshow) return
    const iv = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % images.length)
      resetTransform()
    }, 3000)
    return () => clearInterval(iv)
  }, [slideshow, images.length])

  // ── Transform controls ────────────────────────────────────────────────
  const resetTransform = useCallback(() => {
    setZoom(1); setRotation(0); setFlipH(false); setFlipV(false); setOffset({ x: 0, y: 0 })
  }, [])

  const zoomIn = useCallback(() => setZoom(z => Math.min(z * 1.25, 10)), [])
  const zoomOut = useCallback(() => setZoom(z => Math.max(z / 1.25, 0.1)), [])
  const fitToView = useCallback(() => { setZoom(1); setOffset({ x: 0, y: 0 }) }, [])
  const rotateCW = useCallback(() => setRotation(r => (r + 90) % 360), [])
  const rotateCCW = useCallback(() => setRotation(r => (r - 90 + 360) % 360), [])

  const prev = useCallback(() => {
    setCurrentIndex(i => (i - 1 + images.length) % images.length)
    resetTransform()
  }, [images.length, resetTransform])

  const next = useCallback(() => {
    setCurrentIndex(i => (i + 1) % images.length)
    resetTransform()
  }, [images.length, resetTransform])

  // ── Pan handling ──────────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return
    setIsPanning(true)
    setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y })
  }, [zoom, offset])

  const onPointerMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return
    setOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
  }, [isPanning, panStart])

  const onPointerUp = useCallback(() => setIsPanning(false), [])

  // ── Wheel zoom ────────────────────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (e.deltaY < 0) zoomIn()
    else zoomOut()
  }, [zoomIn, zoomOut])

  // ── File input ────────────────────────────────────────────────────────
  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = (e) => {
        const img: ViewerImage = {
          id: `img-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          src: e.target?.result as string,
          size: file.size,
          type: file.type,
        }
        setImages(prev => [...prev, img])
        setCurrentIndex(images.length) // navigate to new image
        setView('single')
        toast.success(`Opened ${file.name}`)
      }
      reader.readAsDataURL(file)
    })
  }, [images.length])

  // ── Drop handler ──────────────────────────────────────────────────────
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  // ── Keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
      if (e.key === '+' || e.key === '=') zoomIn()
      if (e.key === '-') zoomOut()
      if (e.key === '0') fitToView()
      if (e.key === 'r') rotateCW()
      if (e.key === ' ') { e.preventDefault(); setSlideshow(s => !s) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [prev, next, zoomIn, zoomOut, fitToView, rotateCW])

  const copyImage = useCallback(async () => {
    if (!current) return
    try {
      const res = await fetch(current.src)
      const blob = await res.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      toast.success('Image copied')
    } catch (_e) {
      toast.error('Could not copy image')
    }
  }, [current])

  // ── Hidden file input ─────────────────────────────────────────────────
  const openFilePicker = () => fileInputRef.current?.click()

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════

  return (
    <div className={`flex flex-col h-full bg-zinc-950 ${className}`}
      onDrop={onDrop} onDragOver={e => e.preventDefault()}>
      <input ref={fileInputRef} type="file" accept="image/*" multiple hidden
        onChange={e => handleFiles(e.target.files)} />

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800/60 bg-zinc-900/50">
        <button onClick={openFilePicker}
          className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-white bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors">
          <Upload className="w-3 h-3" /> Open
        </button>
        <div className="w-px h-5 bg-zinc-800 mx-1" />

        <button onClick={zoomOut} className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"><ZoomOut className="w-4 h-4" /></button>
        <span className="text-[10px] text-zinc-500 w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button onClick={zoomIn} className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"><ZoomIn className="w-4 h-4" /></button>
        <button onClick={fitToView} className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors" title="Fit"><Minimize2 className="w-4 h-4" /></button>

        <div className="w-px h-5 bg-zinc-800 mx-1" />

        <button onClick={rotateCCW} className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"><RotateCcw className="w-4 h-4" /></button>
        <button onClick={rotateCW} className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"><RotateCw className="w-4 h-4" /></button>
        <button onClick={() => setFlipH(!flipH)} className={`p-1 transition-colors ${flipH ? 'text-[#5EC9CC]' : 'text-zinc-500 hover:text-zinc-300'}`}><FlipHorizontal className="w-4 h-4" /></button>
        <button onClick={() => setFlipV(!flipV)} className={`p-1 transition-colors ${flipV ? 'text-[#5EC9CC]' : 'text-zinc-500 hover:text-zinc-300'}`}><FlipVertical className="w-4 h-4" /></button>

        <div className="w-px h-5 bg-zinc-800 mx-1" />

        <button onClick={() => setSlideshow(!slideshow)}
          className={`p-1 transition-colors ${slideshow ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
          {slideshow ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>

        <div className="flex-1" />

        <button onClick={() => setView(view === 'single' ? 'gallery' : 'single')}
          className={`p-1 transition-colors ${view === 'gallery' ? 'text-[#5EC9CC]' : 'text-zinc-500 hover:text-zinc-300'}`}>
          <Grid3X3 className="w-4 h-4" />
        </button>
        <button onClick={() => setShowInfo(!showInfo)}
          className={`p-1 transition-colors ${showInfo ? 'text-[#5EC9CC]' : 'text-zinc-500 hover:text-zinc-300'}`}>
          <Info className="w-4 h-4" />
        </button>
        <button onClick={copyImage} className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"><Copy className="w-4 h-4" /></button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {view === 'gallery' ? (
          <div className="flex-1 p-3 overflow-y-auto scrollbar-none">
            <div className="grid grid-cols-3 gap-2">
              {images.map((img, i) => (
                <button key={img.id} onClick={() => { setCurrentIndex(i); setView('single'); resetTransform() }}
                  className={`aspect-video rounded-lg overflow-hidden border-2 transition-colors ${
                    i === currentIndex ? 'border-[#5EC9CC]' : 'border-zinc-800/40 hover:border-zinc-700'
                  }`}>
                  <img src={img.src} alt={img.name} className="w-full h-full object-cover" />
                </button>
              ))}
              {/* Add placeholder */}
              <button onClick={openFilePicker}
                className="aspect-video rounded-lg border-2 border-dashed border-zinc-800 hover:border-zinc-600 flex items-center justify-center transition-colors">
                <Upload className="w-6 h-6 text-zinc-700" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex relative">
            {/* Image container */}
            <div ref={containerRef}
              className="flex-1 overflow-hidden flex items-center justify-center relative"
              onMouseDown={onPointerDown}
              onMouseMove={onPointerMove}
              onMouseUp={onPointerUp}
              onMouseLeave={onPointerUp}
              onWheel={onWheel}
              style={{ cursor: zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default' }}>
              {current ? (
                <img
                  src={current.src}
                  alt={current.name}
                  draggable={false}
                  className="max-w-none select-none transition-transform duration-100"
                  style={{
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
                  }}
                />
              ) : (
                <div className="text-center">
                  <Image className="w-16 h-16 text-zinc-800 mx-auto mb-3" />
                  <p className="text-zinc-600 text-sm">No image selected</p>
                  <button onClick={openFilePicker} className="mt-2 px-4 py-1.5 bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700 text-sm transition-colors">
                    Open Image
                  </button>
                </div>
              )}

              {/* Nav arrows */}
              {images.length > 1 && (
                <>
                  <button onClick={prev}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors backdrop-blur-sm">
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button onClick={next}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors backdrop-blur-sm">
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

            {/* Info sidebar */}
            {showInfo && current && (
              <div className="w-48 border-l border-zinc-800/40 bg-zinc-900/40 p-3 overflow-y-auto scrollbar-none">
                <h4 className="text-xs font-medium text-zinc-300 mb-2 truncate">{current.name}</h4>
                <div className="space-y-2 text-[11px]">
                  <div><span className="text-zinc-600">Type:</span> <span className="text-zinc-400">{current.type || 'image'}</span></div>
                  {current.size && (
                    <div><span className="text-zinc-600">Size:</span> <span className="text-zinc-400">{(current.size / 1024).toFixed(1)} KB</span></div>
                  )}
                  {current.width && current.height && (
                    <div><span className="text-zinc-600">Dimensions:</span> <span className="text-zinc-400">{current.width}×{current.height}</span></div>
                  )}
                  <div><span className="text-zinc-600">Zoom:</span> <span className="text-zinc-400">{Math.round(zoom * 100)}%</span></div>
                  <div><span className="text-zinc-600">Rotation:</span> <span className="text-zinc-400">{rotation}°</span></div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1 border-t border-zinc-800/40 bg-zinc-900/30 text-[10px] text-zinc-600">
        <span>{currentIndex + 1} / {images.length}</span>
        <div className="flex-1" />
        {current && <span className="truncate">{current.name}</span>}
        {slideshow && <span className="text-green-400">▶ Slideshow</span>}
      </div>
    </div>
  )
}
