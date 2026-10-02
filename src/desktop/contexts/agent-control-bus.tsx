'use client'

/**
 * Agent Control Bus (ACB)
 * =======================
 *
 * The nervous system of AitherOS desktop. Allows AI agents to CONTROL
 * literally everything — open apps, type text, generate images, run
 * commands, navigate files, trigger workflows, and more.
 *
 * Every app registers "controllable actions" that agents can invoke.
 * The bus validates permissions, queues actions, and dispatches them
 * to the correct app window.
 *
 * Architecture:
 *   Agent → Control Bus → Action Registry → Target App
 *                      → MicroScheduler (parallel background tasks)
 *                      → Canvas (image generation)
 *                      → Voice (speech output)
 *                      → Vision (screen reading)
 *
 * Security: Actions have permission levels. Destructive actions require
 * explicit user confirmation via the approval queue.
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

// ============================================================================
// TYPES
// ============================================================================

export type ActionPermission = 'auto' | 'confirm' | 'deny'

export interface AgentAction {
  id: string
  /** Target window ID (or 'desktop' for system-level actions) */
  targetWindow: string
  /** The action verb (e.g., 'type', 'open-app', 'generate-image', 'run-command') */
  action: string
  /** Action parameters */
  params: Record<string, any>
  /** Permission level required */
  permission: ActionPermission
  /** Human-readable description for approval UI */
  description: string
  /** Which agent initiated this */
  agentId?: string
  /** Timestamp */
  timestamp: number
  /** Execution status */
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'denied'
  /** Result of execution */
  result?: any
  /** Error message if failed */
  error?: string
}

export interface AppActionHandler {
  /** Unique action name (e.g., 'notepad:insert-text', 'terminal:run-command') */
  actionName: string
  /** Human-readable description */
  description: string
  /** Parameter schema for validation */
  paramSchema?: Record<string, { type: string; required?: boolean; description?: string }>
  /** The handler function */
  handler: (params: Record<string, any>) => Promise<any>
  /** Default permission level */
  defaultPermission: ActionPermission
}

export interface BackgroundTask {
  id: string
  type: 'llm' | 'vision' | 'canvas' | 'voice' | 'workflow' | 'custom'
  description: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress?: number
  result?: any
  error?: string
  startedAt?: number
  completedAt?: number
  createdAt: number
  /** MicroScheduler task ID if queued there */
  schedulerTaskId?: string
}

export interface DesktopFile {
  id: string
  name: string
  type: 'image' | 'text' | 'document' | 'audio' | 'video' | 'other'
  /** Base64 data or URL */
  data: string
  mimeType: string
  createdAt: number
  /** Source that created this file */
  source: string
  /** Size in bytes */
  size?: number
}

interface AgentControlBusValue {
  // ── Action Registry ─────────────────────────────────────────────────
  registerAction: (windowId: string, handler: AppActionHandler) => void
  unregisterAction: (windowId: string, actionName: string) => void
  getRegisteredActions: (windowId?: string) => AppActionHandler[]

  // ── Action Dispatch ─────────────────────────────────────────────────
  dispatch: (action: Omit<AgentAction, 'id' | 'timestamp' | 'status'>) => Promise<any>
  dispatchBatch: (actions: Omit<AgentAction, 'id' | 'timestamp' | 'status'>[]) => Promise<any[]>

  // ── Approval Queue ──────────────────────────────────────────────────
  pendingApprovals: AgentAction[]
  approveAction: (actionId: string) => void
  denyAction: (actionId: string) => void
  approveAll: () => void

  // ── Background Tasks ────────────────────────────────────────────────
  backgroundTasks: BackgroundTask[]
  queueBackgroundTask: (task: Omit<BackgroundTask, 'id' | 'status' | 'createdAt'>) => string
  cancelBackgroundTask: (taskId: string) => void

