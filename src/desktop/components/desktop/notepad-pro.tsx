'use client'

/**
 * Notepad Pro
 * ===========
 *
 * A full-featured notepad that doesn't suck.
 *
 * Features:
 *  - Tabbed multi-document editing
 *  - Markdown preview (live toggle)
 *  - Find & Replace (Ctrl+H)
 *  - Word count, character count, reading time
 *  - Agent integration — Ask AI to summarize, rewrite, expand, format
 *  - Auto-save to desktop-file-store
 *  - Strata sync indicator
 *  - Code mode with syntax-aware indentation
 *  - Undo/Redo stack
 *  - Export as .md / .txt
 *  - Pin notes, star favourites
 *  - Dark/light per-note theming
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import DOMPurify from 'dompurify'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, Plus, X, Save, Search, Replace, Eye, EyeOff,
  Bold, Italic, List, ListOrdered, Code2, Quote, Link2,
  Hash, Type, Wand2, Sparkles, Bot, Cloud, CloudOff,
  Loader2, Pin, PinOff, Star, StarOff, Download, Upload,
  Trash2, Copy, ClipboardPaste, Undo2, Redo2, Settings,
  ChevronDown, FileCode, FilePlus, Maximize2, Minimize2,
  AlignLeft, AlignCenter, AlignRight, CheckSquare, Clock,
  BookOpen, Palette,
} from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { toast } from 'sonner'
import {
  listFiles, getFile, createFile, updateFileContent,
  renameFile, deleteFile, syncFileToStrata, isStrataOnline,
  type DesktopFile,
} from '../../lib/desktop-file-store'

// ============================================================================
// TYPES
// ============================================================================

interface NoteTab {
  fileId: string
  name: string
  content: string
  isDirty: boolean
  isPinned: boolean
  isStarred: boolean
  cursorPos: number
  scrollPos: number
  mode: 'edit' | 'preview' | 'split'
}

interface UndoEntry {
  content: string
  cursorPos: number
  timestamp: number
}

interface FindState {
  isOpen: boolean
  query: string
  replacement: string
  matchCount: number
  currentMatch: number
  caseSensitive: boolean
  useRegex: boolean
}

// ============================================================================
// MARKDOWN RENDERER (lightweight inline)
// ============================================================================

function renderMarkdown(md: string): string {
  const html = md
    // Code blocks (triple backtick)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-zinc-800/60 rounded-lg p-3 my-2 overflow-x-auto text-sm font-mono text-emerald-300 border border-zinc-700/50"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-zinc-800/60 px-1.5 py-0.5 rounded text-sm font-mono text-amber-300">$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-zinc-200 mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-zinc-100 mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-white mt-6 mb-2">$1</h1>')
    // Bold/Italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em class="text-zinc-100">$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-zinc-100 font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="text-zinc-300 italic">$1</em>')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '<del class="text-zinc-500">$1</del>')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-2 border-[#5EC9CC]/50 pl-3 py-0.5 my-2 text-zinc-400 italic">$1</blockquote>')
    // Checkboxes
    .replace(/^- \[x\] (.+)$/gm, '<div class="flex items-center gap-2 my-0.5"><div class="w-4 h-4 rounded bg-[#5EC9CC]/30 border border-[#5EC9CC] flex items-center justify-center text-[10px] text-white">✓</div><span class="text-zinc-400 line-through">$1</span></div>')
    .replace(/^- \[ \] (.+)$/gm, '<div class="flex items-center gap-2 my-0.5"><div class="w-4 h-4 rounded bg-zinc-800 border border-zinc-600"></div><span class="text-zinc-300">$1</span></div>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-zinc-300 list-disc">$1</li>')
    .replace(/^\* (.+)$/gm, '<li class="ml-4 text-zinc-300 list-disc">$1</li>')
    // Ordered lists
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 text-zinc-300 list-decimal" value="$1">$2</li>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr class="border-zinc-700 my-4" />')
    // Links
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-blue-400 underline hover:text-blue-300" target="_blank" rel="noopener">$1</a>')
    // Images
    .replace(/!\[(.+?)\]\((.+?)\)/g, '<img src="$2" alt="$1" class="max-w-full rounded-lg my-2" />')
    // Line breaks
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>')
  return html
}

// ============================================================================
// AI ACTIONS
// ============================================================================

const AI_ACTIONS = [
  { id: 'summarize', label: 'Summarize', icon: BookOpen, prompt: 'Summarize this text concisely:' },
  { id: 'rewrite', label: 'Rewrite', icon: Wand2, prompt: 'Rewrite this text to be clearer and more polished:' },
  { id: 'expand', label: 'Expand', icon: Maximize2, prompt: 'Expand this text with more detail and examples:' },
  { id: 'fix-grammar', label: 'Fix Grammar', icon: CheckSquare, prompt: 'Fix all grammar and spelling errors in this text:' },
  { id: 'bullet-points', label: 'To Bullets', icon: List, prompt: 'Convert this text into clear bullet points:' },
  { id: 'make-formal', label: 'Make Formal', icon: Type, prompt: 'Rewrite this text in a formal professional tone:' },
  { id: 'make-casual', label: 'Make Casual', icon: Sparkles, prompt: 'Rewrite this text in a casual friendly tone:' },
  { id: 'explain', label: 'ELI5', icon: Bot, prompt: 'Explain this text as if to a 5-year-old:' },
]

// ============================================================================
// NOTEPAD PRO COMPONENT
// ============================================================================

export function NotepadPro({ className = '' }: { className?: string }) {
  // ── State ──────────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState<NoteTab[]>([])
  const [activeTabIdx, setActiveTabIdx] = useState(0)
  const [strataOnline, setStrataOnline] = useState(false)
  const [find, setFind] = useState<FindState>({
    isOpen: false, query: '', replacement: '', matchCount: 0,
    currentMatch: 0, caseSensitive: false, useRegex: false,
  })
  const [isAIMenuOpen, setIsAIMenuOpen] = useState(false)
  const [isAIProcessing, setIsAIProcessing] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const [undoStack, setUndoStack] = useState<Record<string, UndoEntry[]>>({})
  const [redoStack, setRedoStack] = useState<Record<string, UndoEntry[]>>({})
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const activeTab = tabs[activeTabIdx] || null

  // ── Init: Load existing files or create welcome note ───────────────────
  useEffect(() => {
    const files = listFiles()
    if (files.length > 0) {
      const initialTabs: NoteTab[] = files.slice(0, 5).map(f => ({
        fileId: f.id,
        name: f.name,
        content: f.content,
        isDirty: false,
        isPinned: false,
        isStarred: false,
        cursorPos: 0,
        scrollPos: 0,
        mode: 'edit' as const,
      }))
      setTabs(initialTabs)
    } else {
      handleNewNote()
    }
  }, [])

  // ── Strata connectivity ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const online = await isStrataOnline()
      if (!cancelled) setStrataOnline(online)
    }
    check()
    const iv = setInterval(check, 30_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  // ── Auto-save debounce ─────────────────────────────────────────────────
  useEffect(() => {
    if (!activeTab?.isDirty) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      if (activeTab) {
        updateFileContent(activeTab.fileId, activeTab.content)
        setTabs(prev => prev.map((t, i) => i === activeTabIdx ? { ...t, isDirty: false } : t))
      }
    }, 1500)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [activeTab?.content, activeTab?.isDirty, activeTabIdx])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if (ctrl && e.key === 'n') {
        e.preventDefault()
        handleNewNote()
      }
      if (ctrl && e.key === 'h') {
        e.preventDefault()
        setFind(prev => ({ ...prev, isOpen: !prev.isOpen }))
      }
      if (ctrl && e.key === 'f') {
        e.preventDefault()
        setFind(prev => ({ ...prev, isOpen: true }))
      }
      if (ctrl && e.key === 'z') {
        e.preventDefault()
        handleUndo()
      }
      if (ctrl && e.key === 'y') {
        e.preventDefault()
        handleRedo()
      }
      if (ctrl && e.key === 'w' && tabs.length > 0) {
        e.preventDefault()
        handleCloseTab(activeTabIdx)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTabIdx, tabs])

  // ── Tab management ─────────────────────────────────────────────────────
  const handleNewNote = useCallback(() => {
    const now = new Date()
    const name = `Note ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.md`
    const file = createFile(name, '')
    const newTab: NoteTab = {
      fileId: file.id,
      name: file.name,
      content: '',
      isDirty: false,
      isPinned: false,
      isStarred: false,
      cursorPos: 0,
      scrollPos: 0,
      mode: 'edit',
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabIdx(tabs.length)
  }, [tabs.length])

  const handleCloseTab = useCallback((idx: number) => {
    const tab = tabs[idx]
    if (tab?.isDirty) {
      updateFileContent(tab.fileId, tab.content)
    }
    setTabs(prev => prev.filter((_, i) => i !== idx))
    setActiveTabIdx(prev => Math.min(prev, Math.max(0, tabs.length - 2)))
  }, [tabs])

  const handleOpenFile = useCallback((file: DesktopFile) => {
    const existingIdx = tabs.findIndex(t => t.fileId === file.id)
    if (existingIdx >= 0) {
      setActiveTabIdx(existingIdx)
      return
    }
    const newTab: NoteTab = {
      fileId: file.id,
      name: file.name,
      content: file.content,
      isDirty: false,
      isPinned: false,
      isStarred: false,
      cursorPos: 0,
      scrollPos: 0,
      mode: 'edit',
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabIdx(tabs.length)
  }, [tabs])

  // ── Editing ────────────────────────────────────────────────────────────
  const handleContentChange = useCallback((newContent: string) => {
    if (!activeTab) return
    // Push to undo
    setUndoStack(prev => ({
      ...prev,
      [activeTab.fileId]: [
        ...(prev[activeTab.fileId] || []).slice(-50),
        { content: activeTab.content, cursorPos: activeTab.cursorPos, timestamp: Date.now() },
      ],
    }))
    setRedoStack(prev => ({ ...prev, [activeTab.fileId]: [] }))
    setTabs(prev => prev.map((t, i) =>
      i === activeTabIdx ? { ...t, content: newContent, isDirty: true } : t
    ))
  }, [activeTab, activeTabIdx])

  const handleSave = useCallback(() => {
    if (!activeTab) return
    updateFileContent(activeTab.fileId, activeTab.content)
    setTabs(prev => prev.map((t, i) => i === activeTabIdx ? { ...t, isDirty: false } : t))
    toast.success('Saved', { duration: 1200 })
  }, [activeTab, activeTabIdx])

  const handleUndo = useCallback(() => {
    if (!activeTab) return
    const stack = undoStack[activeTab.fileId] || []
    if (stack.length === 0) return
    const entry = stack[stack.length - 1]
    setUndoStack(prev => ({ ...prev, [activeTab.fileId]: stack.slice(0, -1) }))
    setRedoStack(prev => ({
      ...prev,
      [activeTab.fileId]: [...(prev[activeTab.fileId] || []), { content: activeTab.content, cursorPos: activeTab.cursorPos, timestamp: Date.now() }],
    }))
    setTabs(prev => prev.map((t, i) =>
      i === activeTabIdx ? { ...t, content: entry.content, isDirty: true } : t
    ))
  }, [activeTab, activeTabIdx, undoStack])

  const handleRedo = useCallback(() => {
    if (!activeTab) return
    const stack = redoStack[activeTab.fileId] || []
    if (stack.length === 0) return
    const entry = stack[stack.length - 1]
    setRedoStack(prev => ({ ...prev, [activeTab.fileId]: stack.slice(0, -1) }))
    setUndoStack(prev => ({
      ...prev,
      [activeTab.fileId]: [...(prev[activeTab.fileId] || []), { content: activeTab.content, cursorPos: activeTab.cursorPos, timestamp: Date.now() }],
    }))
    setTabs(prev => prev.map((t, i) =>
      i === activeTabIdx ? { ...t, content: entry.content, isDirty: true } : t
    ))
  }, [activeTab, activeTabIdx, redoStack])

  // ── Markdown toolbar insertion ─────────────────────────────────────────
  const insertMarkdown = useCallback((before: string, after = '') => {
    const ta = textareaRef.current
    if (!ta || !activeTab) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = activeTab.content.substring(start, end) || 'text'
    const newContent = activeTab.content.substring(0, start) + before + selected + after + activeTab.content.substring(end)
    handleContentChange(newContent)
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = start + before.length
      ta.selectionEnd = start + before.length + selected.length
    })
  }, [activeTab, handleContentChange])

  // ── Find & Replace ─────────────────────────────────────────────────────
  const findMatches = useMemo(() => {
    if (!find.isOpen || !find.query || !activeTab) return []
    try {
      const flags = find.caseSensitive ? 'g' : 'gi'
      const regex = find.useRegex
        ? new RegExp(find.query, flags)
        : new RegExp(find.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
      const matches: { start: number; end: number }[] = []
      let match
      while ((match = regex.exec(activeTab.content)) !== null) {
        matches.push({ start: match.index, end: match.index + match[0].length })
        if (matches.length > 1000) break
      }
      return matches
    } catch (_e) {
      return []
    }
  }, [find.isOpen, find.query, find.caseSensitive, find.useRegex, activeTab?.content])

  const handleReplace = useCallback(() => {
    if (!activeTab || findMatches.length === 0) return
    const match = findMatches[find.currentMatch % findMatches.length]
    if (!match) return
    const newContent = activeTab.content.substring(0, match.start) + find.replacement + activeTab.content.substring(match.end)
    handleContentChange(newContent)
  }, [activeTab, findMatches, find.currentMatch, find.replacement, handleContentChange])

  const handleReplaceAll = useCallback(() => {
    if (!activeTab || !find.query) return
    try {
      const flags = find.caseSensitive ? 'g' : 'gi'
      const regex = find.useRegex
        ? new RegExp(find.query, flags)
        : new RegExp(find.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
      const newContent = activeTab.content.replace(regex, find.replacement)
      handleContentChange(newContent)
      toast.success(`Replaced ${findMatches.length} occurrences`)
    } catch (_e) { /* invalid regex */ }
  }, [activeTab, find, findMatches.length, handleContentChange])

  // ── AI Agent Actions ───────────────────────────────────────────────────
  const handleAIAction = useCallback(async (actionId: string) => {
    if (!activeTab) return
    const action = AI_ACTIONS.find(a => a.id === actionId)
    if (!action) return

    setIsAIProcessing(true)
    setIsAIMenuOpen(false)

    // Get selected text or full content
    const ta = textareaRef.current
    const text = ta && ta.selectionStart !== ta.selectionEnd
      ? activeTab.content.substring(ta.selectionStart, ta.selectionEnd)
      : activeTab.content

    try {
      // Call AitherMind / LLM service
      const res = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a helpful writing assistant. Return only the processed text, no explanations.' },
            { role: 'user', content: `${action.prompt}\n\n${text}` },
          ],
          model: 'reflex',
          max_tokens: 4096,
        }),
      })

      if (!res.ok) throw new Error('LLM unavailable')

      const data = await res.json()
      const result = data.choices?.[0]?.message?.content || data.response || data.text || ''

      if (result) {
        if (ta && ta.selectionStart !== ta.selectionEnd) {
          // Replace selection
          const newContent = activeTab.content.substring(0, ta.selectionStart) + result + activeTab.content.substring(ta.selectionEnd)
          handleContentChange(newContent)
        } else {
          // Replace entire content
          handleContentChange(result)
        }
        toast.success(`AI: ${action.label} complete`)
      }
    } catch (_e) {
      toast.error('AI service unavailable — is AitherMind running?')
    } finally {
      setIsAIProcessing(false)
    }
  }, [activeTab, handleContentChange])

  // ── Export ─────────────────────────────────────────────────────────────
  const handleExport = useCallback((format: 'md' | 'txt') => {
    if (!activeTab) return
    const blob = new Blob([activeTab.content], { type: format === 'md' ? 'text/markdown' : 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = activeTab.name.replace(/\.[^.]+$/, `.${format}`)
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported as .${format}`)
  }, [activeTab])

  // ── Sync to Strata ─────────────────────────────────────────────────────
  const handleSync = useCallback(async () => {
    if (!activeTab) return
    updateFileContent(activeTab.fileId, activeTab.content)
    const ok = await syncFileToStrata(activeTab.fileId)
    if (ok) {
      toast.success('Synced to Strata')
    } else {
      toast.error('Sync failed — Strata offline')
    }
  }, [activeTab])

  // ── Stats ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!activeTab) return { words: 0, chars: 0, lines: 0, readTime: '0 min' }
    const words = activeTab.content.trim() ? activeTab.content.trim().split(/\s+/).length : 0
    const chars = activeTab.content.length
    const lines = activeTab.content.split('\n').length
    const readTime = Math.max(1, Math.ceil(words / 200))
    return { words, chars, lines, readTime: `${readTime} min` }
  }, [activeTab?.content])

  // ── Tab key support ────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newContent = activeTab!.content.substring(0, start) + '  ' + activeTab!.content.substring(end)
      handleContentChange(newContent)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }, [activeTab, handleContentChange])

  // ── All files sidebar ──────────────────────────────────────────────────
  const allFiles = useMemo(() => listFiles(), [tabs])

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════

  // Empty state
  if (tabs.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center h-full bg-zinc-950 text-zinc-500 ${className}`}>
        <FileText className="w-12 h-12 mb-4 text-zinc-700" />
        <p className="text-sm font-medium mb-2">Notepad Pro</p>
        <p className="text-xs text-zinc-600 mb-4">No notes open</p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleNewNote}
          className="border-zinc-700 text-zinc-400 hover:text-white"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          New Note
        </Button>
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full bg-zinc-950 ${className}`}>
      {/* ── Tab Bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center bg-zinc-900/80 border-b border-zinc-800/60 min-h-[36px]">
        {/* Sidebar toggle */}
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          className="px-2 py-2 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
          title="Files sidebar"
        >
          <FileText className="w-3.5 h-3.5" />
        </button>

        {/* Tabs */}
        <div className="flex-1 flex items-center overflow-x-auto scrollbar-none">
          {tabs.map((tab, idx) => (
            <button
              key={tab.fileId}
              onClick={() => setActiveTabIdx(idx)}
              className={`group flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-r border-zinc-800/40 whitespace-nowrap transition-colors min-w-0
                ${idx === activeTabIdx
                  ? 'bg-zinc-950 text-zinc-200 border-b-2 border-b-[#5EC9CC]'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}`}
            >
              {tab.isPinned && <Pin className="w-2.5 h-2.5 text-blue-400 flex-shrink-0" />}
              {tab.isStarred && <Star className="w-2.5 h-2.5 text-amber-400 flex-shrink-0 fill-amber-400" />}
              <span className="truncate max-w-[120px]">{tab.name}</span>
              {tab.isDirty && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />}
              <button
                onClick={(e) => { e.stopPropagation(); handleCloseTab(idx) }}
                className="ml-1 opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-zinc-300 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </button>
          ))}
        </div>

        {/* New tab */}
        <button
          onClick={handleNewNote}
          className="px-2 py-2 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
          title="New Note (Ctrl+N)"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      {activeTab && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-zinc-800/40 bg-zinc-900/40">
          {/* Format buttons */}
          <button onClick={() => insertMarkdown('**', '**')} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded" title="Bold (Ctrl+B)">
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => insertMarkdown('*', '*')} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded" title="Italic">
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => insertMarkdown('`', '`')} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded" title="Code">
            <Code2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => insertMarkdown('## ')} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded" title="Heading">
            <Hash className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => insertMarkdown('- ')} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded" title="Bullet list">
            <List className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => insertMarkdown('1. ')} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded" title="Numbered list">
            <ListOrdered className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => insertMarkdown('- [ ] ')} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded" title="Checkbox">
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => insertMarkdown('> ')} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded" title="Blockquote">
            <Quote className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => insertMarkdown('[', '](url)')} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded" title="Link">
            <Link2 className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-5 bg-zinc-800 mx-1" />

          {/* Undo / Redo */}
          <button onClick={handleUndo} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded" title="Undo (Ctrl+Z)">
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleRedo} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded" title="Redo (Ctrl+Y)">
            <Redo2 className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-5 bg-zinc-800 mx-1" />

          {/* Find & Replace */}
          <button
            onClick={() => setFind(prev => ({ ...prev, isOpen: !prev.isOpen }))}
            className={`p-1.5 rounded transition-colors ${find.isOpen ? 'text-blue-400 bg-blue-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
            title="Find & Replace (Ctrl+H)"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-5 bg-zinc-800 mx-1" />

          {/* View mode */}
          <button
            onClick={() => setTabs(prev => prev.map((t, i) => i === activeTabIdx ? { ...t, mode: t.mode === 'edit' ? 'preview' : t.mode === 'preview' ? 'split' : 'edit' } : t))}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded"
            title={`Mode: ${activeTab.mode}`}
          >
            {activeTab.mode === 'edit' ? <Type className="w-3.5 h-3.5" /> :
             activeTab.mode === 'preview' ? <Eye className="w-3.5 h-3.5" /> :
             <BookOpen className="w-3.5 h-3.5" />}
          </button>

          <div className="flex-1" />

          {/* AI Agent Menu */}
          <div className="relative">
            <button
              onClick={() => setIsAIMenuOpen(!isAIMenuOpen)}
              disabled={isAIProcessing}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors
                ${isAIProcessing
                  ? 'text-[#5EC9CC] bg-[#5EC9CC]/10'
                  : 'text-zinc-500 hover:text-[#5EC9CC] hover:bg-[#7AD6D8]/10'}`}
              title="AI Assist"
            >
              {isAIProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              AI
              <ChevronDown className="w-2.5 h-2.5" />
            </button>

            <AnimatePresence>
              {isAIMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute right-0 top-full mt-1 w-48 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden"
                >
                  <div className="px-3 py-2 text-[10px] text-zinc-500 font-medium uppercase tracking-wider border-b border-zinc-800">
                    AI Actions
                  </div>
                  {AI_ACTIONS.map(action => {
                    const Icon = action.icon
                    return (
                      <button
                        key={action.id}
                        onClick={() => handleAIAction(action.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                      >
                        <Icon className="w-3.5 h-3.5 text-[#5EC9CC]" />
                        {action.label}
                      </button>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded"
            title="Save (Ctrl+S)"
          >
            <Save className="w-3.5 h-3.5" />
          </button>

          {/* Sync */}
          <button
            onClick={handleSync}
            disabled={!strataOnline}
            className={`p-1.5 rounded ${strataOnline ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-zinc-700'}`}
            title={strataOnline ? 'Sync to Strata' : 'Strata offline'}
          >
            {strataOnline ? <Cloud className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
          </button>

          {/* Export */}
          <button
            onClick={() => handleExport('md')}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded"
            title="Export"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Find & Replace Bar ───────────────────────────────────────── */}
      <AnimatePresence>
        {find.isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-zinc-800/40 bg-zinc-900/60 overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Search className="w-3 h-3 text-zinc-600 flex-shrink-0" />
              <input
                type="text"
                value={find.query}
                onChange={e => setFind(prev => ({ ...prev, query: e.target.value }))}
                placeholder="Find..."
                className="flex-1 bg-zinc-800/60 border border-zinc-700/50 rounded px-2 py-1 text-xs text-white placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-[#5EC9CC]/50"
                autoFocus
              />
              <Replace className="w-3 h-3 text-zinc-600 flex-shrink-0" />
              <input
                type="text"
                value={find.replacement}
                onChange={e => setFind(prev => ({ ...prev, replacement: e.target.value }))}
                placeholder="Replace..."
                className="flex-1 bg-zinc-800/60 border border-zinc-700/50 rounded px-2 py-1 text-xs text-white placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-[#5EC9CC]/50"
              />
              <Badge variant="outline" className="text-[9px] border-zinc-700 text-zinc-500 px-1.5 py-0">
                {findMatches.length} match{findMatches.length !== 1 && 'es'}
              </Badge>
              <button onClick={() => setFind(prev => ({ ...prev, currentMatch: (prev.currentMatch + 1) % Math.max(1, findMatches.length) }))} className="p-1 text-zinc-500 hover:text-zinc-300 text-xs">↓</button>
              <button onClick={() => setFind(prev => ({ ...prev, currentMatch: (prev.currentMatch - 1 + findMatches.length) % Math.max(1, findMatches.length) }))} className="p-1 text-zinc-500 hover:text-zinc-300 text-xs">↑</button>
              <button onClick={handleReplace} className="px-2 py-0.5 text-[10px] text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded">Replace</button>
              <button onClick={handleReplaceAll} className="px-2 py-0.5 text-[10px] text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded">All</button>
              <button onClick={() => setFind(prev => ({ ...prev, caseSensitive: !prev.caseSensitive }))} className={`p-1 rounded text-[10px] ${find.caseSensitive ? 'text-blue-400 bg-blue-500/10' : 'text-zinc-600 hover:text-zinc-400'}`} title="Case sensitive">Aa</button>
              <button onClick={() => setFind(prev => ({ ...prev, useRegex: !prev.useRegex }))} className={`p-1 rounded text-[10px] font-mono ${find.useRegex ? 'text-blue-400 bg-blue-500/10' : 'text-zinc-600 hover:text-zinc-400'}`} title="Regex">.*</button>
              <button onClick={() => setFind({ isOpen: false, query: '', replacement: '', matchCount: 0, currentMatch: 0, caseSensitive: false, useRegex: false })} className="p-1 text-zinc-600 hover:text-zinc-300">
                <X className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Sidebar */}
        <AnimatePresence>
          {showSidebar && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 200, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="border-r border-zinc-800/40 bg-zinc-900/40 overflow-hidden flex flex-col"
            >
              <div className="px-3 py-2 text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
                All Notes ({allFiles.length})
              </div>
              <div className="flex-1 overflow-y-auto">
                {allFiles.map(file => (
                  <button
                    key={file.id}
                    onClick={() => handleOpenFile(file)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 transition-colors
                      ${tabs.some(t => t.fileId === file.id) ? 'text-zinc-200' : 'text-zinc-500'}`}
                  >
                    <FileText className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{file.name}</span>
                    {file.synced && <Cloud className="w-2.5 h-2.5 text-emerald-600 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Editor / Preview */}
        {activeTab && (
          <div className="flex-1 flex min-h-0">
            {/* Editor pane */}
            {(activeTab.mode === 'edit' || activeTab.mode === 'split') && (
              <div className="flex-1 relative min-h-0">
                {/* Line numbers gutter */}
                <div className="absolute left-0 top-0 bottom-0 w-9 bg-zinc-900/20 border-r border-zinc-800/20 overflow-hidden pointer-events-none">
                  <div className="pt-3 px-1 text-right">
                    {Array.from({ length: Math.max(stats.lines, 30) }, (_, i) => (
                      <div key={i} className="text-[10px] leading-[1.6rem] text-zinc-700 font-mono">{i + 1}</div>
                    ))}
                  </div>
                </div>

                <textarea
                  ref={textareaRef}
                  value={activeTab.content}
                  onChange={e => handleContentChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full h-full resize-none bg-transparent text-zinc-200 font-mono text-[13px] leading-[1.6rem] pl-11 pr-4 pt-3 pb-16 focus:outline-none placeholder:text-zinc-700 whitespace-pre-wrap break-words"
                  placeholder="Start writing..."
                  spellCheck={true}
                />
              </div>
            )}

            {/* Preview pane */}
            {(activeTab.mode === 'preview' || activeTab.mode === 'split') && (
              <div className={`${activeTab.mode === 'split' ? 'flex-1 border-l border-zinc-800/40' : 'flex-1'} overflow-y-auto p-4`}>
                <div
                  className="prose prose-invert prose-sm max-w-none text-zinc-300 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(activeTab.content)) }}
                />
                {!activeTab.content && (
                  <p className="text-zinc-600 text-sm italic">Nothing to preview</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Status Bar ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-zinc-800/40 bg-zinc-900/30 text-[10px] text-zinc-600">
        <div className="flex items-center gap-3">
          <span>{stats.words} words</span>
          <span>{stats.chars} chars</span>
          <span>{stats.lines} lines</span>
          <span className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {stats.readTime} read
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="capitalize">{activeTab?.mode || 'edit'}</span>
          {activeTab?.isDirty && <span className="text-amber-500">Modified</span>}
          <span>Markdown</span>
        </div>
      </div>
    </div>
  )
}
