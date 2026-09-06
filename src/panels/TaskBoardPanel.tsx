'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// ---------------------------------------------------------------------------
// Data Model
// ---------------------------------------------------------------------------

interface LinkedItem {
  type: 'conversation' | 'agent' | 'person' | 'email' | 'event' | 'document'
  id: string
  title: string
}

interface Subtask {
  id: string
  title: string
  completed: boolean
}

interface TaskLabel {
  name: string
  color: string
}

interface Comment {
  comment_id: string
  comment: string
  author?: string
  created_at: string
}

interface Task {
  task_id: string
  title: string
  description?: string
  assignee?: string
  assignee_avatar?: string
  project?: string
  priority: string
  status: string
  due_date?: string
  tags?: string[]
  labels?: TaskLabel[]
  subtasks?: Subtask[]
  linked_items?: LinkedItem[]
  time_estimate?: number
  time_logged?: number
  comments?: Comment[]
  created_at?: string
  updated_at?: string
}

interface Project {
  project_id: string
  name: string
  description?: string
  color?: string
}

interface BoardData {
  todo: Task[]
  in_progress: Task[]
  review: Task[]
  done: Task[]
  blocked: Task[]
}

interface TaskStats {
  by_status?: Record<string, number>
  by_assignee?: Record<string, number>
  overdue_count?: number
  total?: number
}

type ViewMode = 'board' | 'list'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUSES = ['todo', 'in_progress', 'review', 'done', 'blocked'] as const
const STATUS_LABELS: Record<string, string> = {
  todo: 'Todo',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
  blocked: 'Blocked',
}
const STATUS_COLORS: Record<string, string> = {
  todo: '#6c7086',
  in_progress: '#89b4fa',
  review: '#cba6f7',
  done: '#a6e3a1',
  blocked: '#f38ba8',
}
const PRIORITY_COLORS: Record<string, string> = {
  low: '#6c7086',
  medium: '#89b4fa',
  high: '#fab387',
  urgent: '#f38ba8',
}
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

const LABEL_PRESETS: TaskLabel[] = [
  { name: 'Bug', color: '#f38ba8' },
  { name: 'Feature', color: '#89b4fa' },
  { name: 'Urgent', color: '#fab387' },
  { name: 'Design', color: '#cba6f7' },
  { name: 'Research', color: '#94e2d5' },
  { name: 'Docs', color: '#a6e3a1' },
  { name: 'Client', color: '#f9e2af' },
  { name: 'Internal', color: '#6c7086' },
]

const LINKED_ITEM_ICONS: Record<string, string> = {
  conversation: '\u{1F4AC}',
  agent: '\u{1F916}',
  person: '\u{1F464}',
  email: '\u2709\uFE0F',
  event: '\u{1F4C5}',
  document: '\u{1F4C4}',
}

const LINKED_ITEM_TYPES: Array<LinkedItem['type']> = [
  'conversation', 'agent', 'person', 'email', 'event', 'document',
]

