'use client'

/**
 * Desktop File Editor
 * ===================
 *
 * A lightweight text editor that opens inside a desktop window.
 * Files are backed by localStorage (desktop-file-store) and
 * optionally synced to AitherStrata when available.
 *
 * Features:
 *  - Auto-save on blur / Ctrl+S
 *  - Syntax-aware monospace editing
 *  - Strata sync status indicator
 *  - File info bar (size, mime, timestamps)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  Save, Cloud, CloudOff, FileText, Clock, Hash,
  CheckCircle2, AlertCircle, Loader2, Download, Upload,
  Type, Code2, Trash2
} from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { toast } from 'sonner'
import {
  getFile,
  updateFileContent,
  syncFileToStrata,
  isStrataOnline,
  type DesktopFile,
} from '../../lib/desktop-file-store'

// ============================================================================
// TYPES
// ============================================================================

interface FileEditorProps {
  fileId: string
  className?: string
}

// ============================================================================
// FILE EDITOR COMPONENT
// ============================================================================

export function FileEditor({ fileId, className = '' }: FileEditorProps) {
  const [file, setFile] = useState<DesktopFile | null>(null)
  const [content, setContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [strataOnline, setStrataOnline] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [wordWrap, setWordWrap] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

  // Load file on mount
  useEffect(() => {
    const f = getFile(fileId)
    if (f) {
      setFile(f)
      setContent(f.content)
    }
  }, [fileId])

  // Check Strata availability
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const online = await isStrataOnline()
      if (!cancelled) setStrataOnline(online)
    }
    check()
    const interval = setInterval(check, 30_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Save to localStorage
  const handleSave = useCallback(() => {
    if (!file) return
    setIsSaving(true)
    const updated = updateFileContent(file.id, content)
    if (updated) {
      setFile(updated)
      setIsDirty(false)
    }
    setIsSaving(false)
    toast.success('Saved locally', { duration: 1500 })
  }, [file, content])

  // Auto-save debounce (2s after last keystroke)
  useEffect(() => {
    if (!isDirty) return
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      if (isDirty && file) {
        updateFileContent(file.id, content)
        setIsDirty(false)
        setFile(getFile(file.id) || file)
      }
    }, 2000)
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [content, isDirty, file])

  // Ctrl+S handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  // Sync to Strata
  const handleSync = useCallback(async () => {
    if (!file) return
    // Save first
    updateFileContent(file.id, content)
    setIsSyncing(true)
    const ok = await syncFileToStrata(file.id)
    setIsSyncing(false)
    if (ok) {
      setFile(getFile(file.id) || file)
      toast.success('Synced to Strata')
    } else {
      toast.error('Sync failed — Strata may be offline')
    }
  }, [file, content])

  // Content change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value)
    setIsDirty(true)
  }, [])

  // Tab key support
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const val = ta.value
      const newVal = val.substring(0, start) + '  ' + val.substring(end)
      setContent(newVal)
      setIsDirty(true)
      // Restore cursor
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }, [])

  // ── Not found ─────────────────────────────────────────────────────────
  if (!file) {
    return (
      <div className={`flex items-center justify-center h-full text-zinc-500 ${className}`}>
        <div className="text-center space-y-2">
          <AlertCircle className="w-8 h-8 mx-auto text-zinc-600" />
          <p className="text-sm">File not found</p>
          <p className="text-xs text-zinc-600">ID: {fileId}</p>
        </div>
      </div>
    )
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  const lineCount = content.split('\n').length
  const isCode = ['text/typescript', 'text/javascript', 'text/x-python', 'text/x-powershell', 'text/x-shellscript', 'application/json', 'text/yaml', 'text/css', 'text/html'].includes(file.mimeType)
  const sizeLabel = file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`

  return (
    <div className={`flex flex-col h-full bg-zinc-950 ${className}`}>
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60 bg-zinc-900/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <span className="text-sm font-medium text-zinc-200 truncate">{file.name}</span>
          {isDirty && (
            <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" title="Unsaved changes" />
          )}
          <Badge variant="outline" className="text-[9px] border-zinc-700 text-zinc-500 px-1.5 py-0 flex-shrink-0">
            {file.mimeType.split('/').pop()}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Word wrap toggle */}
          <Button
            variant="ghost"
            size="icon"
            className={`w-7 h-7 ${wordWrap ? 'text-blue-400' : 'text-zinc-500'}`}
            onClick={() => setWordWrap(!wordWrap)}
            title={wordWrap ? 'Word wrap: on' : 'Word wrap: off'}
          >
            <Type className="w-3.5 h-3.5" />
          </Button>

          {/* Save */}
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-zinc-400 hover:text-white"
            onClick={handleSave}
            disabled={!isDirty && !isSaving}
            title="Save (Ctrl+S)"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          </Button>

          {/* Sync to Strata */}
          <Button
            variant="ghost"
            size="icon"
            className={`w-7 h-7 ${strataOnline ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-600'}`}
            onClick={handleSync}
            disabled={!strataOnline || isSyncing}
            title={strataOnline ? (file.synced ? 'Synced to Strata' : 'Sync to Strata') : 'Strata offline'}
          >
            {isSyncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : strataOnline ? (
              <Cloud className="w-3.5 h-3.5" />
            ) : (
              <CloudOff className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* ── Editor area ────────────────────────────────────────────────── */}
      <div className="flex-1 relative min-h-0">
        {/* Line numbers gutter */}
        <div className="absolute left-0 top-0 bottom-0 w-10 bg-zinc-900/30 border-r border-zinc-800/30 overflow-hidden pointer-events-none">
          <div className="pt-3 px-1 text-right">
            {Array.from({ length: Math.max(lineCount, 20) }, (_, i) => (
              <div key={i} className="text-[10px] leading-[1.65rem] text-zinc-700 font-mono">
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={`
            w-full h-full resize-none bg-transparent text-zinc-200 
            ${isCode ? 'font-mono text-[13px]' : 'font-sans text-sm'}
            leading-[1.65rem] pl-12 pr-4 pt-3 pb-16
            focus:outline-none placeholder:text-zinc-700
            ${wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto'}
          `}
          placeholder="Start typing..."
          spellCheck={!isCode}
          autoCapitalize={isCode ? 'off' : 'on'}
          autoComplete="off"
          autoCorrect={isCode ? 'off' : 'on'}
        />
      </div>

      {/* ── Status bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-zinc-800/40 bg-zinc-900/30 text-[10px] text-zinc-600">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Hash className="w-3 h-3" />
            {lineCount} lines
          </span>
          <span>{sizeLabel}</span>
          <span className="flex items-center gap-1">
            {file.synced ? (
              <><CheckCircle2 className="w-3 h-3 text-emerald-600" /> Synced</>
            ) : (
              <><CloudOff className="w-3 h-3" /> Local only</>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date(file.updatedAt).toLocaleTimeString()}
          </span>
        </div>
      </div>
    </div>
  )
}
