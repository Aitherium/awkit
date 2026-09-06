'use client'

import { useState, useEffect, useCallback } from 'react'

/* ── Types ─────────────────────────────────────────────────────────── */

interface Task {
  id: string
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority?: 'low' | 'medium' | 'high'
  assigned_to?: string
  due_date?: string
  created_at?: string
  created_by?: string
}

export interface TasksPanelProps {
  apiBase?: string
}

/* ── Styles ────────────────────────────────────────────────────────── */

const sBtn = (active = false): React.CSSProperties => ({
  padding: '6px 14px',
  borderRadius: 6,
  border: active ? 'none' : '1px solid var(--border)',
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? '#fff' : 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: '0.8rem',
  fontWeight: active ? 600 : 400,
})

const sInput: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-deep)',
  color: 'var(--text)',
  width: '100%',
  boxSizing: 'border-box',
}

const sCard: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
}

/* ── Component ─────────────────────────────────────────────────────── */

export default function TasksPanel({ apiBase = '/api/tasks' }: TasksPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Task['status'] | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  // Create form state
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newStatus, setNewStatus] = useState<Task['status']>('pending')
  const [newPriority, setNewPriority] = useState<Task['priority']>('medium')
  const [newDueDate, setNewDueDate] = useState('')
  const [creating, setCreating] = useState(false)

  /* ── Data fetching ────────────────────────────────────────────── */

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('status', filter)
      if (searchQuery) params.set('search', searchQuery)
      const resp = await fetch(`${apiBase}?${params}`)
      if (resp.ok) {
        const data = await resp.json()
        const list: Task[] = data?.data?.tasks ?? data?.tasks ?? data?.items ?? []
        setTasks(list)
      }
    } catch (e) {
      console.error('Tasks fetch error:', e)
    }
    setLoading(false)
  }, [apiBase, filter, searchQuery])

  const createTask = useCallback(async () => {
    if (!newTitle.trim()) return

    setCreating(true)
    try {
      const resp = await fetch(`${apiBase}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          description: newDescription || undefined,
          status: newStatus,
          priority: newPriority,
          due_date: newDueDate || undefined,
        }),
      })

      if (resp.ok) {
        setNewTitle('')
        setNewDescription('')
        setNewStatus('pending')
        setNewPriority('medium')
        setNewDueDate('')
        setShowCreate(false)
        await fetchTasks()
      }
    } catch (e) {
      console.error('Task creation error:', e)
    }
    setCreating(false)
  }, [apiBase, newTitle, newDescription, newStatus, newPriority, newDueDate, fetchTasks])

  const updateTaskStatus = useCallback(
    async (id: string, status: Task['status']) => {
      try {
        const resp = await fetch(`${apiBase}/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        })
        if (resp.ok) {
          setTasks(tasks => tasks.map(t => (t.id === id ? { ...t, status } : t)))
          if (selectedTask?.id === id) {
            setSelectedTask({ ...selectedTask, status })
          }
        }
      } catch (e) {
        console.error('Task update error:', e)
      }
    },
    [apiBase, selectedTask]
  )

  const deleteTask = useCallback(
    async (id: string) => {
      if (!window.confirm('Delete this task?')) return
      try {
        const resp = await fetch(`${apiBase}/${id}`, { method: 'DELETE' })
        if (resp.ok) {
          setTasks(tasks => tasks.filter(t => t.id !== id))
          if (selectedTask?.id === id) {
            setSelectedTask(null)
          }
        }
      } catch (e) {
        console.error('Task deletion error:', e)
      }
    },
    [apiBase, selectedTask]
  )

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const filteredTasks = tasks.filter(t => {
    const matchesFilter = filter === 'all' || t.status === filter
    const matchesSearch =
      searchQuery === '' ||
      (t.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(searchQuery.toLowerCase())
    return matchesFilter && matchesSearch
  })

  const statusColors: Record<Task['status'], string> = {
    pending: '#666',
    in_progress: '#0891b2',
    completed: '#16a34a',
    cancelled: '#dc2626',
  }

  const priorityIndicator = (priority?: Task['priority']): string => {
    if (!priority) return ''
    return priority === 'high' ? '●' : priority === 'medium' ? '○' : '○'
  }

  if (showCreate) {
    return (
      <div style={{ padding: '20px' }}>
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>New Task</h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Title *
            </label>
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Task title"
              style={sInput}
            />
          </div>

          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
              Description
            </label>
            <textarea
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              placeholder="Task description"
              rows={4}
              style={{ ...sInput, resize: 'none' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Status
              </label>
              <select value={newStatus} onChange={e => setNewStatus(e.target.value as Task['status'])} style={sInput}>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Priority
              </label>
              <select value={newPriority} onChange={e => setNewPriority(e.target.value as Task['priority'])} style={sInput}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                Due Date
              </label>
              <input
                type="date"
                value={newDueDate}
                onChange={e => setNewDueDate(e.target.value)}
                style={sInput}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={createTask}
              disabled={!newTitle.trim() || creating}
              style={{
                ...sBtn(true),
                flex: 1,
                opacity: !newTitle.trim() || creating ? 0.5 : 1,
              }}
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              style={{
                ...sBtn(false),
                flex: 1,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (selectedTask) {
    return (
      <div style={{ padding: '20px' }}>
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>{selectedTask.title}</h3>
          <button
            onClick={() => setSelectedTask(null)}
            style={{
              marginTop: '12px',
              ...sBtn(false),
            }}
          >
            Back
          </button>
        </div>

        <div style={sCard}>
          {selectedTask.description && (
            <div style={{ marginBottom: '16px' }}>
              <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
                {selectedTask.description}
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
            <select
              value={selectedTask.status}
              onChange={e => updateTaskStatus(selectedTask.id, e.target.value as Task['status'])}
              style={{ ...sInput, flex: 1 }}
            >
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <button
              onClick={() => deleteTask(selectedTask.id)}
              style={{
                ...sBtn(false),
                background: 'rgba(220, 38, 38, 0.1)',
                color: '#dc2626',
              }}
            >
              Delete
            </button>
          </div>

          {selectedTask.due_date && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Due: {new Date(selectedTask.due_date).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Tasks</h2>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              ...sBtn(true),
            }}
          >
            + New
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {(['all', 'pending', 'in_progress', 'completed'] as const).map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              style={{
                ...sBtn(filter === status),
                textTransform: 'capitalize',
              }}
            >
              {status === 'in_progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search tasks..."
          style={sInput}
        />
      </div>

      {/* Tasks list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 20px' }}>Loading tasks...</div>
        ) : filteredTasks.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 20px' }}>No tasks found</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredTasks.map(task => (
              <button
                key={task.id}
                onClick={() => setSelectedTask(task)}
                style={{
                  ...sCard,
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--bg-hover, rgba(255,255,255,0.05))'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--bg-elevated)'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, marginBottom: '4px' }}>{task.title}</div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.8rem' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: statusColors[task.status],
                        color: '#fff',
                      }}
                    >
                      {task.status.replace('_', ' ')}
                    </span>
                    {task.priority && (
                      <span
                        style={{
                          color:
                            task.priority === 'high'
                              ? '#dc2626'
                              : task.priority === 'medium'
                                ? '#f59e0b'
                                : '#0891b2',
                        }}
                      >
                        {priorityIndicator(task.priority)} {task.priority}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
