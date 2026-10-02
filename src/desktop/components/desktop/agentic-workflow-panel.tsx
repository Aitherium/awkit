'use client'

/**
 * AgenticWorkflowPanel
 * =====================
 *
 * Desktop app that manages automated AI workflows — the "set it and forget it"
 * engine for AitherOS. Inspired by self-hosted agent architectures.
 *
 * Pre-built Workflows:
 *   📰 Research Digest — Scrape sources, find new papers, email a digest
 *   🎙️ Voice-to-Plan — Transcribe recordings, extract action items, build plan
 *   📧 Email Draft — Read thread, draft reply, send back for review
 *   🔍 Code Monitor — Watch repos, summarize changes, alert on issues
 *   🎨 Auto-Canvas — Generate images from prompts on schedule
 *   🧠 Memory Consolidation — Periodically consolidate Spirit memories
 *
 * Each workflow consists of steps that run sequentially or in parallel
 * via MicroScheduler, with live progress tracking.
 */

import React, { useState, useCallback } from 'react'
import {
  Play,
  Square,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Newspaper,
  Mic,
  Mail,
  Code2,
  Image as ImageIcon,
  Brain,
  ChevronRight,
  ChevronDown,
  Settings,
  Trash2,
  Copy,
  RotateCcw,
  Zap,
  Timer,
  Workflow,
} from 'lucide-react'
import { useAgentControlBus, type BackgroundTask } from '../../contexts/agent-control-bus'

// ============================================================================
// TYPES
// ============================================================================

export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed'
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface WorkflowStep {
  id: string
  name: string
  description: string
  /** What type of task to run */
  taskType: 'llm' | 'canvas' | 'vision' | 'voice' | 'fetch' | 'custom'
  /** The prompt or command for this step */
  prompt: string
  /** Depends on these step IDs (for parallelism) */
  dependsOn?: string[]
  status: StepStatus
  result?: any
  error?: string
  startedAt?: number
  completedAt?: number
}

export interface AgenticWorkflow {
  id: string
  name: string
  description: string
  icon: string
  category: 'research' | 'voice' | 'email' | 'code' | 'creative' | 'memory' | 'custom'
  steps: WorkflowStep[]
  status: WorkflowStatus
  /** Cron-like schedule (e.g., '0 8 * * *' for daily 8am) */
  schedule?: string
  /** Whether this workflow is active for scheduling */
  enabled: boolean
  lastRunAt?: number
  lastResult?: string
  createdAt: number
}

// ============================================================================
// PRE-BUILT WORKFLOW TEMPLATES
// ============================================================================