const LINKED_TYPE_SEARCH_ENDPOINTS: Record<string, string> = {
  conversation: '/api/chat/conversations',
  person: '/api/directory/members',
  event: '/api/calendar/events',
  agent: '/api/agents',
  email: '/api/email/messages',
  document: '/api/documents',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TaskBoardPanelProps {
  apiBase?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TaskBoardPanel({ apiBase = '/api/tasks' }: TaskBoardPanelProps) {
  // --- View & data state ---
  const [view, setView] = useState<ViewMode>('board')
  const [loading, setLoading] = useState(true)
  const [board, setBoard] = useState<BoardData>({ todo: [], in_progress: [], review: [], done: [], blocked: [] })
  const [tasks, setTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [stats, setStats] = useState<TaskStats>({})

  // --- Filters ---
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterProject, setFilterProject] = useState('')

  // --- Create modal ---
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [newProject, setNewProject] = useState('')
  const [newPriority, setNewPriority] = useState('medium')
  const [newDueDate, setNewDueDate] = useState('')
  const [newTags, setNewTags] = useState('')
  const [newLabels, setNewLabels] = useState<TaskLabel[]>([])

  // --- Detail panel ---
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [newComment, setNewComment] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [editTitleValue, setEditTitleValue] = useState('')
  const [editingDescription, setEditingDescription] = useState(false)
  const [editDescValue, setEditDescValue] = useState('')
  const [editingAssignee, setEditingAssignee] = useState(false)
  const [editAssigneeValue, setEditAssigneeValue] = useState('')
  const [editingDueDate, setEditingDueDate] = useState(false)
  const [editDueDateValue, setEditDueDateValue] = useState('')
  const [editingPriority, setEditingPriority] = useState(false)
  const [editingProject, setEditingProject] = useState(false)
  const [editProjectValue, setEditProjectValue] = useState('')
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [showLabelPicker, setShowLabelPicker] = useState(false)
  const [showLinkPanel, setShowLinkPanel] = useState(false)
  const [linkType, setLinkType] = useState<LinkedItem['type']>('conversation')
  const [linkSearchQuery, setLinkSearchQuery] = useState('')
  const [linkSearchResults, setLinkSearchResults] = useState<Array<{ id: string; title: string }>>([])
  const [editTimeEstimate, setEditTimeEstimate] = useState(false)
  const [timeEstimateValue, setTimeEstimateValue] = useState('')
  const [editTimeLogged, setEditTimeLogged] = useState(false)
  const [timeLoggedValue, setTimeLoggedValue] = useState('')

  // --- Sort (list view) ---
  const [sortField, setSortField] = useState<string>('status')
  const [sortAsc, setSortAsc] = useState(true)

  // --- Drag-and-drop ---
  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)

  // --- Quick-add ---
  const [quickAddColumn, setQuickAddColumn] = useState<string | null>(null)
  const [quickAddValue, setQuickAddValue] = useState('')

  // --- Column collapse ---
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(new Set())

  // --- Refs ---
  const titleInputRef = useRef<HTMLInputElement>(null)
  const quickAddRef = useRef<HTMLInputElement>(null)

  // =========================================================================
  // Data fetching
  // =========================================================================

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set('status', filterStatus)
      if (filterAssignee) params.set('assignee', filterAssignee)
      if (filterProject) params.set('project', filterProject)
      const qs = params.toString()

      const [boardRes, tasksRes, projectsRes, statsRes] = await Promise.all([
        fetch(`${apiBase}/board${qs ? `?${qs}` : ''}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${apiBase}${qs ? `?${qs}` : ''}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${apiBase}/projects`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${apiBase}/stats`).then(r => r.ok ? r.json() : null).catch(() => null),
      ])

      if (boardRes?.data) {
        setBoard({
          todo: boardRes.data.todo || [],
          in_progress: boardRes.data.in_progress || [],
          review: boardRes.data.review || [],
          done: boardRes.data.done || [],
          blocked: boardRes.data.blocked || [],
        })
      }
      if (tasksRes?.data?.tasks) {
        setTasks(tasksRes.data.tasks)
      } else if (Array.isArray(tasksRes?.data)) {
        setTasks(tasksRes.data)
      }
      if (projectsRes?.data?.projects) {
        setProjects(projectsRes.data.projects)
      } else if (Array.isArray(projectsRes?.data)) {
        setProjects(projectsRes.data)
      }
      if (statsRes?.data) {
        setStats(statsRes.data)
      }
    } catch (e) {
      console.error('Tasks fetch error:', e)
    }
    setLoading(false)
  }, [apiBase, filterStatus, filterAssignee, filterProject])

  useEffect(() => { fetchData() }, [fetchData])

  // =========================================================================
  // Task CRUD handlers
  // =========================================================================

  const handleCreate = async () => {
    if (!newTitle) return
    try {
      const resp = await fetch(`${apiBase}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          description: newDescription,
          assignee: newAssignee || undefined,
          project: newProject || undefined,
          priority: newPriority,
          due_date: newDueDate || undefined,
          tags: newTags ? newTags.split(',').map(s => s.trim()).filter(Boolean) : [],
          labels: newLabels.length > 0 ? newLabels : undefined,
        }),
      })
      if (resp.ok) {
        setShowCreate(false)
        setNewTitle('')
        setNewDescription('')
        setNewAssignee('')
        setNewProject('')
        setNewPriority('medium')
        setNewDueDate('')
        setNewTags('')
        setNewLabels([])
        fetchData()
      }
    } catch (e) {
      console.error('Create task error:', e)
    }
  }

  const handleQuickAdd = async (status: string) => {
    if (!quickAddValue.trim()) return
    try {
      const resp = await fetch(`${apiBase}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: quickAddValue.trim(),
          status,
          priority: 'medium',
        }),
      })
      if (resp.ok) {
        setQuickAddValue('')
        setQuickAddColumn(null)
        fetchData()
      }
    } catch (e) {
      console.error('Quick add error:', e)
    }
  }

  const handleStatusChange = async (taskId: string, status: string) => {
    try {
      await fetch(`${apiBase}/${taskId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      fetchData()
      if (selectedTask?.task_id === taskId) {
        setSelectedTask({ ...selectedTask, status })
      }
    } catch (e) {
      console.error('Status change error:', e)
    }
  }

  const handleUpdateTask = async (taskId: string, updates: Partial<Task>) => {
    try {
      const resp = await fetch(`${apiBase}/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (resp.ok) {
        if (selectedTask?.task_id === taskId) {
          setSelectedTask({ ...selectedTask, ...updates })
        }
        fetchData()
      }
    } catch (e) {
      console.error('Update task error:', e)
    }
  }

  const handleDelete = async (taskId: string) => {
    try {
      await fetch(`${apiBase}/${taskId}`, { method: 'DELETE' })
      if (selectedTask?.task_id === taskId) setSelectedTask(null)
      fetchData()
    } catch (e) {
      console.error('Delete task error:', e)
    }
  }

  const handleAddComment = async () => {
    if (!selectedTask || !newComment) return
    try {
      const resp = await fetch(`${apiBase}/${selectedTask.task_id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: newComment }),
      })
      if (resp.ok) {
        setNewComment('')
        const detail = await fetch(`${apiBase}/${selectedTask.task_id}`).then(r => r.ok ? r.json() : null).catch(() => null)
        if (detail?.data) setSelectedTask(detail.data)
      }
    } catch (e) {
      console.error('Add comment error:', e)
    }
  }

  const handleAddSubtask = async () => {
    if (!selectedTask || !newSubtaskTitle.trim()) return
    try {
      const resp = await fetch(`${apiBase}/${selectedTask.task_id}/subtasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newSubtaskTitle.trim() }),
      })
      if (resp.ok) {
        setNewSubtaskTitle('')
        const detail = await fetch(`${apiBase}/${selectedTask.task_id}`).then(r => r.ok ? r.json() : null).catch(() => null)
        if (detail?.data) setSelectedTask(detail.data)
      }
    } catch (e) {
      console.error('Add subtask error:', e)
    }
  }

  const handleToggleSubtask = async (subtaskId: string, completed: boolean) => {
    if (!selectedTask) return
    try {
      await fetch(`${apiBase}/${selectedTask.task_id}/subtasks/${subtaskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      })
      const updated = (selectedTask.subtasks || []).map(st =>
        st.id === subtaskId ? { ...st, completed } : st
      )
      setSelectedTask({ ...selectedTask, subtasks: updated })
    } catch (e) {
      console.error('Toggle subtask error:', e)
    }
  }

  const handleLinkItem = async (item: { id: string; title: string }) => {
    if (!selectedTask) return
    try {
      const resp = await fetch(`${apiBase}/${selectedTask.task_id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: linkType, id: item.id, title: item.title }),
      })
      if (resp.ok) {
        const newLink: LinkedItem = { type: linkType, id: item.id, title: item.title }
        setSelectedTask({
          ...selectedTask,
          linked_items: [...(selectedTask.linked_items || []), newLink],
        })
        setShowLinkPanel(false)
        setLinkSearchQuery('')
        setLinkSearchResults([])
      }
    } catch (e) {
      console.error('Link item error:', e)
    }
  }

  const handleUnlinkItem = async (linkId: string) => {
    if (!selectedTask) return
    try {
      await fetch(`${apiBase}/${selectedTask.task_id}/links/${linkId}`, { method: 'DELETE' })
      setSelectedTask({
        ...selectedTask,
        linked_items: (selectedTask.linked_items || []).filter(li => li.id !== linkId),
      })
    } catch (e) {
      console.error('Unlink item error:', e)
    }
  }

  const handleSearchLinkedItems = async (query: string) => {
    setLinkSearchQuery(query)
    if (!query.trim()) {
      setLinkSearchResults([])
      return
    }
    try {
      const endpoint = LINKED_TYPE_SEARCH_ENDPOINTS[linkType] || ''
      if (!endpoint) { setLinkSearchResults([]); return }
      const resp = await fetch(`${endpoint}?q=${encodeURIComponent(query)}`).then(r => r.ok ? r.json() : null).catch(() => null)
      if (resp?.data) {
        const items = Array.isArray(resp.data) ? resp.data : (resp.data.items || resp.data.results || [])
        setLinkSearchResults(items.slice(0, 10).map((it: any) => ({
          id: it.id || it.conversation_id || it.member_id || it.event_id || it.message_id || it.document_id || '',
          title: it.title || it.name || it.subject || it.display_name || '',
        })))
      } else {
        setLinkSearchResults([])
      }
    } catch (e) {
      console.error('Link search error:', e)
      setLinkSearchResults([])
    }
  }

  const openTaskDetail = async (taskId: string) => {
    try {
      const detail = await fetch(`${apiBase}/${taskId}`).then(r => r.ok ? r.json() : null).catch(() => null)
      if (detail?.data) {
        setSelectedTask(detail.data)
        setEditingTitle(false)
        setEditingDescription(false)
        setEditingAssignee(false)
        setEditingDueDate(false)
        setEditingPriority(false)
        setEditingProject(false)
        setShowLabelPicker(false)
        setShowLinkPanel(false)
        setEditTimeEstimate(false)
        setEditTimeLogged(false)
      }
    } catch (e) {
      console.error('Fetch task detail error:', e)
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch { return iso }
  }

  const isOverdue = (dueDateStr: string | undefined): boolean => {
    if (!dueDateStr) return false
    try {
      const due = new Date(dueDateStr)
      due.setHours(23, 59, 59, 999)
      return due < new Date()
    } catch { return false }
  }

  const getInitials = (name: string) => {
    if (!name) return '?'
    return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
  }

  const getSubtaskProgress = (subtasks: Subtask[] | undefined): { done: number; total: number } => {
    if (!subtasks || subtasks.length === 0) return { done: 0, total: 0 }
    return { done: subtasks.filter(s => s.completed).length, total: subtasks.length }
  }

  const sortedTasks = [...tasks].sort((a, b) => {
    let aVal: any = (a as any)[sortField] || ''
    let bVal: any = (b as any)[sortField] || ''
    if (sortField === 'priority') {
      const order: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
      aVal = order[aVal] ?? 99
      bVal = order[bVal] ?? 99
    }
    if (sortField === 'subtasks') {
      const pa = getSubtaskProgress(a.subtasks)
      const pb = getSubtaskProgress(b.subtasks)
      aVal = pa.total > 0 ? pa.done / pa.total : -1
      bVal = pb.total > 0 ? pb.done / pb.total : -1
    }
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
    return sortAsc ? cmp : -cmp
  })

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(true)
    }
  }

  const toggleColumnCollapse = (status: string) => {
    setCollapsedColumns(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const toggleCreateLabel = (label: TaskLabel) => {
    setNewLabels(prev => {
      const exists = prev.some(l => l.name === label.name)
      if (exists) return prev.filter(l => l.name !== label.name)
      return [...prev, label]
    })
  }

  const toggleDetailLabel = (label: TaskLabel) => {
    if (!selectedTask) return
    const current = selectedTask.labels || []
    const exists = current.some(l => l.name === label.name)
    const updated = exists ? current.filter(l => l.name !== label.name) : [...current, label]
    handleUpdateTask(selectedTask.task_id, { labels: updated })
    setSelectedTask({ ...selectedTask, labels: updated })
  }

  // =========================================================================
  // Drag-and-drop handlers
  // =========================================================================

  const onDragStart = (e: React.DragEvent, taskId: string) => {
    setDragTaskId(taskId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', taskId)
  }

  const onDragOver = (e: React.DragEvent, status: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverColumn !== status) setDragOverColumn(status)
  }

  const onDragLeave = (e: React.DragEvent, status: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      if (dragOverColumn === status) setDragOverColumn(null)
    }
  }

  const onDrop = (e: React.DragEvent, status: string) => {
    e.preventDefault()
    setDragOverColumn(null)
    const taskId = dragTaskId || e.dataTransfer.getData('text/plain')
    if (taskId) {
      handleStatusChange(taskId, status)
    }
    setDragTaskId(null)
  }

  const onDragEnd = () => {
    setDragTaskId(null)
    setDragOverColumn(null)
  }

  // =========================================================================
  // Quick-add focus management
  // =========================================================================

  useEffect(() => {
    if (quickAddColumn && quickAddRef.current) {
      quickAddRef.current.focus()
    }
  }, [quickAddColumn])

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [editingTitle])

  // =========================================================================
  // Shared styles
  // =========================================================================

  const inputStyle: React.CSSProperties = {
    padding: '8px 12px', borderRadius: 'var(--radius, 6px)', border: '1px solid var(--border)',
    background: 'var(--bg-deep)', color: 'var(--text-primary)', width: '100%', boxSizing: 'border-box',
    fontSize: '0.8rem', outline: 'none',
  }

  const btnStyle: React.CSSProperties = {
    padding: '6px 14px', borderRadius: 'var(--radius, 6px)', border: 'none',
    background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
    fontSize: '0.8rem', fontWeight: 600,
  }

  const btnSecondary: React.CSSProperties = {
    ...btnStyle, background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text-muted)',
  }

  const btnDanger: React.CSSProperties = {
    ...btnStyle, background: 'transparent', border: '1px solid #f38ba8',
    color: '#f38ba8',
  }

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4,
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px',
  }

  // =========================================================================
  // Sub-renders
  // =========================================================================

  const renderLabelPills = (labels: TaskLabel[] | undefined, small?: boolean) => {
    if (!labels || labels.length === 0) return null
    return (
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {labels.map(l => (
          <span key={l.name} style={{
            padding: small ? '1px 5px' : '2px 8px',
            borderRadius: 3,
            fontSize: small ? '0.55rem' : '0.65rem',
            fontWeight: 600,
            background: `${l.color}22`,
            color: l.color,
            lineHeight: 1.4,
          }}>
            {l.name}
          </span>
        ))}
      </div>
    )
  }

  const renderSubtaskBar = (subtasks: Subtask[] | undefined, compact?: boolean) => {
    const { done, total } = getSubtaskProgress(subtasks)
    if (total === 0) return null
    const pct = Math.round((done / total) * 100)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{
          flex: 1, height: compact ? 3 : 4, borderRadius: 2,
          background: 'var(--border)', overflow: 'hidden', minWidth: compact ? 30 : 50,
        }}>
          <div style={{
            height: '100%', borderRadius: 2,
            background: pct === 100 ? '#a6e3a1' : 'var(--accent-primary)',
            width: `${pct}%`, transition: 'width 0.2s ease',
          }} />
        </div>
        <span style={{ fontSize: compact ? '0.55rem' : '0.65rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {done}/{total}
        </span>
      </div>
    )
  }

  const renderLinkedIcons = (items: LinkedItem[] | undefined) => {
    if (!items || items.length === 0) return null
    const grouped: Record<string, number> = {}
    for (const it of items) {
      grouped[it.type] = (grouped[it.type] || 0) + 1
    }
    return (
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        {Object.entries(grouped).map(([type, count]) => (
          <span key={type} style={{ fontSize: '0.6rem', opacity: 0.8 }} title={`${count} ${type}(s)`}>
            {LINKED_ITEM_ICONS[type] || '?'}{count > 1 ? count : ''}
          </span>
        ))}
      </div>
    )
  }

  // =========================================================================
  // Task card (board view)
  // =========================================================================

  const renderTaskCard = (task: Task) => {
    const overdue = isOverdue(task.due_date)
    const commentCount = (task.comments || []).length
    const { done: subDone, total: subTotal } = getSubtaskProgress(task.subtasks)

    return (
      <div
        key={task.task_id}
        draggable
        onDragStart={(e) => onDragStart(e, task.task_id)}
        onDragEnd={onDragEnd}
        onClick={() => openTaskDetail(task.task_id)}
        style={{
          padding: '10px 12px', borderRadius: 'var(--radius, 6px)',
          background: 'var(--bg-deep)',
          border: `1px solid ${dragTaskId === task.task_id ? 'var(--accent-primary)' : 'var(--border)'}`,
          cursor: 'grab', fontSize: '0.8rem',
          opacity: dragTaskId === task.task_id ? 0.5 : 1,
          transition: 'opacity 0.15s ease, border-color 0.15s ease',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}
      >
        {renderLabelPills(task.labels, true)}

        <div style={{ fontWeight: 600, lineHeight: 1.3 }}>{task.title}</div>

        {subTotal > 0 && renderSubtaskBar(task.subtasks, true)}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: PRIORITY_COLORS[task.priority] || '#6c7086',
              display: 'inline-block', flexShrink: 0,
            }} />
            {task.assignee && (
              <span style={{
                width: 22, height: 22, borderRadius: '50%',
                background: task.assignee_avatar ? 'transparent' : 'var(--accent-primary)',
                color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.55rem', fontWeight: 600, flexShrink: 0,
                backgroundImage: task.assignee_avatar ? `url(${task.assignee_avatar})` : undefined,
                backgroundSize: 'cover',
              }}>
                {task.assignee_avatar ? '' : getInitials(task.assignee)}
              </span>
            )}
            {renderLinkedIcons(task.linked_items)}
            {commentCount > 0 && (
              <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 2 }}>
                {'\u{1F4AC}'}{commentCount}
              </span>
            )}
          </div>
          {task.due_date && (
            <span style={{
              fontSize: '0.65rem',
              color: overdue ? '#f38ba8' : 'var(--text-muted)',
              fontWeight: overdue ? 600 : 400,
            }}>
              {formatDate(task.due_date)}
            </span>
          )}
        </div>
      </div>
    )
  }

  // =========================================================================
  // Board view
  // =========================================================================

  const renderBoard = () => (
    <div style={{
      display: 'flex', gap: 12, minHeight: 400,
      overflowX: 'auto', paddingBottom: 8,
    }}>
      {STATUSES.map(status => {
        const columnTasks: Task[] = (board as any)[status] || []
        const collapsed = collapsedColumns.has(status)
        const isDragTarget = dragOverColumn === status

        return (
          <div
            key={status}
            onDragOver={(e) => onDragOver(e, status)}
            onDragLeave={(e) => onDragLeave(e, status)}
            onDrop={(e) => onDrop(e, status)}
            style={{
              minWidth: 280, flex: '0 0 280px',
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius, 8px)',
              border: `2px solid ${isDragTarget ? 'var(--accent-primary)' : 'var(--border)'}`,
              padding: 10, display: 'flex', flexDirection: 'column',
              transition: 'border-color 0.15s ease, background 0.15s ease',
              ...(isDragTarget ? { background: 'color-mix(in srgb, var(--bg-elevated) 90%, var(--accent-primary) 10%)' } : {}),
            }}
          >
            {/* Column header */}
            <div style={{
              fontSize: '0.8rem', fontWeight: 600, marginBottom: 10,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleColumnCollapse(status)}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: STATUS_COLORS[status], display: 'inline-block',
                }} />
                {STATUS_LABELS[status]}
                <span style={{
                  fontSize: '0.65rem', color: 'var(--text-muted)',
                  background: 'var(--bg-deep)', borderRadius: 10,
                  padding: '1px 7px', fontWeight: 500,
                }}>
                  {columnTasks.length}
                </span>
                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>
                  {'\u25BC'}
                </span>
              </span>
            </div>

            {/* Column body */}
            {!collapsed && (
              <>
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: 6,
                  flex: 1, overflowY: 'auto', minHeight: 60,
                }}>
                  {columnTasks.map(task => renderTaskCard(task))}
                  {columnTasks.length === 0 && !isDragTarget && (
                    <div style={{
                      padding: '1.5rem 0.5rem', textAlign: 'center',
                      color: 'var(--text-muted)', fontSize: '0.7rem', opacity: 0.6,
                    }}>
                      No tasks
                    </div>
                  )}
                </div>

                {/* Quick-add */}
                {quickAddColumn === status ? (
                  <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
                    <input
                      ref={quickAddRef}
                      value={quickAddValue}
                      onChange={e => setQuickAddValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleQuickAdd(status)
                        if (e.key === 'Escape') { setQuickAddColumn(null); setQuickAddValue('') }
                      }}
                      placeholder="Task title..."
                      style={{ ...inputStyle, flex: 1, padding: '6px 8px', fontSize: '0.75rem' }}
                    />
                    <button
                      onClick={() => handleQuickAdd(status)}
                      style={{ ...btnStyle, padding: '6px 10px', fontSize: '0.75rem' }}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setQuickAddColumn(status); setQuickAddValue('') }}
                    style={{
                      marginTop: 8, padding: '5px 0', borderRadius: 'var(--radius, 6px)',
                      border: '1px dashed var(--border)', background: 'transparent',
                      color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem',
                      width: '100%', textAlign: 'center',
                      transition: 'border-color 0.15s ease, color 0.15s ease',
                    }}
                    onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = 'var(--accent-primary)'; (e.target as HTMLElement).style.color = 'var(--text-primary)' }}
                    onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = 'var(--border)'; (e.target as HTMLElement).style.color = 'var(--text-muted)' }}
                  >
                    + Add task
                  </button>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )

  // =========================================================================
  // List view
  // =========================================================================

  const renderList = () => {
    const columns = [
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status' },
      { key: 'assignee', label: 'Assignee' },
      { key: 'priority', label: 'Priority' },
      { key: 'labels', label: 'Labels' },
      { key: 'subtasks', label: 'Subtasks' },
      { key: 'due_date', label: 'Due Date' },
    ]

    return (
      <div style={{ borderRadius: 'var(--radius, 8px)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)' }}>
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  style={{
                    padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                    color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)',
                    userSelect: 'none', fontSize: '0.75rem', whiteSpace: 'nowrap',
                  }}
                >
                  {col.label} {sortField === col.key ? (sortAsc ? '\u25B2' : '\u25BC') : ''}
                </th>
              ))}
              <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {sortedTasks.map(task => {
              const overdue = isOverdue(task.due_date)
              return (
                <tr
                  key={task.task_id}
                  onClick={() => openTaskDetail(task.task_id)}
                  style={{
                    cursor: 'pointer', borderBottom: '1px solid var(--border)',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                    <div>{task.title}</div>
                    {renderLinkedIcons(task.linked_items)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem',
                      background: `${STATUS_COLORS[task.status] || '#6c7086'}22`,
                      color: STATUS_COLORS[task.status] || '#6c7086',
                    }}>
                      {STATUS_LABELS[task.status] || task.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {task.assignee ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          width: 20, height: 20, borderRadius: '50%',
                          background: 'var(--accent-primary)', color: '#fff',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.55rem', fontWeight: 600, flexShrink: 0,
                        }}>
                          {getInitials(task.assignee)}
                        </span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{task.assignee}</span>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>--</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: PRIORITY_COLORS[task.priority] || '#6c7086',
                        display: 'inline-block',
                      }} />
                      <span style={{ textTransform: 'capitalize' }}>{task.priority}</span>
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {renderLabelPills(task.labels, true) || <span style={{ color: 'var(--text-muted)' }}>--</span>}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {(task.subtasks && task.subtasks.length > 0)
                      ? renderSubtaskBar(task.subtasks, true)
                      : <span style={{ color: 'var(--text-muted)' }}>--</span>
                    }
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {task.due_date ? (
                      <span style={{ color: overdue ? '#f38ba8' : 'var(--text-muted)', fontWeight: overdue ? 600 : 400 }}>
                        {formatDate(task.due_date)}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>--</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(task.task_id) }}
                      style={{
                        padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)',
                        background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                        fontSize: '0.65rem',
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              )
            })}
            {sortedTasks.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No tasks found. Create your first task above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    )
  }

  // =========================================================================
  // Detail slide-out panel
  // =========================================================================

  const renderDetailPanel = () => {
    if (!selectedTask) return null

    const overdue = isOverdue(selectedTask.due_date)
    const { done: subDone, total: subTotal } = getSubtaskProgress(selectedTask.subtasks)
    const subPct = subTotal > 0 ? Math.round((subDone / subTotal) * 100) : 0
    const timeEstimate = selectedTask.time_estimate || 0
    const timeLogged = selectedTask.time_logged || 0
    const timePct = timeEstimate > 0 ? Math.min(100, Math.round((timeLogged / timeEstimate) * 100)) : 0

    return (
      <>
        {/* Backdrop */}
        <div
          onClick={() => setSelectedTask(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 200,
            backdropFilter: 'blur(2px)',
          }}
        />

        {/* Panel */}
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
          maxWidth: '100vw',
          background: 'var(--bg-deep)', borderLeft: '1px solid var(--glass-border, var(--border))',
          overflowY: 'auto', zIndex: 201,
          boxShadow: '-8px 0 30px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
          }}>
            <div style={{ flex: 1 }}>
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  value={editTitleValue}
                  onChange={e => setEditTitleValue(e.target.value)}
                  onBlur={() => {
                    if (editTitleValue.trim() && editTitleValue !== selectedTask.title) {
                      handleUpdateTask(selectedTask.task_id, { title: editTitleValue.trim() })
                    }
                    setEditingTitle(false)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') (e.target as HTMLElement).blur()
                    if (e.key === 'Escape') { setEditTitleValue(selectedTask.title); setEditingTitle(false) }
                  }}
                  style={{ ...inputStyle, fontSize: '1.1rem', fontWeight: 700, padding: '4px 8px' }}
                />
              ) : (
                <h3
                  onClick={() => { setEditTitleValue(selectedTask.title); setEditingTitle(true) }}
                  style={{
                    margin: 0, fontSize: '1.1rem', cursor: 'text', lineHeight: 1.3,
                    padding: '4px 0',
                  }}
                  title="Click to edit"
                >
                  {selectedTask.title}
                </h3>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => handleDelete(selectedTask.task_id)} style={{ ...btnDanger, padding: '4px 10px', fontSize: '0.7rem' }}>
                Delete
              </button>
              <button
                onClick={() => setSelectedTask(null)}
                style={{ ...btnSecondary, padding: '4px 10px', fontSize: '0.7rem' }}
              >
                Close
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
            {/* Status pills */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={sectionLabelStyle}>Status</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {STATUSES.map(s => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(selectedTask.task_id, s)}
                    style={{
                      padding: '5px 12px', borderRadius: 'var(--radius, 4px)', fontSize: '0.75rem',
                      cursor: 'pointer', fontWeight: 500,
                      border: selectedTask.status === s ? 'none' : '1px solid var(--border)',
                      background: selectedTask.status === s ? STATUS_COLORS[s] : 'transparent',
                      color: selectedTask.status === s ? '#1e1e2e' : 'var(--text-muted)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* Properties grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: '1.25rem' }}>
              {/* Assignee */}
              <div>
                <div style={sectionLabelStyle}>Assignee</div>
                {editingAssignee ? (
                  <input
                    value={editAssigneeValue}
                    onChange={e => setEditAssigneeValue(e.target.value)}
                    autoFocus
                    onBlur={() => {
                      handleUpdateTask(selectedTask.task_id, { assignee: editAssigneeValue || undefined })
                      setEditingAssignee(false)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLElement).blur()
                      if (e.key === 'Escape') setEditingAssignee(false)
                    }}
                    style={{ ...inputStyle, padding: '4px 8px', fontSize: '0.85rem' }}
                  />
                ) : (
                  <div
                    onClick={() => { setEditAssigneeValue(selectedTask.assignee || ''); setEditingAssignee(true) }}
                    style={{
                      fontSize: '0.85rem', cursor: 'pointer', padding: '4px 0',
                      display: 'flex', alignItems: 'center', gap: 6,
                      color: selectedTask.assignee ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                    title="Click to edit"
                  >
                    {selectedTask.assignee ? (
                      <>
                        <span style={{
                          width: 22, height: 22, borderRadius: '50%',
                          background: 'var(--accent-primary)', color: '#fff',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.55rem', fontWeight: 600,
                        }}>
                          {getInitials(selectedTask.assignee)}
                        </span>
                        {selectedTask.assignee}
                      </>
                    ) : 'Unassigned'}
                  </div>
                )}
              </div>

              {/* Priority */}
              <div>
                <div style={sectionLabelStyle}>Priority</div>
                {editingPriority ? (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {PRIORITIES.map(p => (
                      <button
                        key={p}
                        onClick={() => {
                          handleUpdateTask(selectedTask.task_id, { priority: p })
                          setEditingPriority(false)
                        }}
                        style={{
                          padding: '3px 10px', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer',
                          border: selectedTask.priority === p ? 'none' : '1px solid var(--border)',
                          background: selectedTask.priority === p ? PRIORITY_COLORS[p] : 'transparent',
                          color: selectedTask.priority === p ? '#1e1e2e' : 'var(--text-muted)',
                          textTransform: 'capitalize',
                        }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div
                    onClick={() => setEditingPriority(true)}
                    style={{
                      fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6,
                      cursor: 'pointer', padding: '4px 0', textTransform: 'capitalize',
                    }}
                    title="Click to edit"
                  >
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: PRIORITY_COLORS[selectedTask.priority] || '#6c7086',
                      display: 'inline-block',
                    }} />
                    {selectedTask.priority}
                  </div>
                )}
              </div>

              {/* Due Date */}
              <div>
                <div style={sectionLabelStyle}>Due Date</div>
                {editingDueDate ? (
                  <input
                    type="date"
                    value={editDueDateValue}
                    onChange={e => setEditDueDateValue(e.target.value)}
                    autoFocus
                    onBlur={() => {
                      handleUpdateTask(selectedTask.task_id, { due_date: editDueDateValue || undefined })
                      setEditingDueDate(false)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLElement).blur()
                      if (e.key === 'Escape') setEditingDueDate(false)
                    }}
                    style={{ ...inputStyle, padding: '4px 8px', fontSize: '0.85rem' }}
                  />
                ) : (
                  <div
                    onClick={() => { setEditDueDateValue(selectedTask.due_date || ''); setEditingDueDate(true) }}
                    style={{
                      fontSize: '0.85rem', cursor: 'pointer', padding: '4px 0',
                      color: overdue ? '#f38ba8' : selectedTask.due_date ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontWeight: overdue ? 600 : 400,
                    }}
                    title="Click to edit"
                  >
                    {selectedTask.due_date ? formatDate(selectedTask.due_date) : 'No due date'}
                    {overdue && ' (overdue)'}
                  </div>
                )}
              </div>

              {/* Project */}
              <div>
                <div style={sectionLabelStyle}>Project</div>
                {editingProject ? (
                  <select
                    value={editProjectValue}
                    onChange={e => {
                      handleUpdateTask(selectedTask.task_id, { project: e.target.value || undefined })
                      setEditingProject(false)
                    }}
                    autoFocus
                    onBlur={() => setEditingProject(false)}
                    style={{ ...inputStyle, padding: '4px 8px', fontSize: '0.85rem' }}
                  >
                    <option value="">None</option>
                    {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                  </select>
                ) : (
                  <div
                    onClick={() => { setEditProjectValue(selectedTask.project || ''); setEditingProject(true) }}
                    style={{
                      fontSize: '0.85rem', cursor: 'pointer', padding: '4px 0',
                      color: selectedTask.project ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                    title="Click to edit"
                  >
                    {selectedTask.project || 'None'}
                  </div>
                )}
              </div>
            </div>

            {/* Labels */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ ...sectionLabelStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Labels</span>
                <button
                  onClick={() => setShowLabelPicker(!showLabelPicker)}
                  style={{
                    background: 'none', border: 'none', color: 'var(--accent-primary)',
                    cursor: 'pointer', fontSize: '0.65rem', fontWeight: 600, padding: 0,
                  }}
                >
                  {showLabelPicker ? 'Done' : '+ Add'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                {(selectedTask.labels || []).map(l => (
                  <span key={l.name} style={{
                    padding: '3px 10px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
                    background: `${l.color}22`, color: l.color,
                  }}>
                    {l.name}
                  </span>
                ))}
                {(!selectedTask.labels || selectedTask.labels.length === 0) && !showLabelPicker && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No labels</span>
                )}
              </div>
              {showLabelPicker && (
                <div style={{
                  marginTop: 8, padding: 10, borderRadius: 'var(--radius, 6px)',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  display: 'flex', gap: 4, flexWrap: 'wrap',
                }}>
                  {LABEL_PRESETS.map(lp => {
                    const active = (selectedTask.labels || []).some(l => l.name === lp.name)
                    return (
                      <button
                        key={lp.name}
                        onClick={() => toggleDetailLabel(lp)}
                        style={{
                          padding: '4px 10px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
                          cursor: 'pointer',
                          background: active ? `${lp.color}33` : 'transparent',
                          color: lp.color,
                          border: active ? `1px solid ${lp.color}` : '1px solid var(--border)',
                          transition: 'all 0.1s ease',
                        }}
                      >
                        {active ? '\u2713 ' : ''}{lp.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Description */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={sectionLabelStyle}>Description</div>
              {editingDescription ? (
                <div>
                  <textarea
                    value={editDescValue}
                    onChange={e => setEditDescValue(e.target.value)}
                    autoFocus
                    rows={4}
                    style={{ ...inputStyle, resize: 'vertical' }}
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setEditDescValue(selectedTask.description || ''); setEditingDescription(false) }
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                    <button onClick={() => setEditingDescription(false)} style={{ ...btnSecondary, padding: '4px 10px', fontSize: '0.7rem' }}>Cancel</button>
                    <button
                      onClick={() => {
                        handleUpdateTask(selectedTask.task_id, { description: editDescValue })
                        setEditingDescription(false)
                      }}
                      style={{ ...btnStyle, padding: '4px 10px', fontSize: '0.7rem' }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => { setEditDescValue(selectedTask.description || ''); setEditingDescription(true) }}
                  style={{
                    padding: '8px 12px', borderRadius: 'var(--radius, 6px)', background: 'var(--bg-elevated)',
                    fontSize: '0.85rem', lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    cursor: 'text', minHeight: 40,
                    color: selectedTask.description ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                  title="Click to edit"
                >
                  {selectedTask.description || 'Click to add a description...'}
                </div>
              )}
            </div>

            {/* Subtasks / Checklist */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={sectionLabelStyle}>
                Subtasks
                {subTotal > 0 && (
                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>
                    {subDone}/{subTotal} ({subPct}%)
                  </span>
                )}
              </div>
              {subTotal > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 3,
                      background: subPct === 100 ? '#a6e3a1' : 'var(--accent-primary)',
                      width: `${subPct}%`, transition: 'width 0.2s ease',
                    }} />
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(selectedTask.subtasks || []).map(st => (
                  <div key={st.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 'var(--radius, 4px)',
                    background: 'var(--bg-elevated)',
                    fontSize: '0.8rem',
                  }}>
                    <input
                      type="checkbox"
                      checked={st.completed}
                      onChange={() => handleToggleSubtask(st.id, !st.completed)}
                      style={{ cursor: 'pointer', accentColor: 'var(--accent-primary)' }}
                    />
                    <span style={{
                      flex: 1,
                      textDecoration: st.completed ? 'line-through' : 'none',
                      color: st.completed ? 'var(--text-muted)' : 'var(--text-primary)',
                    }}>
                      {st.title}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
                <input
                  value={newSubtaskTitle}
                  onChange={e => setNewSubtaskTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddSubtask() }}
                  placeholder="Add subtask..."
                  style={{ ...inputStyle, flex: 1, padding: '6px 8px', fontSize: '0.75rem' }}
                />
                <button
                  onClick={handleAddSubtask}
                  style={{ ...btnStyle, padding: '6px 10px', fontSize: '0.75rem' }}
                >
                  +
                </button>
              </div>
            </div>

            {/* Time tracking */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={sectionLabelStyle}>Time Tracking</div>
              <div style={{
                padding: '10px 12px', borderRadius: 'var(--radius, 6px)',
                background: 'var(--bg-elevated)', fontSize: '0.8rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Estimate: </span>
                    {editTimeEstimate ? (
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={timeEstimateValue}
                        onChange={e => setTimeEstimateValue(e.target.value)}
                        autoFocus
                        onBlur={() => {
                          const val = parseFloat(timeEstimateValue)
                          if (!isNaN(val) && val >= 0) {
                            handleUpdateTask(selectedTask.task_id, { time_estimate: val })
                          }
                          setEditTimeEstimate(false)
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); if (e.key === 'Escape') setEditTimeEstimate(false) }}
                        style={{ ...inputStyle, width: 60, padding: '2px 6px', fontSize: '0.75rem', display: 'inline-block' }}
                      />
                    ) : (
                      <span
                        onClick={() => { setTimeEstimateValue(String(timeEstimate || '')); setEditTimeEstimate(true) }}
                        style={{ cursor: 'pointer', fontWeight: 500 }}
                        title="Click to edit"
                      >
                        {timeEstimate > 0 ? `${timeEstimate}h` : '--'}
                      </span>
                    )}
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Logged: </span>
                    {editTimeLogged ? (
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={timeLoggedValue}
                        onChange={e => setTimeLoggedValue(e.target.value)}
                        autoFocus
                        onBlur={() => {
                          const val = parseFloat(timeLoggedValue)
                          if (!isNaN(val) && val >= 0) {
                            handleUpdateTask(selectedTask.task_id, { time_logged: val })
                          }
                          setEditTimeLogged(false)
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); if (e.key === 'Escape') setEditTimeLogged(false) }}
                        style={{ ...inputStyle, width: 60, padding: '2px 6px', fontSize: '0.75rem', display: 'inline-block' }}
                      />
                    ) : (
                      <span
                        onClick={() => { setTimeLoggedValue(String(timeLogged || '')); setEditTimeLogged(true) }}
                        style={{ cursor: 'pointer', fontWeight: 500 }}
                        title="Click to edit"
                      >
                        {timeLogged > 0 ? `${timeLogged}h` : '--'}
                      </span>
                    )}
                  </div>
                </div>
                {timeEstimate > 0 && (
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 3,
                      background: timePct > 100 ? '#f38ba8' : timePct === 100 ? '#a6e3a1' : '#89b4fa',
                      width: `${Math.min(timePct, 100)}%`, transition: 'width 0.2s ease',
                    }} />
                  </div>
                )}
                {timeEstimate > 0 && timeLogged > 0 && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
                    {timePct}% of estimate
                  </div>
                )}
              </div>
            </div>

            {/* Linked Items */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ ...sectionLabelStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Linked Items</span>
                <button
                  onClick={() => { setShowLinkPanel(!showLinkPanel); setLinkSearchQuery(''); setLinkSearchResults([]) }}
                  style={{
                    background: 'none', border: 'none', color: 'var(--accent-primary)',
                    cursor: 'pointer', fontSize: '0.65rem', fontWeight: 600, padding: 0,
                  }}
                >
                  {showLinkPanel ? 'Cancel' : '+ Link'}
                </button>
              </div>

              {(selectedTask.linked_items || []).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(selectedTask.linked_items || []).map(li => (
                    <div key={li.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', borderRadius: 'var(--radius, 4px)',
                      background: 'var(--bg-elevated)', fontSize: '0.8rem',
                    }}>
                      <span style={{ fontSize: '0.85rem' }}>{LINKED_ITEM_ICONS[li.type] || '?'}</span>
                      <span style={{ flex: 1, color: 'var(--text-primary)' }}>{li.title}</span>
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{li.type}</span>
                      <button
                        onClick={() => handleUnlinkItem(li.id)}
                        style={{
                          background: 'none', border: 'none', color: 'var(--text-muted)',
                          cursor: 'pointer', fontSize: '0.7rem', padding: '2px 4px',
                        }}
                        title="Unlink"
                      >
                        {'\u2715'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : !showLinkPanel ? (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No linked items</div>
              ) : null}

              {showLinkPanel && (
                <div style={{
                  marginTop: 8, padding: 12, borderRadius: 'var(--radius, 6px)',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                }}>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                      {LINKED_ITEM_TYPES.map(t => (
                        <button
                          key={t}
                          onClick={() => { setLinkType(t); setLinkSearchQuery(''); setLinkSearchResults([]) }}
                          style={{
                            padding: '3px 8px', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer',
                            border: linkType === t ? 'none' : '1px solid var(--border)',
                            background: linkType === t ? 'var(--accent-primary)' : 'transparent',
                            color: linkType === t ? '#fff' : 'var(--text-muted)',
                            textTransform: 'capitalize',
                          }}
                        >
                          {LINKED_ITEM_ICONS[t]} {t}
                        </button>
                      ))}
                    </div>
                    <input
                      value={linkSearchQuery}
                      onChange={e => handleSearchLinkedItems(e.target.value)}
                      placeholder={`Search ${linkType}s...`}
                      style={{ ...inputStyle, padding: '6px 8px', fontSize: '0.75rem' }}
                    />
                  </div>
                  {linkSearchResults.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 150, overflowY: 'auto' }}>
                      {linkSearchResults.map(r => (
                        <button
                          key={r.id}
                          onClick={() => handleLinkItem(r)}
                          style={{
                            padding: '6px 8px', borderRadius: 4, border: 'none',
                            background: 'var(--bg-deep)', color: 'var(--text-primary)',
                            cursor: 'pointer', fontSize: '0.75rem', textAlign: 'left',
                            width: '100%',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface, var(--bg-deep))')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-deep)')}
                        >
                          {LINKED_ITEM_ICONS[linkType]} {r.title || r.id}
                        </button>
                      ))}
                    </div>
                  )}
                  {linkSearchQuery && linkSearchResults.length === 0 && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', padding: '8px 0', textAlign: 'center' }}>
                      No results found
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tags */}
            {selectedTask.tags && selectedTask.tags.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={sectionLabelStyle}>Tags</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {selectedTask.tags.map(tag => (
                    <span key={tag} style={{
                      padding: '3px 8px', borderRadius: 4, fontSize: '0.7rem',
                      background: 'var(--bg-elevated)', color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                    }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Comments */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem', marginBottom: '1.25rem' }}>
              <div style={sectionLabelStyle}>
                Comments
                {(selectedTask.comments || []).length > 0 && (
                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6 }}>
                    ({(selectedTask.comments || []).length})
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {(selectedTask.comments || []).map(c => (
                  <div key={c.comment_id} style={{
                    padding: '10px 12px', borderRadius: 'var(--radius, 6px)',
                    background: 'var(--bg-elevated)', fontSize: '0.8rem',
                  }}>
                    <div style={{
                      fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4,
                      display: 'flex', justifyContent: 'space-between',
                    }}>
                      <span style={{ fontWeight: 600 }}>{c.author || 'Unknown'}</span>
                      <span>{formatDate(c.created_at)}</span>
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{c.comment}</div>
                  </div>
                ))}
                {(!selectedTask.comments || selectedTask.comments.length === 0) && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '4px 0' }}>No comments yet.</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  placeholder="Add a comment..."
                  onKeyDown={e => e.key === 'Enter' && handleAddComment()}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={handleAddComment} style={btnStyle}>Post</button>
              </div>
            </div>

            {/* Activity / metadata */}
            {(selectedTask.created_at || selectedTask.updated_at) && (
              <div style={{
                borderTop: '1px solid var(--border)', paddingTop: '1rem',
                fontSize: '0.65rem', color: 'var(--text-muted)',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                {selectedTask.created_at && (
                  <div>Created: {formatDate(selectedTask.created_at)}</div>
                )}
                {selectedTask.updated_at && (
                  <div>Updated: {formatDate(selectedTask.updated_at)}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  // =========================================================================
  // Main render
  // =========================================================================

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading tasks...
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Task Board</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['board', 'list'] as ViewMode[]).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: '6px 14px', borderRadius: 'var(--radius, 6px)',
                border: '1px solid var(--border)',
                background: view === v ? 'var(--accent-primary)' : 'transparent',
                color: view === v ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.8rem', textTransform: 'capitalize',
                fontWeight: view === v ? 600 : 400,
                transition: 'all 0.15s ease',
              }}
            >
              {v === 'board' ? '\u25A6 Board' : '\u2261 List'}
            </button>
          ))}
          <button onClick={() => setShowCreate(!showCreate)} style={btnStyle}>
            + New Task
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap',
        padding: '8px 12px', borderRadius: 'var(--radius, 6px)', background: 'var(--bg-elevated)',
        alignItems: 'center',
      }}>
        <select
          value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ ...inputStyle, width: 'auto', minWidth: 120 }}
        >
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <input
          value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}
          placeholder="Assignee..."
          style={{ ...inputStyle, width: 'auto', minWidth: 140 }}
        />
        <select
          value={filterProject} onChange={e => setFilterProject(e.target.value)}
          style={{ ...inputStyle, width: 'auto', minWidth: 140 }}
        >
          <option value="">All projects</option>
          {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        {stats.total != null && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {stats.total} task{stats.total !== 1 ? 's' : ''}
          </span>
        )}
        {stats.overdue_count != null && stats.overdue_count > 0 && (
          <span style={{
            padding: '4px 10px', borderRadius: 'var(--radius, 6px)', fontSize: '0.7rem',
            background: 'rgba(243,139,168,0.15)', color: '#f38ba8',
            fontWeight: 600,
          }}>
            {stats.overdue_count} overdue
          </span>
        )}
      </div>

      {/* Create task panel */}
      {showCreate && (
        <div style={{
          padding: '1.25rem', borderRadius: 'var(--radius, 8px)', background: 'var(--bg-elevated)',
          border: '1px solid var(--border)', marginBottom: '1rem',
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 12 }}>Create New Task</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <input
              value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="Task title"
              onKeyDown={e => { if (e.key === 'Enter' && newTitle) handleCreate() }}
              style={{ ...inputStyle, gridColumn: '1 / -1' }}
            />
            <textarea
              value={newDescription} onChange={e => setNewDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={3}
              style={{ ...inputStyle, gridColumn: '1 / -1', resize: 'vertical' }}
            />
            <input
              value={newAssignee} onChange={e => setNewAssignee(e.target.value)}
              placeholder="Assignee"
              style={inputStyle}
            />
            <select
              value={newProject} onChange={e => setNewProject(e.target.value)}
              style={inputStyle}
            >
              <option value="">No project</option>
              {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
            </select>
            <select
              value={newPriority} onChange={e => setNewPriority(e.target.value)}
              style={inputStyle}
            >
              {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
            <input
              type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)}
              style={inputStyle}
            />
            <input
              value={newTags} onChange={e => setNewTags(e.target.value)}
              placeholder="Tags (comma-separated)"
              style={{ ...inputStyle, gridColumn: '1 / -1' }}
            />
          </div>

          {/* Label picker in create form */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6 }}>Labels</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {LABEL_PRESETS.map(lp => {
                const active = newLabels.some(l => l.name === lp.name)
                return (
                  <button
                    key={lp.name}
                    onClick={() => toggleCreateLabel(lp)}
                    style={{
                      padding: '3px 10px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600,
                      cursor: 'pointer',
                      background: active ? `${lp.color}33` : 'transparent',
                      color: lp.color,
                      border: active ? `1px solid ${lp.color}` : '1px solid var(--border)',
                    }}
                  >
                    {active ? '\u2713 ' : ''}{lp.name}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowCreate(false)} style={btnSecondary}>Cancel</button>
            <button onClick={handleCreate} style={btnStyle}>Create Task</button>
          </div>
        </div>
      )}

      {/* View content */}
      {view === 'board' && renderBoard()}
      {view === 'list' && renderList()}

      {/* Detail panel overlay */}
      {renderDetailPanel()}
    </div>
  )
}