  // ── Desktop Workspace Files ─────────────────────────────────────────
  desktopFiles: DesktopFile[]
  saveToDesktop: (file: Omit<DesktopFile, 'id' | 'createdAt'>) => string
  removeFromDesktop: (fileId: string) => void

  // ── System Actions (shortcuts for common agent operations) ──────────
  openApp: (appId: string) => Promise<void>
  typeIntoApp: (windowId: string, text: string) => Promise<void>
  generateImage: (prompt: string, options?: { save?: boolean; model?: string; width?: number; height?: number }) => Promise<string>
  speak: (text: string, options?: { voice?: string; emotion?: string }) => Promise<void>
  analyzeScreen: (windowId?: string) => Promise<string>
  runBackgroundLLM: (prompt: string, options?: { model?: string; system?: string }) => Promise<string>

  // ── Action History ──────────────────────────────────────────────────
  actionHistory: AgentAction[]
  clearHistory: () => void
}

// ============================================================================
// CONTEXT
// ============================================================================

const AgentControlBusContext = createContext<AgentControlBusValue | null>(null)

export function useAgentControlBus() {
  const ctx = useContext(AgentControlBusContext)
  if (!ctx) throw new Error('useAgentControlBus must be used within AgentControlBusProvider')
  return ctx
}

/**
 * Hook for apps to register their controllable actions.
 * Call this in any widget to make it agent-controllable.
 */
export function useAgentControllable(windowId: string, actions: AppActionHandler[]) {
  const bus = useAgentControlBus()

  useEffect(() => {
    actions.forEach(a => bus.registerAction(windowId, a))
    return () => {
      actions.forEach(a => bus.unregisterAction(windowId, a.actionName))
    }
  }, [windowId, actions, bus])
}

// ============================================================================
// PROVIDER
// ============================================================================