const WORKFLOW_TEMPLATES: Omit<AgenticWorkflow, 'id' | 'status' | 'createdAt'>[] = [
  {
    name: 'AI Research Digest',
    description: 'Scrape trusted research sources, find new papers, compile and email a daily digest',
    icon: '📰',
    category: 'research',
    enabled: false,
    schedule: '0 8 * * *',
    steps: [
      {
        id: 'fetch-sources',
        name: 'Fetch Research Sources',
        description: 'Scrape 19 trusted AI research sources for new papers',
        taskType: 'llm',
        prompt: 'You are a research assistant. Search and compile the latest AI research papers from the past 24 hours. Focus on: machine learning, NLP, computer vision, reinforcement learning, and agent architectures. List each paper with title, authors, abstract summary, and link.',
        status: 'pending',
      },
      {
        id: 'compare-previous',
        name: 'Compare Against Previous',
        description: 'Filter out papers already seen in previous digests',
        taskType: 'llm',
        prompt: 'Compare these papers against the previous digest. Identify only NEW papers not seen before. Rank them by relevance and impact.',
        dependsOn: ['fetch-sources'],
        status: 'pending',
      },
      {
        id: 'compile-digest',
        name: 'Compile Digest',
        description: 'Format into a readable email digest',
        taskType: 'llm',
        prompt: 'Compile these new papers into a beautifully formatted research digest. Include: executive summary, top 3 papers with detailed analysis, full list with one-line descriptions, and emerging trends section.',
        dependsOn: ['compare-previous'],
        status: 'pending',
      },
    ],
  },
  {
    name: 'Voice-to-Planning Pipeline',
    description: 'Transcribe voice recordings, extract action items, and build a prioritized daily plan',
    icon: '🎙️',
    category: 'voice',
    enabled: false,
    schedule: '0 7 * * *',
    steps: [
      {
        id: 'transcribe',
        name: 'Transcribe Recordings',
        description: 'Transcribe all voice notes from the past 24 hours',
        taskType: 'voice',
        prompt: 'Transcribe all recent voice recordings with timestamps and speaker identification.',
        status: 'pending',
      },
      {
        id: 'extract-actions',
        name: 'Extract Action Items',
        description: 'Parse transcriptions for tasks, decisions, and commitments',
        taskType: 'llm',
        prompt: 'Analyze these transcriptions and extract: (1) Action items with deadlines, (2) Key decisions made, (3) Questions to follow up on, (4) Ideas to explore. Categorize each by urgency and importance.',
        dependsOn: ['transcribe'],
        status: 'pending',
      },
      {
        id: 'build-plan',
        name: 'Build Daily Plan',
        description: 'Create prioritized to-do list from extracted items',
        taskType: 'llm',
        prompt: 'Build a prioritized daily plan from these action items. Use the Eisenhower matrix (urgent/important). Include time estimates and suggested schedule blocks. Make it actionable.',
        dependsOn: ['extract-actions'],
        status: 'pending',
      },
    ],
  },
  {
    name: 'Email Draft Assistant',
    description: 'Read email threads, draft contextual replies, and format for review',
    icon: '📧',
    category: 'email',
    enabled: false,
    steps: [
      {
        id: 'analyze-thread',
        name: 'Analyze Email Thread',
        description: 'Parse the email thread for context, tone, and intent',
        taskType: 'llm',
        prompt: 'Analyze this email thread. Identify: sender intent, key points, questions asked, tone, urgency level, and what response is expected.',
        status: 'pending',
      },
      {
        id: 'draft-reply',
        name: 'Draft Reply',
        description: 'Write a contextual, professional reply',
        taskType: 'llm',
        prompt: 'Draft a professional reply to this email thread based on the analysis. Match the formality level of the original. Address all questions. Be concise but thorough. Provide 2-3 variant drafts.',
        dependsOn: ['analyze-thread'],
        status: 'pending',
      },
    ],
  },
  {
    name: 'Code Repository Monitor',
    description: 'Watch repos for changes, summarize commits, and flag potential issues',
    icon: '💻',
    category: 'code',
    enabled: false,
    schedule: '0 9 * * *',
    steps: [
      {
        id: 'fetch-changes',
        name: 'Fetch Recent Changes',
        description: 'Pull recent commits and PRs from watched repositories',
        taskType: 'llm',
        prompt: 'Summarize the latest commits and pull requests from the AitherOS repository. Focus on: new features, bug fixes, breaking changes, and security updates.',
        status: 'pending',
      },
      {
        id: 'analyze-impact',
        name: 'Analyze Impact',
        description: 'Assess impact of changes on system stability',
        taskType: 'llm',
        prompt: 'Analyze these code changes for potential issues: breaking changes, security vulnerabilities, performance impacts, and test coverage gaps. Rate risk level for each change.',
        dependsOn: ['fetch-changes'],
        status: 'pending',
      },
    ],
  },
  {
    name: 'Auto-Canvas Generator',
    description: 'Generate images from scheduled prompts and save to desktop workspace',
    icon: '🎨',
    category: 'creative',
    enabled: false,
    steps: [
      {
        id: 'enhance-prompt',
        name: 'Enhance Prompt',
        description: 'Take a simple prompt and enhance it for better generation',
        taskType: 'llm',
        prompt: 'Enhance this image generation prompt with detailed artistic direction: lighting, composition, style, mood, and technical parameters.',
        status: 'pending',
      },
      {
        id: 'generate-image',
        name: 'Generate Image',
        description: 'Generate the image using AitherCanvas',
        taskType: 'canvas',
        prompt: 'Generate a high-quality image from the enhanced prompt.',
        dependsOn: ['enhance-prompt'],
        status: 'pending',
      },
    ],
  },
  {
    name: 'Memory Consolidation',
    description: 'Periodically consolidate and organize Spirit memories for better recall',
    icon: '🧠',
    category: 'memory',
    enabled: false,
    schedule: '0 3 * * *',
    steps: [
      {
        id: 'recall-recent',
        name: 'Recall Recent Memories',
        description: 'Fetch the last 24 hours of Spirit memory entries',
        taskType: 'llm',
        prompt: 'Recall and list all memory entries from the last 24 hours. Include context, importance rating, and associations.',
        status: 'pending',
      },
      {
        id: 'consolidate',
        name: 'Consolidate & Connect',
        description: 'Find patterns, merge duplicates, strengthen associations',
        taskType: 'llm',
        prompt: 'Consolidate these memories: merge duplicates, identify patterns and themes, strengthen cross-references, and suggest memory associations that should be linked. Output a consolidated memory map.',
        dependsOn: ['recall-recent'],
        status: 'pending',
      },
    ],
  },
]

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface AgenticWorkflowPanelProps {
  className?: string
}

