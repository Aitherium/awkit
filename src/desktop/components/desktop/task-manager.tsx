'use client'

/**
 * Task Manager Widget
 * ====================
 *
 * Deep integration with AitherScheduler (port 8109) and the personal-tasks
 * router for full task lifecycle management from the desktop.
 *
 * Features:
 *  - Todo list with priorities, due dates, categories
 *  - Calendar event quick-add
 *  - Alarm / Reminder creation and management
 *  - Live scheduler job feed
 *  - Agent task delegation ("assign to Hera", "assign to Saga")
 *  - Pomodoro timer
 *  - Kanban-style columns (Backlog → In Progress → Done)
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckSquare, Circle, Plus, Trash2, Clock, Calendar,
  Bell, AlertTriangle, Flag, Star, StarOff, Edit3, X,
  ChevronDown, ChevronRight, Filter, SortAsc, Bot,
  Timer, Play, Pause, RotateCcw, Inbox, Loader2,
  CheckCircle2, ArrowRight, Tag, Search, RefreshCw,
  Columns3, ListTodo, LayoutGrid, Zap, Send,
  AlarmClock, CalendarPlus, BellRing, Users,
} from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { toast } from 'sonner'
import { getServiceUrl } from '../../lib/service-urls'

// ============================================================================
// TYPES
// ============================================================================

interface TodoItem {
  id: string
  title: string
  description: string
  status: 'backlog' | 'in-progress' | 'done' | 'cancelled'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  category: string
  due_date: string | null
  created_at: string
  completed_at: string | null
  tags: string[]
  starred: boolean
  assignee: string | null  // agent name
  reminder_at: string | null
  estimated_minutes: number | null
  actual_minutes: number | null
}

interface SchedulerJob {
  id: string
  name: string
  type: string
  status: string
  next_run: string | null
  last_run: string | null
  schedule: string | null
}

interface QuickAlarm {
  title: string
  alarm_at: string
  alarm_type: string
}

type ViewMode = 'list' | 'kanban' | 'agenda'
type SortBy = 'priority' | 'due_date' | 'created_at' | 'title'

// ============================================================================
// CONSTANTS
// ============================================================================

const SCHEDULER_BASE = getServiceUrl('scheduler')

const PRIORITY_CONFIG = {
  urgent: { color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30', icon: '🔴', label: 'Urgent' },
  high: { color: 'text-orange-400', bg: 'bg-orange-500/15', border: 'border-orange-500/30', icon: '🟠', label: 'High' },
  medium: { color: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/30', icon: '🟡', label: 'Medium' },
  low: { color: 'text-blue-400', bg: 'bg-blue-500/15', border: 'border-blue-500/30', icon: '🔵', label: 'Low' },
}

const STATUS_CONFIG = {
  backlog: { color: 'text-zinc-400', bg: 'bg-zinc-500/15', label: 'Backlog', icon: Inbox },
  'in-progress': { color: 'text-blue-400', bg: 'bg-blue-500/15', label: 'In Progress', icon: Play },
  done: { color: 'text-emerald-400', bg: 'bg-emerald-500/15', label: 'Done', icon: CheckCircle2 },
  cancelled: { color: 'text-zinc-500', bg: 'bg-zinc-600/15', label: 'Cancelled', icon: X },
}

const AGENT_ASSIGNEES = [
  { id: 'hera', name: 'Hera', color: 'text-rose-400', specialty: 'Communication' },
  { id: 'saga', name: 'Saga', color: 'text-[#5EC9CC]', specialty: 'Content' },
  { id: 'lyra', name: 'Lyra', color: 'text-amber-400', specialty: 'Research' },
  { id: 'vera', name: 'Vera', color: 'text-emerald-400', specialty: 'Analysis' },
  { id: 'demiurge', name: 'Demiurge', color: 'text-[#5EC9CC]', specialty: 'Creative' },
]

const CATEGORIES = ['Work', 'Personal', 'Health', 'Learning', 'Finance', 'Home', 'Project', 'Misc']

const STORAGE_KEY = 'aitherzero:task-manager'

// ============================================================================
// LOCAL PERSISTENCE
// ============================================================================

function loadTodos(): TodoItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (_e) { return [] }
}

function saveTodos(todos: TodoItem[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
}

// ============================================================================
// POMODORO TIMER
// ============================================================================

function PomodoroTimer() {
  const [seconds, setSeconds] = useState(25 * 60)
  const [isRunning, setIsRunning] = useState(false)
  const [mode, setMode] = useState<'work' | 'break'>('work')
  const intervalRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setSeconds(prev => {
          if (prev <= 1) {
            setIsRunning(false)
            // Play notification
            try { new Audio('/notification.mp3').play().catch(() => {}) } catch (_e) {}
            toast.success(mode === 'work' ? '⏰ Work session complete! Take a break.' : '☕ Break over! Back to work.')
            const nextMode = mode === 'work' ? 'break' : 'work'
            setMode(nextMode)
            return nextMode === 'work' ? 25 * 60 : 5 * 60
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [isRunning, mode])

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  const progress = mode === 'work'
    ? ((25 * 60 - seconds) / (25 * 60)) * 100
    : ((5 * 60 - seconds) / (5 * 60)) * 100

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900/60 border border-zinc-800/50 rounded-xl">
      <div className="relative w-8 h-8">
        <svg className="w-8 h-8 -rotate-90" viewBox="0 0 36 36">
          <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-800" />
          <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={`${progress}, 100`}
            className={mode === 'work' ? 'text-red-400' : 'text-emerald-400'} />
        </svg>
        <Timer className={`absolute inset-0 m-auto w-3.5 h-3.5 ${mode === 'work' ? 'text-red-400' : 'text-emerald-400'}`} />
      </div>
      <div className="text-sm font-mono text-zinc-200 w-12 text-center">
        {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </div>
      <button onClick={() => setIsRunning(!isRunning)} className="p-1 text-zinc-400 hover:text-white transition-colors">
        {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      </button>
      <button onClick={() => { setIsRunning(false); setSeconds(mode === 'work' ? 25 * 60 : 5 * 60) }} className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors">
        <RotateCcw className="w-3 h-3" />
      </button>
      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${mode === 'work' ? 'border-red-500/30 text-red-400' : 'border-emerald-500/30 text-emerald-400'}`}>
        {mode === 'work' ? 'Focus' : 'Break'}
      </Badge>
    </div>
  )
}

// ============================================================================
// TASK ROW
// ============================================================================

function TaskRow({
  todo,
  onToggle,
  onUpdate,
  onDelete,
  onStar,
}: {
  todo: TodoItem
  onToggle: () => void
  onUpdate: (updates: Partial<TodoItem>) => void
  onDelete: () => void
  onStar: () => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const pri = PRIORITY_CONFIG[todo.priority]
  const sts = STATUS_CONFIG[todo.status]
  const isOverdue = todo.due_date && new Date(todo.due_date) < new Date() && todo.status !== 'done'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className={`group border rounded-lg transition-colors ${
        todo.status === 'done'
          ? 'bg-zinc-900/30 border-zinc-800/30'
          : isOverdue
            ? 'bg-red-950/20 border-red-500/20'
            : 'bg-zinc-900/50 border-zinc-800/50 hover:border-zinc-700/50'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Checkbox */}
        <button onClick={onToggle} className="flex-shrink-0">
          {todo.status === 'done' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <Circle className={`w-4 h-4 ${pri.color} hover:text-white transition-colors`} />
          )}
        </button>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <span className={`text-sm ${todo.status === 'done' ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
            {todo.title}
          </span>
          {todo.description && !isExpanded && (
            <span className="text-xs text-zinc-600 ml-2 truncate">{todo.description.substring(0, 40)}...</span>
          )}
        </div>

        {/* Tags */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {todo.assignee && (
            <Badge variant="outline" className="text-[9px] border-[#5EC9CC]/30 text-[#5EC9CC] px-1 py-0">
              <Bot className="w-2 h-2 mr-0.5" />
              {todo.assignee}
            </Badge>
          )}
          {todo.category && (
            <Badge variant="outline" className="text-[9px] border-zinc-700 text-zinc-500 px-1 py-0">
              {todo.category}
            </Badge>
          )}
          {isOverdue && (
            <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
          )}
          {todo.due_date && (
            <span className={`text-[10px] flex-shrink-0 ${isOverdue ? 'text-red-400' : 'text-zinc-500'}`}>
              {new Date(todo.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </span>
          )}
          <Badge variant="outline" className={`text-[9px] px-1 py-0 ${pri.border} ${pri.color}`}>
            {pri.icon}
          </Badge>
          {todo.starred && <Star className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={onStar} className="p-1 text-zinc-600 hover:text-amber-400 transition-colors">
            {todo.starred ? <StarOff className="w-3 h-3" /> : <Star className="w-3 h-3" />}
          </button>
          <button onClick={() => setIsExpanded(!isExpanded)} className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors">
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          <button onClick={onDelete} className="p-1 text-zinc-600 hover:text-red-400 transition-colors">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 space-y-2 border-t border-zinc-800/30">
              {/* Description */}
              <textarea
                value={todo.description}
                onChange={e => onUpdate({ description: e.target.value })}
                placeholder="Add description..."
                className="w-full bg-zinc-800/40 border border-zinc-700/30 rounded-lg px-2 py-1.5 text-xs text-zinc-300 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-[#5EC9CC]/30 resize-none"
                rows={2}
              />

              <div className="flex items-center gap-2 flex-wrap">
                {/* Status */}
                <select
                  value={todo.status}
                  onChange={e => onUpdate({ status: e.target.value as TodoItem['status'] })}
                  className="bg-zinc-800/60 border border-zinc-700/40 rounded-md px-2 py-1 text-[10px] text-zinc-300 outline-none"
                >
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>

                {/* Priority */}
                <select
                  value={todo.priority}
                  onChange={e => onUpdate({ priority: e.target.value as TodoItem['priority'] })}
                  className="bg-zinc-800/60 border border-zinc-700/40 rounded-md px-2 py-1 text-[10px] text-zinc-300 outline-none"
                >
                  {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>

                {/* Category */}
                <select
                  value={todo.category}
                  onChange={e => onUpdate({ category: e.target.value })}
                  className="bg-zinc-800/60 border border-zinc-700/40 rounded-md px-2 py-1 text-[10px] text-zinc-300 outline-none"
                >
                  <option value="">No category</option>
                  {CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>

                {/* Due date */}
                <input
                  type="datetime-local"
                  value={todo.due_date || ''}
                  onChange={e => onUpdate({ due_date: e.target.value || null })}
                  className="bg-zinc-800/60 border border-zinc-700/40 rounded-md px-2 py-1 text-[10px] text-zinc-300 outline-none"
                />

                {/* Agent assignee */}
                <select
                  value={todo.assignee || ''}
                  onChange={e => onUpdate({ assignee: e.target.value || null })}
                  className="bg-zinc-800/60 border border-zinc-700/40 rounded-md px-2 py-1 text-[10px] text-zinc-300 outline-none"
                >
                  <option value="">Unassigned</option>
                  {AGENT_ASSIGNEES.map(a => (
                    <option key={a.id} value={a.name}>{a.name} ({a.specialty})</option>
                  ))}
                </select>

                {/* Time estimate */}
                <input
                  type="number"
                  value={todo.estimated_minutes || ''}
                  onChange={e => onUpdate({ estimated_minutes: e.target.value ? parseInt(e.target.value) : null })}
                  placeholder="Est. min"
                  className="w-20 bg-zinc-800/60 border border-zinc-700/40 rounded-md px-2 py-1 text-[10px] text-zinc-300 outline-none placeholder:text-zinc-600"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ============================================================================
// TASK MANAGER WIDGET
// ============================================================================

export function TaskManagerWidget({ className = '' }: { className?: string }) {
  const [todos, setTodos] = useState<TodoItem[]>(() => loadTodos())
  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState<TodoItem['priority']>('medium')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [filterStatus, setFilterStatus] = useState<string>('active')
  const [filterCategory, setFilterCategory] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('priority')
  const [searchQuery, setSearchQuery] = useState('')
  const [schedulerJobs, setSchedulerJobs] = useState<SchedulerJob[]>([])
  const [schedulerOnline, setSchedulerOnline] = useState(false)
  const [showQuickAlarm, setShowQuickAlarm] = useState(false)
  const [quickAlarmTime, setQuickAlarmTime] = useState('')
  const [quickAlarmTitle, setQuickAlarmTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Persist todos
  useEffect(() => { saveTodos(todos) }, [todos])

  // Check scheduler and load jobs
  useEffect(() => {
    let cancelled = false
    const fetchJobs = async () => {
      try {
        const res = await fetch(`${SCHEDULER_BASE}/scheduler/jobs`, { signal: AbortSignal.timeout(3000) })
        if (res.ok && !cancelled) {
          const data = await res.json()
          setSchedulerJobs(Array.isArray(data) ? data.slice(0, 20) : data.jobs?.slice(0, 20) || [])
          setSchedulerOnline(true)
        }
      } catch (_e) {
        if (!cancelled) setSchedulerOnline(false)
      }
    }
    fetchJobs()
    const iv = setInterval(fetchJobs, 30_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  // ── CRUD ───────────────────────────────────────────────────────────────
  const handleAddTodo = useCallback(() => {
    if (!newTitle.trim()) return
    const now = new Date().toISOString()
    const todo: TodoItem = {
      id: `todo-${Date.now()}`,
      title: newTitle.trim(),
      description: '',
      status: 'backlog',
      priority: newPriority,
      category: '',
      due_date: null,
      created_at: now,
      completed_at: null,
      tags: [],
      starred: false,
      assignee: null,
      reminder_at: null,
      estimated_minutes: null,
      actual_minutes: null,
    }
    setTodos(prev => [todo, ...prev])
    setNewTitle('')
    setNewPriority('medium')

    // Sync to scheduler if online
    if (schedulerOnline) {
      fetch(`${SCHEDULER_BASE}/personal/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: todo.title, priority: todo.priority }),
      }).catch(() => {})
    }

    toast.success('Task added')
  }, [newTitle, newPriority, schedulerOnline])

  const handleToggleTodo = useCallback((id: string) => {
    setTodos(prev => prev.map(t => {
      if (t.id !== id) return t
      const newStatus = t.status === 'done' ? 'backlog' : 'done'
      return {
        ...t,
        status: newStatus,
        completed_at: newStatus === 'done' ? new Date().toISOString() : null,
      }
    }))
  }, [])

  const handleUpdateTodo = useCallback((id: string, updates: Partial<TodoItem>) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
  }, [])

  const handleDeleteTodo = useCallback((id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id))
    toast.success('Task removed')
  }, [])

  const handleStarTodo = useCallback((id: string) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, starred: !t.starred } : t))
  }, [])

  // ── Quick Alarm ────────────────────────────────────────────────────────
  const handleCreateAlarm = useCallback(async () => {
    if (!quickAlarmTitle.trim() || !quickAlarmTime) return
    try {
      const res = await fetch(`${SCHEDULER_BASE}/personal/alarms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: quickAlarmTitle.trim(),
          alarm_at: new Date(quickAlarmTime).toISOString(),
          alarm_type: 'reminder',
        }),
      })
      if (res.ok) {
        toast.success(`⏰ Alarm set: ${quickAlarmTitle}`)
        setShowQuickAlarm(false)
        setQuickAlarmTitle('')
        setQuickAlarmTime('')
      } else {
        toast.error('Failed to create alarm')
      }
    } catch (_e) {
      toast.error('Scheduler offline — alarm not created')
    }
  }, [quickAlarmTitle, quickAlarmTime])

  // ── Delegate to Agent ──────────────────────────────────────────────────
  const handleDelegateToAgent = useCallback(async (todoId: string, agentName: string) => {
    handleUpdateTodo(todoId, { assignee: agentName, status: 'in-progress' })
    try {
      const agent = AGENT_ASSIGNEES.find(a => a.name === agentName)
      await fetch(`${SCHEDULER_BASE}/scheduler/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_type: 'agent_delegation',
          agent: agentName.toLowerCase(),
          payload: { todo_id: todoId, title: todos.find(t => t.id === todoId)?.title },
        }),
      })
      toast.success(`Delegated to ${agentName}`)
    } catch (_e) {
      toast.info(`Marked for ${agentName} (offline)`)
    }
  }, [todos, handleUpdateTodo])

  // ── Filter & Sort ──────────────────────────────────────────────────────
  const filteredTodos = useMemo(() => {
    let items = [...todos]

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      items = items.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q))
      )
    }

    // Status filter
    if (filterStatus === 'active') {
      items = items.filter(t => t.status !== 'done' && t.status !== 'cancelled')
    } else if (filterStatus !== 'all') {
      items = items.filter(t => t.status === filterStatus)
    }

    // Category filter
    if (filterCategory) {
      items = items.filter(t => t.category === filterCategory)
    }

    // Sort
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 }
    items.sort((a, b) => {
      // Starred first
      if (a.starred !== b.starred) return a.starred ? -1 : 1
      switch (sortBy) {
        case 'priority':
          return priorityOrder[a.priority] - priorityOrder[b.priority]
        case 'due_date':
          if (!a.due_date && !b.due_date) return 0
          if (!a.due_date) return 1
          if (!b.due_date) return -1
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
        case 'created_at':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        case 'title':
          return a.title.localeCompare(b.title)
        default:
          return 0
      }
    })

    return items
  }, [todos, searchQuery, filterStatus, filterCategory, sortBy])

  // Stats
  const stats = useMemo(() => {
    const total = todos.length
    const done = todos.filter(t => t.status === 'done').length
    const overdue = todos.filter(t => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done').length
    const inProgress = todos.filter(t => t.status === 'in-progress').length
    return { total, done, overdue, inProgress, completion: total ? Math.round((done / total) * 100) : 0 }
  }, [todos])

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════

  return (
    <div className={`flex flex-col h-full bg-zinc-950 ${className}`}>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60 bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-zinc-200">Tasks</span>
          <Badge variant="outline" className="text-[9px] border-zinc-700 text-zinc-500 px-1.5 py-0">
            {stats.total}
          </Badge>
          {stats.overdue > 0 && (
            <Badge variant="outline" className="text-[9px] border-red-500/30 text-red-400 px-1.5 py-0">
              {stats.overdue} overdue
            </Badge>
          )}
          {schedulerOnline && (
            <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-400 px-1.5 py-0">
              <Zap className="w-2 h-2 mr-0.5" /> Live
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Quick alarm */}
          <button
            onClick={() => setShowQuickAlarm(!showQuickAlarm)}
            className="p-1.5 text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10 rounded transition-colors"
            title="Quick Alarm"
          >
            <AlarmClock className="w-3.5 h-3.5" />
          </button>

          {/* View mode */}
          <button
            onClick={() => setViewMode(viewMode === 'list' ? 'kanban' : 'list')}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded transition-colors"
            title={viewMode === 'list' ? 'Kanban view' : 'List view'}
          >
            {viewMode === 'list' ? <Columns3 className="w-3.5 h-3.5" /> : <ListTodo className="w-3.5 h-3.5" />}
          </button>

          {/* Sync */}
          <button
            onClick={async () => {
              try {
                const res = await fetch(`${SCHEDULER_BASE}/scheduler/jobs`, { signal: AbortSignal.timeout(3000) })
                if (res.ok) {
                  const data = await res.json()
                  setSchedulerJobs(Array.isArray(data) ? data : data.jobs || [])
                  setSchedulerOnline(true)
                  toast.success('Synced with scheduler')
                }
              } catch (_e) { toast.error('Scheduler offline') }
            }}
            className={`p-1.5 rounded transition-colors ${schedulerOnline ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-zinc-600'}`}
            title="Sync with AitherScheduler"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Quick Alarm Popup ────────────────────────────────────────── */}
      <AnimatePresence>
        {showQuickAlarm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-zinc-800/40 bg-amber-950/10 overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <AlarmClock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              <input
                type="text"
                value={quickAlarmTitle}
                onChange={e => setQuickAlarmTitle(e.target.value)}
                placeholder="Alarm title..."
                className="flex-1 bg-zinc-800/40 border border-zinc-700/40 rounded px-2 py-1 text-xs text-white placeholder:text-zinc-600 outline-none"
              />
              <input
                type="datetime-local"
                value={quickAlarmTime}
                onChange={e => setQuickAlarmTime(e.target.value)}
                className="bg-zinc-800/40 border border-zinc-700/40 rounded px-2 py-1 text-xs text-white outline-none"
              />
              <Button size="sm" onClick={handleCreateAlarm} className="h-6 px-2 text-xs bg-amber-600 hover:bg-amber-500">
                <Bell className="w-3 h-3 mr-1" /> Set
              </Button>
              <button onClick={() => setShowQuickAlarm(false)} className="p-1 text-zinc-600 hover:text-zinc-300">
                <X className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Stats Bar + Pomodoro ──────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/40 bg-zinc-900/30">
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {stats.done} done
          </span>
          <span className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            {stats.inProgress} active
          </span>
          <span className="text-zinc-600">{stats.completion}%</span>
          <div className="w-20 h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${stats.completion}%` }} />
          </div>
        </div>
        <PomodoroTimer />
      </div>

      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/30">
        <div className="flex-1 flex items-center gap-1 bg-zinc-800/40 border border-zinc-700/30 rounded-lg px-2">
          <Search className="w-3 h-3 text-zinc-600" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search tasks..."
            className="flex-1 bg-transparent text-xs text-white placeholder:text-zinc-600 outline-none py-1"
          />
        </div>

        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-zinc-800/40 border border-zinc-700/30 rounded-md px-2 py-1 text-[10px] text-zinc-400 outline-none"
        >
          <option value="active">Active</option>
          <option value="all">All</option>
          <option value="backlog">Backlog</option>
          <option value="in-progress">In Progress</option>
          <option value="done">Done</option>
        </select>

        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortBy)}
          className="bg-zinc-800/40 border border-zinc-700/30 rounded-md px-2 py-1 text-[10px] text-zinc-400 outline-none"
        >
          <option value="priority">Priority</option>
          <option value="due_date">Due Date</option>
          <option value="created_at">Newest</option>
          <option value="title">A-Z</option>
        </select>
      </div>

      {/* ── Add Task ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/40">
        <Plus className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAddTodo() }}
          placeholder="Add a task... (Enter to add)"
          className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-600 outline-none"
        />
        <select
          value={newPriority}
          onChange={e => setNewPriority(e.target.value as TodoItem['priority'])}
          className="bg-zinc-800/40 border border-zinc-700/30 rounded-md px-2 py-0.5 text-[10px] text-zinc-400 outline-none"
        >
          {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <Button size="sm" onClick={handleAddTodo} disabled={!newTitle.trim()} className="h-6 px-2 text-xs">
          Add
        </Button>
      </div>

      {/* ── Task List ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {viewMode === 'list' ? (
          <AnimatePresence mode="popLayout">
            {filteredTodos.map(todo => (
              <TaskRow
                key={todo.id}
                todo={todo}
                onToggle={() => handleToggleTodo(todo.id)}
                onUpdate={updates => handleUpdateTodo(todo.id, updates)}
                onDelete={() => handleDeleteTodo(todo.id)}
                onStar={() => handleStarTodo(todo.id)}
              />
            ))}
          </AnimatePresence>
        ) : (
          /* Kanban view */
          <div className="flex gap-3 h-full pb-2">
            {(['backlog', 'in-progress', 'done'] as const).map(status => {
              const config = STATUS_CONFIG[status]
              const StatusIcon = config.icon
              const columnTodos = filteredTodos.filter(t => t.status === status)
              return (
                <div key={status} className="flex-1 flex flex-col min-w-[180px]">
                  <div className={`flex items-center gap-1.5 px-2 py-1.5 mb-2 rounded-lg ${config.bg}`}>
                    <StatusIcon className={`w-3 h-3 ${config.color}`} />
                    <span className={`text-[11px] font-medium ${config.color}`}>{config.label}</span>
                    <Badge variant="outline" className="text-[9px] border-zinc-700 text-zinc-500 px-1 py-0 ml-auto">
                      {columnTodos.length}
                    </Badge>
                  </div>
                  <div className="flex-1 space-y-1.5 overflow-y-auto">
                    {columnTodos.map(todo => (
                      <TaskRow
                        key={todo.id}
                        todo={todo}
                        onToggle={() => handleToggleTodo(todo.id)}
                        onUpdate={updates => handleUpdateTodo(todo.id, updates)}
                        onDelete={() => handleDeleteTodo(todo.id)}
                        onStar={() => handleStarTodo(todo.id)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {filteredTodos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
            <CheckSquare className="w-8 h-8 mb-2 text-zinc-700" />
            <p className="text-sm">No tasks</p>
            <p className="text-xs mt-1">Add a task above to get started</p>
          </div>
        )}

        {/* ── Scheduler Jobs Feed ────────────────────────────────────── */}
        {schedulerOnline && schedulerJobs.length > 0 && (
          <div className="mt-4 pt-3 border-t border-zinc-800/40">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-3 h-3 text-amber-400" />
              <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
                Scheduler Jobs
              </span>
            </div>
            <div className="space-y-1">
              {schedulerJobs.slice(0, 8).map(job => (
                <div key={job.id} className="flex items-center gap-2 px-2 py-1.5 bg-zinc-900/40 border border-zinc-800/30 rounded-lg text-xs">
                  <div className={`w-1.5 h-1.5 rounded-full ${job.status === 'running' ? 'bg-emerald-400 animate-pulse' : job.status === 'scheduled' ? 'bg-blue-400' : 'bg-zinc-600'}`} />
                  <span className="text-zinc-300 flex-1 truncate">{job.name}</span>
                  <Badge variant="outline" className="text-[9px] border-zinc-700 text-zinc-500 px-1 py-0">
                    {job.type}
                  </Badge>
                  {job.next_run && (
                    <span className="text-[10px] text-zinc-600">
                      {new Date(job.next_run).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Status Bar ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-zinc-800/40 bg-zinc-900/30 text-[10px] text-zinc-600">
        <div className="flex items-center gap-2">
          <span>{filteredTodos.length} visible</span>
          <span>·</span>
          <span>{stats.total} total</span>
        </div>
        <div className="flex items-center gap-2">
          {schedulerOnline ? (
            <span className="text-emerald-500 flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Scheduler connected
            </span>
          ) : (
            <span className="text-zinc-600">Scheduler offline · Local mode</span>
          )}
        </div>
      </div>
    </div>
  )
}