export function AgentControlBusProvider({ children }: { children: React.ReactNode }) {
  // Action registry: windowId → actionName → handler
  const registryRef = useRef<Record<string, Record<string, AppActionHandler>>>({})

  const [pendingApprovals, setPendingApprovals] = useState<AgentAction[]>([])
  const [actionHistory, setActionHistory] = useState<AgentAction[]>([])
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([])
  const [desktopFiles, setDesktopFiles] = useState<DesktopFile[]>([])
  const [, forceUpdate] = useState(0)

  // We need a ref to the window manager's openWindow function.
  // This will be set by the desktop shell when it mounts.
  const openWindowRef = useRef<((appId: string) => void) | null>(null)

  // ── Action Registry ─────────────────────────────────────────────────
  const registerAction = useCallback((windowId: string, handler: AppActionHandler) => {
    if (!registryRef.current[windowId]) registryRef.current[windowId] = {}
    registryRef.current[windowId][handler.actionName] = handler
  }, [])

  const unregisterAction = useCallback((windowId: string, actionName: string) => {
    if (registryRef.current[windowId]) {
      delete registryRef.current[windowId][actionName]
    }
  }, [])

  const getRegisteredActions = useCallback((windowId?: string): AppActionHandler[] => {
    if (windowId) {
      return Object.values(registryRef.current[windowId] || {})
    }
    return Object.values(registryRef.current).flatMap(r => Object.values(r))
  }, [])

  // ── Find and execute a handler ──────────────────────────────────────
  const findHandler = useCallback((targetWindow: string, actionName: string): AppActionHandler | null => {
    // Check specific window first
    const windowHandlers = registryRef.current[targetWindow]
    if (windowHandlers?.[actionName]) return windowHandlers[actionName]

    // Check for a global handler (registered under 'desktop')
    const globalHandlers = registryRef.current['desktop']
    if (globalHandlers?.[actionName]) return globalHandlers[actionName]

    // Check all windows for the action (unscoped dispatch)
    for (const handlers of Object.values(registryRef.current)) {
      if (handlers[actionName]) return handlers[actionName]
    }

    return null
  }, [])

  const executeAction = useCallback(async (action: AgentAction): Promise<any> => {
    const handler = findHandler(action.targetWindow, action.action)
    if (!handler) {
      throw new Error(`No handler registered for action: ${action.action} on window: ${action.targetWindow}`)
    }
    return handler.handler(action.params)
  }, [findHandler])

  // ── Action Dispatch ─────────────────────────────────────────────────
  const dispatch = useCallback(async (
    actionInput: Omit<AgentAction, 'id' | 'timestamp' | 'status'>
  ): Promise<any> => {
    const action: AgentAction = {
      ...actionInput,
      id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      status: 'pending',
    }

    // Check if action needs approval
    if (action.permission === 'confirm') {
      setPendingApprovals(prev => [...prev, action])
      // Wait for approval (with 60s timeout)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          setPendingApprovals(prev => prev.filter(a => a.id !== action.id))
          reject(new Error('Action approval timed out'))
        }, 60000)

        const checkInterval = setInterval(() => {
          // Look in action history for resolution
          setActionHistory(prev => {
            const resolved = prev.find(a => a.id === action.id)
            if (resolved) {
              clearInterval(checkInterval)
              clearTimeout(timeout)
              if (resolved.status === 'completed') resolve(resolved.result)
              else if (resolved.status === 'denied') reject(new Error('Action denied by user'))
              else if (resolved.status === 'failed') reject(new Error(resolved.error || 'Action failed'))
            }
            return prev
          })
        }, 200)
      })
    }

    if (action.permission === 'deny') {
      action.status = 'denied'
      setActionHistory(prev => [...prev.slice(-99), action])
      throw new Error('Action denied by policy')
    }

    // Auto-execute
    try {
      action.status = 'executing'
      const result = await executeAction(action)
      action.status = 'completed'
      action.result = result
      setActionHistory(prev => [...prev.slice(-99), action])
      return result
    } catch (error: any) {
      action.status = 'failed'
      action.error = error.message
      setActionHistory(prev => [...prev.slice(-99), action])
      throw error
    }
  }, [executeAction])

  const dispatchBatch = useCallback(async (
    actions: Omit<AgentAction, 'id' | 'timestamp' | 'status'>[]
  ): Promise<any[]> => {
    return Promise.all(actions.map(a => dispatch(a).catch(e => ({ error: e.message }))))
  }, [dispatch])

  // ── Approval Queue ──────────────────────────────────────────────────
  const approveAction = useCallback(async (actionId: string) => {
    const action = pendingApprovals.find(a => a.id === actionId)
    if (!action) return
    setPendingApprovals(prev => prev.filter(a => a.id !== actionId))

    try {
      action.status = 'executing'
      const result = await executeAction(action)
      action.status = 'completed'
      action.result = result
    } catch (error: any) {
      action.status = 'failed'
      action.error = error.message
    }
    setActionHistory(prev => [...prev.slice(-99), action])
  }, [pendingApprovals, executeAction])

  const denyAction = useCallback((actionId: string) => {
    const action = pendingApprovals.find(a => a.id === actionId)
    if (!action) return
    action.status = 'denied'
    setPendingApprovals(prev => prev.filter(a => a.id !== actionId))
    setActionHistory(prev => [...prev.slice(-99), action])
  }, [pendingApprovals])

  const approveAll = useCallback(() => {
    pendingApprovals.forEach(a => approveAction(a.id))
  }, [pendingApprovals, approveAction])

  // ── Background Tasks ────────────────────────────────────────────────
  const queueBackgroundTask = useCallback((
    taskInput: Omit<BackgroundTask, 'id' | 'status' | 'createdAt'>
  ): string => {
    const task: BackgroundTask = {
      ...taskInput,
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'queued',
      createdAt: Date.now(),
    }
    setBackgroundTasks(prev => [...prev, task])

    // Execute async
    ;(async () => {
      try {
        setBackgroundTasks(prev =>
          prev.map(t => t.id === task.id ? { ...t, status: 'running' as const, startedAt: Date.now() } : t)
        )

        let result: any

        if (task.type === 'llm') {
          // Route through MicroScheduler
          const res = await fetch('/api/agent-bridge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: task.description,
              windowId: 'background',
              stream: false,
            }),
          })
          const text = await res.text()
          // Parse SSE to get final content
          const lines = text.split('\n').filter(l => l.startsWith('data: '))
          let accumulated = ''
          for (const line of lines) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            try {
              const event = JSON.parse(data)
              if (event.type === 'token' || event.t) {
                accumulated += event.t || event.token || event.content || ''
              } else if (event.type === 'complete' || event.type === 'final_answer') {
                if (event.content) accumulated = event.content
              }
            } catch (_e) { accumulated += data }
          }
          result = accumulated

        } else if (task.type === 'canvas') {
          // Image generation via Canvas API
          const res = await fetch('/api/canvas/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(task.result || { prompt: task.description }),
          })
          result = await res.json()

        } else if (task.type === 'vision') {
          // Vision analysis
          const res = await fetch('/api/canvas/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: task.description }),
          })
          result = await res.json()

        } else if (task.type === 'voice') {
          // TTS
          const res = await fetch('/api/voice/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: task.description }),
          })
          result = await res.json()
        }

        setBackgroundTasks(prev =>
          prev.map(t => t.id === task.id
            ? { ...t, status: 'completed' as const, result, completedAt: Date.now() }
            : t
          )
        )
      } catch (error: any) {
        setBackgroundTasks(prev =>
          prev.map(t => t.id === task.id
            ? { ...t, status: 'failed' as const, error: error.message, completedAt: Date.now() }
            : t
          )
        )
      }
    })()

    return task.id
  }, [])

  const cancelBackgroundTask = useCallback((taskId: string) => {
    setBackgroundTasks(prev =>
      prev.map(t => t.id === taskId && t.status !== 'completed'
        ? { ...t, status: 'cancelled' as const }
        : t
      )
    )
  }, [])

  // ── Desktop Workspace Files ─────────────────────────────────────────
  const saveToDesktop = useCallback((fileInput: Omit<DesktopFile, 'id' | 'createdAt'>): string => {
    const file: DesktopFile = {
      ...fileInput,
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    }
    setDesktopFiles(prev => [...prev, file])
    return file.id
  }, [])

  const removeFromDesktop = useCallback((fileId: string) => {
    setDesktopFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

  // ── System Action Shortcuts ─────────────────────────────────────────
  const openApp = useCallback(async (appId: string) => {
    return dispatch({
      targetWindow: 'desktop',
      action: 'open-app',
      params: { appId },
      permission: 'auto',
      description: `Open ${appId}`,
    })
  }, [dispatch])

  const typeIntoApp = useCallback(async (windowId: string, text: string) => {
    return dispatch({
      targetWindow: windowId,
      action: 'insert-text',
      params: { text },
      permission: 'auto',
      description: `Type "${text.slice(0, 50)}..." into ${windowId}`,
    })
  }, [dispatch])

  const generateImage = useCallback(async (
    prompt: string,
    options?: { save?: boolean; model?: string; width?: number; height?: number }
  ): Promise<string> => {
    const taskId = queueBackgroundTask({
      type: 'canvas',
      description: prompt,
      result: {
        prompt,
        model: options?.model || 'fast',
        width: options?.width || 1024,
        height: options?.height || 1024,
      },
    })

    // Wait for completion (180s timeout – ComfyUI needs ~100s on 6GB GPUs)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Image generation timed out')), 180_000)
      const check = setInterval(() => {
        setBackgroundTasks(prev => {
          const task = prev.find(t => t.id === taskId)
          if (task?.status === 'completed') {
            clearInterval(check)
            clearTimeout(timeout)
            const imageUrl = task.result?.image_url || task.result?.url || ''

            // Save to desktop if requested
            if (options?.save && imageUrl) {
              saveToDesktop({
                name: `generated-${Date.now()}.png`,
                type: 'image',
                data: imageUrl,
                mimeType: 'image/png',
                source: 'canvas-generation',
              })
            }

            resolve(imageUrl)
          } else if (task?.status === 'failed') {
            clearInterval(check)
            clearTimeout(timeout)
            reject(new Error(task.error || 'Image generation failed'))
          }
          return prev
        })
      }, 500)
    })
  }, [queueBackgroundTask, saveToDesktop])

  const speak = useCallback(async (text: string, options?: { voice?: string; emotion?: string }) => {
    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: options?.voice || 'NATF1',
          emotion: options?.emotion,
        }),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        await audio.play()
        audio.onended = () => URL.revokeObjectURL(url)
      }
    } catch (err) {
      // Fallback to Web Speech API
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text)
        speechSynthesis.speak(utterance)
      }
    }
  }, [])

  const analyzeScreen = useCallback(async (windowId?: string): Promise<string> => {
    try {
      // Capture the screen/window as an image
      const canvas = document.createElement('canvas')
      const target = windowId
        ? document.querySelector(`[data-window-id="${windowId}"]`) as HTMLElement
        : document.body

      if (!target) return 'Could not find target element'

      // Use html2canvas-like approach (simplified: screenshot the DOM)
      const rect = target.getBoundingClientRect()
      canvas.width = rect.width
      canvas.height = rect.height

      // For a real implementation, we'd use html-to-image or similar
      // For now, send a description-based analysis request
      const res = await fetch('/api/agent-bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Describe what the user is currently seeing in the ${windowId || 'desktop'} window. What's on screen? What are they working on?`,
          windowId: windowId || 'desktop',
          layers: ['kernel', 'services'],
          stream: false,
        }),
      })

      const text = await res.text()
      const lines = text.split('\n').filter(l => l.startsWith('data: '))
      let result = ''
      for (const line of lines) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const event = JSON.parse(data)
          if (event.t || event.token || event.content) {
            result += event.t || event.token || event.content || ''
          }
          if (event.type === 'complete' && event.content) result = event.content
        } catch (_e) { /* skip */ }
      }
      return result || 'Unable to analyze screen'
    } catch (error: any) {
      return `Screen analysis failed: ${error.message}`
    }
  }, [])

  const runBackgroundLLM = useCallback(async (
    prompt: string,
    options?: { model?: string; system?: string }
  ): Promise<string> => {
    const taskId = queueBackgroundTask({
      type: 'llm',
      description: prompt,
    })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('LLM task timed out')), 60000)
      const check = setInterval(() => {
        setBackgroundTasks(prev => {
          const task = prev.find(t => t.id === taskId)
          if (task?.status === 'completed') {
            clearInterval(check)
            clearTimeout(timeout)
            resolve(typeof task.result === 'string' ? task.result : JSON.stringify(task.result))
          } else if (task?.status === 'failed') {
            clearInterval(check)
            clearTimeout(timeout)
            reject(new Error(task.error || 'LLM task failed'))
          }
          return prev
        })
      }, 300)
    })
  }, [queueBackgroundTask])

  const clearHistory = useCallback(() => setActionHistory([]), [])

  // ── Context Value ───────────────────────────────────────────────────
  const value: AgentControlBusValue = {
    registerAction,
    unregisterAction,
    getRegisteredActions,
    dispatch,
    dispatchBatch,
    pendingApprovals,
    approveAction,
    denyAction,
    approveAll,
    backgroundTasks,
    queueBackgroundTask,
    cancelBackgroundTask,
    desktopFiles,
    saveToDesktop,
    removeFromDesktop,
    openApp,
    typeIntoApp,
    generateImage,
    speak,
    analyzeScreen,
    runBackgroundLLM,
    actionHistory,
    clearHistory,
  }

  return (
    <AgentControlBusContext.Provider value={value}>
      {children}
    </AgentControlBusContext.Provider>
  )
}