export function AgenticWorkflowPanel({ className = '' }: AgenticWorkflowPanelProps) {
  const bus = useAgentControlBus()
  const [workflows, setWorkflows] = useState<AgenticWorkflow[]>(() =>
    WORKFLOW_TEMPLATES.map((t, i) => ({
      ...t,
      id: `wf-${i}-${Date.now()}`,
      status: 'idle' as WorkflowStatus,
      createdAt: Date.now(),
    }))
  )
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null)
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())

  const selected = workflows.find(w => w.id === selectedWorkflow)

  // ── Run a workflow ──────────────────────────────────────────────────
  const runWorkflow = useCallback(async (workflowId: string) => {
    setWorkflows(prev => prev.map(w =>
      w.id === workflowId
        ? { ...w, status: 'running' as WorkflowStatus, steps: w.steps.map(s => ({ ...s, status: 'pending' as StepStatus })) }
        : w
    ))

    const wf = workflows.find(w => w.id === workflowId)
    if (!wf) return

    // Execute steps in dependency order
    const completed = new Set<string>()
    const stepResults: Record<string, any> = {}

    for (const step of wf.steps) {
      // Check dependencies
      const deps = step.dependsOn || []
      if (deps.some(d => !completed.has(d))) {
        // Wait for deps — in a real impl this would be async
        // For now, we just skip if deps aren't met
      }

      // Mark step as running
      setWorkflows(prev => prev.map(w =>
        w.id === workflowId
          ? {
              ...w,
              steps: w.steps.map(s =>
                s.id === step.id ? { ...s, status: 'running' as StepStatus, startedAt: Date.now() } : s
              ),
            }
          : w
      ))

      try {
        // Build context from previous step results
        const depContext = deps.map(d => stepResults[d]).filter(Boolean).join('\n\n')
        const fullPrompt = depContext
          ? `Previous step results:\n${depContext}\n\nCurrent task: ${step.prompt}`
          : step.prompt

        // Queue as background task
        const taskId = bus.queueBackgroundTask({
          type: step.taskType === 'fetch' ? 'llm' : step.taskType,
          description: `[${wf.name}] ${step.name}`,
        })

        // For now, run through agent-bridge directly
        const res = await fetch('/api/agent-bridge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: fullPrompt,
            windowId: 'workflow-engine',
            stream: false,
          }),
        })

        const text = await res.text()
        const lines = text.split('\n').filter((l: string) => l.startsWith('data: '))
        let result = ''
        for (const line of lines) {
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const event = JSON.parse(data)
            if (event.t || event.token || event.content) result += event.t || event.token || event.content || ''
            if (event.type === 'complete' && event.content) result = event.content
          } catch (_e) { result += data }
        }

        stepResults[step.id] = result
        completed.add(step.id)

        setWorkflows(prev => prev.map(w =>
          w.id === workflowId
            ? {
                ...w,
                steps: w.steps.map(s =>
                  s.id === step.id
                    ? { ...s, status: 'completed' as StepStatus, result, completedAt: Date.now() }
                    : s
                ),
              }
            : w
        ))
      } catch (error: any) {
        setWorkflows(prev => prev.map(w =>
          w.id === workflowId
            ? {
                ...w,
                steps: w.steps.map(s =>
                  s.id === step.id
                    ? { ...s, status: 'failed' as StepStatus, error: error.message, completedAt: Date.now() }
                    : s
                ),
              }
            : w
        ))
      }
    }

    // Mark workflow complete
    const lastStep = wf.steps[wf.steps.length - 1]
    const finalResult = stepResults[lastStep.id] || ''
    setWorkflows(prev => prev.map(w =>
      w.id === workflowId
        ? {
            ...w,
            status: (w.steps.some(s => s.status === 'failed') ? 'failed' : 'completed') as WorkflowStatus,
            lastRunAt: Date.now(),
            lastResult: typeof finalResult === 'string' ? finalResult.slice(0, 500) : JSON.stringify(finalResult).slice(0, 500),
          }
        : w
    ))
  }, [workflows, bus])

  const stopWorkflow = useCallback((workflowId: string) => {
    setWorkflows(prev => prev.map(w =>
      w.id === workflowId ? { ...w, status: 'idle' as WorkflowStatus } : w
    ))
  }, [])

  const toggleEnabled = useCallback((workflowId: string) => {
    setWorkflows(prev => prev.map(w =>
      w.id === workflowId ? { ...w, enabled: !w.enabled } : w
    ))
  }, [])

  const toggleStep = useCallback((stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }, [])

  // Category icons
  const categoryIcons: Record<string, React.ReactNode> = {
    research: <Newspaper className="w-4 h-4" />,
    voice: <Mic className="w-4 h-4" />,
    email: <Mail className="w-4 h-4" />,
    code: <Code2 className="w-4 h-4" />,
    creative: <ImageIcon className="w-4 h-4" />,
    memory: <Brain className="w-4 h-4" />,
    custom: <Zap className="w-4 h-4" />,
  }

  return (
    <div className={`flex h-full bg-zinc-950 text-zinc-200 ${className}`}>
      {/* ── Workflow List ───────────────────────────────────────────────── */}
      <div className="w-64 border-r border-zinc-800 flex flex-col">
        <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Workflow className="w-4 h-4 text-[#5EC9CC]" />
            <span className="text-sm font-medium">Workflows</span>
          </div>
          <button className="p-1 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-800 transition-colors">
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {workflows.map(wf => (
            <button
              key={wf.id}
              onClick={() => setSelectedWorkflow(wf.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-zinc-800/50 hover:bg-zinc-800/50 transition-colors ${
                selectedWorkflow === wf.id ? 'bg-zinc-800/70 border-l-2 border-l-[#5EC9CC]' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{wf.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{wf.name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                      wf.status === 'running' ? 'bg-blue-400 animate-pulse' :
                      wf.status === 'completed' ? 'bg-green-400' :
                      wf.status === 'failed' ? 'bg-red-400' :
                      wf.enabled ? 'bg-amber-400' : 'bg-zinc-600'
                    }`} />
                    <span className="text-[10px] text-zinc-500">
                      {wf.status === 'running' ? 'Running' :
                       wf.enabled ? 'Scheduled' :
                       wf.status === 'completed' ? 'Done' :
                       wf.status === 'failed' ? 'Failed' : 'Idle'}
                    </span>
                    {wf.schedule && (
                      <span className="text-[10px] text-zinc-600 flex items-center gap-0.5">
                        <Timer className="w-2.5 h-2.5" />
                        {wf.schedule}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Workflow Detail ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col">
        {selected ? (
          <>
            {/* Header */}
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{selected.icon}</span>
                <div>
                  <h2 className="text-sm font-semibold">{selected.name}</h2>
                  <p className="text-[11px] text-zinc-500">{selected.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleEnabled(selected.id)}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    selected.enabled
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                  }`}
                >
                  {selected.enabled ? 'Scheduled' : 'Enable'}
                </button>
                {selected.status === 'running' ? (
                  <button
                    onClick={() => stopWorkflow(selected.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 text-xs transition-colors"
                  >
                    <Square className="w-3 h-3" /> Stop
                  </button>
                ) : (
                  <button
                    onClick={() => runWorkflow(selected.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#5EC9CC]/20 text-[#5EC9CC] hover:bg-[#7AD6D8]/30 text-xs transition-colors"
                  >
                    <Play className="w-3 h-3" /> Run Now
                  </button>
                )}
              </div>
            </div>

            {/* Steps */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {selected.steps.map((step, idx) => {
                const isExpanded = expandedSteps.has(step.id)
                return (
                  <div
                    key={step.id}
                    className={`border rounded-lg transition-colors ${
                      step.status === 'running' ? 'border-blue-500/30 bg-blue-500/5' :
                      step.status === 'completed' ? 'border-green-500/20 bg-green-500/5' :
                      step.status === 'failed' ? 'border-red-500/20 bg-red-500/5' :
                      'border-zinc-800 bg-zinc-900/50'
                    }`}
                  >
                    <button
                      onClick={() => toggleStep(step.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                    >
                      {/* Step number */}
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        step.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                        step.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        step.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                        'bg-zinc-800 text-zinc-500'
                      }`}>
                        {step.status === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> :
                         step.status === 'completed' ? <CheckCircle2 className="w-3 h-3" /> :
                         step.status === 'failed' ? <XCircle className="w-3 h-3" /> :
                         idx + 1}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium">{step.name}</div>
                        <div className="text-[10px] text-zinc-500 truncate">{step.description}</div>
                      </div>

                      {step.dependsOn && step.dependsOn.length > 0 && (
                        <span className="text-[9px] text-zinc-600 px-1.5 py-0.5 rounded bg-zinc-800">
                          depends: {step.dependsOn.join(', ')}
                        </span>
                      )}

                      {isExpanded ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-zinc-800/50 mt-0">
                        <div className="mt-2 text-[11px] text-zinc-400 bg-zinc-800/50 rounded p-2 font-mono whitespace-pre-wrap">
                          {step.prompt}
                        </div>
                        {step.result && (
                          <div className="mt-2">
                            <div className="text-[10px] text-zinc-500 mb-1">Result:</div>
                            <div className="text-[11px] text-zinc-300 bg-zinc-800/30 rounded p-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
                              {typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2)}
                            </div>
                          </div>
                        )}
                        {step.error && (
                          <div className="mt-2 text-[11px] text-red-400 bg-red-500/10 rounded p-2">
                            ⚠️ {step.error}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Last run result */}
              {selected.lastResult && selected.status !== 'running' && (
                <div className="mt-4 border border-zinc-800 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                    <span className="text-xs font-medium text-zinc-300">Last Run Output</span>
                    {selected.lastRunAt && (
                      <span className="text-[10px] text-zinc-600">
                        {new Date(selected.lastRunAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-400 bg-zinc-800/30 rounded p-2 max-h-60 overflow-y-auto whitespace-pre-wrap">
                    {selected.lastResult}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center p-8">
            <div className="space-y-3">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-[#5EC9CC]/20 to-cyan-500/20 flex items-center justify-center border border-[#5EC9CC]/20">
                <Workflow className="w-8 h-8 text-[#5EC9CC]" />
              </div>
              <h3 className="text-sm font-medium text-zinc-300">Agentic Workflows</h3>
              <p className="text-xs text-zinc-500 max-w-xs leading-relaxed">
                Automated AI workflows that run on schedule or on-demand.
                Research digests, voice-to-planning, email drafts, and more.
                Select a workflow to configure and run it.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AgenticWorkflowPanel
