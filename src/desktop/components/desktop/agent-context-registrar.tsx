'use client'

/**
 * AgentContextRegistrar
 * =====================
 *
 * A wrapper that auto-registers app-specific agent context for each widget
 * when it mounts inside a DesktopWindow. Provides the agent with information
 * about what app the user is currently using, so its responses are contextually relevant.
 *
 * Used by the renderWidgetContent function in desktop-shell.tsx to wrap every widget.
 *
 * Usage:
 *   <AgentContextRegistrar windowId="notepad" appConfig={AGENT_APP_CONFIGS.notepad}>
 *     <NotepadPro className="h-full" />
 *   </AgentContextRegistrar>
 */

import React, { useEffect } from 'react'
import {
  useDesktopAgent,
  type AppAgentContext,
} from '../../contexts/desktop-agent-context'

// ============================================================================
// PER-APP AGENT CONFIGURATIONS
// ============================================================================

export const AGENT_APP_CONFIGS: Record<string, Omit<AppAgentContext, 'currentState' | 'selectedContent'>> = {
  // ── Cognitive & AI ────────────────────────────────────────────────────
  brain: {
    appId: 'brain',
    appName: 'Protocol Command Center',
    appType: 'system',
    systemPromptAddition: 'You are helping the user manage AitherOS services and protocols. You have deep knowledge of the microservice ecosystem.',
    relevantServices: ['watch', 'pulse', 'genesis', 'microscheduler'],
    minLayer: 'services',
  },
  constellation: {
    appId: 'constellation',
    appName: 'Agent Constellation',
    appType: 'monitor',
    systemPromptAddition: 'You can see and help manage the AI agent fleet. Help with agent routing, monitoring, and orchestration.',
    relevantServices: ['microscheduler', 'watch', 'flux'],
    minLayer: 'services',
  },
  hera: {
    appId: 'hera',
    appName: 'Hera',
    appType: 'chat',
    systemPromptAddition: 'Hera is the emotional intelligence and empathy agent. Help users interact with Hera for counseling, journaling, and emotional support tasks.',
    relevantServices: ['sense', 'spirit', 'context'],
    minLayer: 'memory',
  },
  saga: {
    appId: 'saga',
    appName: 'Saga',
    appType: 'chat',
    systemPromptAddition: 'Saga is the long-form reasoning and storytelling agent. It handles creative writing, narrative generation, and deep analysis.',
    relevantServices: ['spirit', 'context'],
    minLayer: 'memory',
  },
  lyra: {
    appId: 'lyra',
    appName: 'Lyra',
    appType: 'chat',
    systemPromptAddition: 'Lyra is the code-generation and software engineering agent. Help users with programming tasks, code reviews, and architecture decisions.',
    relevantServices: ['spirit', 'context'],
    minLayer: 'memory',
  },
  vera: {
    appId: 'vera',
    appName: 'Vera',
    appType: 'chat',
    systemPromptAddition: 'Vera is the verification and truth-checking agent. Help users fact-check, validate claims, and ensure accuracy.',
    relevantServices: ['spirit', 'context'],
    minLayer: 'memory',
  },
  demiurge: {
    appId: 'demiurge',
    appName: 'Demiurge',
    appType: 'system',
    systemPromptAddition: 'Demiurge is the meta-orchestration agent that coordinates other agents. Help users manage multi-agent workflows.',
    relevantServices: ['microscheduler', 'watch', 'flux', 'genesis'],
    minLayer: 'services',
  },
  reasoning: {
    appId: 'reasoning',
    appName: 'Reasoning Engine',
    appType: 'tools',
    systemPromptAddition: 'Help the user construct and analyze reasoning chains, logical proofs, and multi-step problem solving.',
    relevantServices: ['context', 'spirit'],
    minLayer: 'memory',
  },
  spirit: {
    appId: 'spirit',
    appName: 'Spirit Memory',
    appType: 'system',
    systemPromptAddition: 'Spirit Memory handles persistent memory, knowledge graphs, and experience recall. Help users manage their AI memory system.',
    relevantServices: ['spirit', 'workingmemory', 'sensorybuffer', 'strata'],
    minLayer: 'memory',
  },

  // ── Productivity & Editors ────────────────────────────────────────────
  terminal: {
    appId: 'terminal',
    appName: 'Terminal',
    appType: 'tools',
    systemPromptAddition: 'The user is working in a terminal. Help with shell commands, scripting, and system administration. Provide commands they can copy and paste.',
    relevantServices: ['genesis'],
  },
  notepad: {
    appId: 'notepad',
    appName: 'Notepad Pro',
    appType: 'editor',
    systemPromptAddition: 'The user is editing text in Notepad Pro. You can help with writing, editing, formatting, code, and markdown. If they select text, you can help improve or transform it.',
  },
  'file-editor': {
    appId: 'file-editor',
    appName: 'File Editor',
    appType: 'editor',
    systemPromptAddition: 'Help the user edit their file. You can suggest improvements, fix errors, and help with formatting.',
  },
  calculator: {
    appId: 'calculator',
    appName: 'Calculator',
    appType: 'calculator',
    systemPromptAddition: 'Help with math calculations, unit conversions, formulas, and financial computations. Show your work step-by-step.',
  },
  calendar: {
    appId: 'calendar',
    appName: 'Calendar',
    appType: 'tools',
    systemPromptAddition: 'Help the user manage their schedule, set reminders, and plan their day.',
    relevantServices: ['scheduler'],
  },
  alarms: {
    appId: 'alarms',
    appName: 'Alarms & Timers',
    appType: 'tools',
    systemPromptAddition: 'Help with setting timers, alarms, and time management.',
    relevantServices: ['scheduler'],
  },

  // ── Files & System ────────────────────────────────────────────────────
  filesystem: {
    appId: 'filesystem',
    appName: 'File Manager',
    appType: 'files',
    systemPromptAddition: 'Help the user navigate, organize, and manage their files. Suggest folder structures and cleanup strategies.',
    relevantServices: ['strata'],
  },
  tasks: {
    appId: 'tasks',
    appName: 'Task Manager',
    appType: 'monitor',
    systemPromptAddition: 'Help analyze running processes, resource usage, and system performance. Suggest what can be safely closed or optimized.',
    relevantServices: ['watch', 'pulse', 'sensorybuffer'],
    minLayer: 'kernel',
  },
  'system-monitor': {
    appId: 'system-monitor',
    appName: 'System Monitor',
    appType: 'monitor',
    systemPromptAddition: 'Help diagnose system performance issues. Analyze CPU, memory, disk, and network metrics. Suggest optimizations.',
    relevantServices: ['watch', 'pulse', 'sensorybuffer', 'autonomic'],
    minLayer: 'kernel',
  },
  'network-center': {
    appId: 'network-center',
    appName: 'Network Command Center',
    appType: 'monitor',
    systemPromptAddition: 'Help with network monitoring, troubleshooting connectivity issues, DNS resolution, and firewall configuration.',
    relevantServices: ['flux', 'watch', 'sentry'],
    minLayer: 'services',
  },

  // ── Media & Creative ──────────────────────────────────────────────────
  paint: {
    appId: 'paint',
    appName: 'Paint Canvas',
    appType: 'creative',
    systemPromptAddition: 'Help with digital art creation, color theory, drawing techniques, and composition advice.',
  },
  canvas: {
    appId: 'canvas',
    appName: 'Aither Canvas',
    appType: 'creative',
    systemPromptAddition: 'Help with creative projects on the Aither Canvas.',
  },
  'image-viewer': {
    appId: 'image-viewer',
    appName: 'Image Viewer',
    appType: 'viewer',
    systemPromptAddition: 'Help describe, analyze, or discuss the images the user is viewing.',
  },
  screenshot: {
    appId: 'screenshot',
    appName: 'Screenshot Tool',
    appType: 'tools',
    systemPromptAddition: 'Help with taking and managing screenshots.',
  },

  // ── Web & Communication ───────────────────────────────────────────────
  browser: {
    appId: 'browser',
    appName: 'Web Browser',
    appType: 'browser',
    systemPromptAddition: 'Help the user research, summarize web content, and find information online.',
  },
  weather: {
    appId: 'weather',
    appName: 'Weather',
    appType: 'viewer',
    systemPromptAddition: 'Help interpret weather forecasts, suggest activities based on weather, and provide travel weather advice.',
  },

  // ── Infrastructure & DevOps ───────────────────────────────────────────
  topology: {
    appId: 'topology',
    appName: 'Service Topology',
    appType: 'monitor',
    systemPromptAddition: 'Help understand and troubleshoot the microservice topology, dependencies, and health status.',
    relevantServices: ['watch', 'genesis', 'flux'],
    minLayer: 'services',
  },
  flux: {
    appId: 'flux',
    appName: 'Flux Data Panel',
    appType: 'monitor',
    systemPromptAddition: 'Help analyze data flow, message queues, and event streams.',
    relevantServices: ['flux', 'watch'],
    minLayer: 'services',
  },
  logs: {
    appId: 'logs',
    appName: 'Logs Panel',
    appType: 'monitor',
    systemPromptAddition: 'Help analyze log entries, find errors, identify patterns, and troubleshoot issues from log data.',
    relevantServices: ['chronicle', 'watch'],
    minLayer: 'full',
  },
  strata: {
    appId: 'strata',
    appName: 'Strata Services',
    appType: 'system',
    systemPromptAddition: 'Help manage service layers and infrastructure strata.',
    relevantServices: ['strata', 'watch'],
    minLayer: 'services',
  },
  gpu: {
    appId: 'gpu',
    appName: 'GPU Cluster',
    appType: 'monitor',
    systemPromptAddition: 'Help monitor GPU utilization, VRAM usage, temperature, and optimize GPU workloads.',
    relevantServices: ['pulse', 'sensorybuffer', 'microscheduler'],
    minLayer: 'kernel',
  },
  mcp: {
    appId: 'mcp',
    appName: 'MCP Server Panel',
    appType: 'tools',
    systemPromptAddition: 'Help configure and manage Model Context Protocol (MCP) servers and tools.',
    relevantServices: ['genesis'],
  },
  github: {
    appId: 'github',
    appName: 'GitHub Command Center',
    appType: 'tools',
    systemPromptAddition: 'Help with GitHub repository management, pull requests, issues, and CI/CD workflows.',
  },
  secrets: {
    appId: 'secrets',
    appName: 'Secrets Manager',
    appType: 'system',
    systemPromptAddition: 'Help manage secrets, API keys, and credentials securely. Never display actual secret values.',
    relevantServices: ['secrets', 'guard'],
  },
  'security-audit': {
    appId: 'security-audit',
    appName: 'Security Audit',
    appType: 'system',
    systemPromptAddition: 'Help review security configurations, analyze vulnerabilities, and suggest hardening measures.',
    relevantServices: ['secrets', 'sentry', 'guard', 'watch'],
    minLayer: 'services',
  },

  // ── Training & Eval ───────────────────────────────────────────────────
  training: {
    appId: 'training',
    appName: 'Training Data',
    appType: 'tools',
    systemPromptAddition: 'Help manage training data, fine-tuning datasets, and model training pipelines.',
    relevantServices: ['evolution', 'strata'],
    minLayer: 'full',
  },
  eval: {
    appId: 'eval',
    appName: 'Eval & Efficiency',
    appType: 'monitor',
    systemPromptAddition: 'Help analyze model evaluation metrics, benchmarks, and efficiency scores.',
    relevantServices: ['evolution', 'microscheduler'],
    minLayer: 'services',
  },

  // ── Misc ──────────────────────────────────────────────────────────────
  scope: {
    appId: 'scope',
    appName: 'Scope Explorer',
    appType: 'tools',
    systemPromptAddition: 'Help explore and understand the AitherOS scope system.',
    relevantServices: ['context'],
  },
  mail: {
    appId: 'mail',
    appName: 'Agent Mailbox',
    appType: 'chat',
    systemPromptAddition: 'Help manage inter-agent communications and the agent mailbox system.',
    relevantServices: ['flux', 'microscheduler'],
    minLayer: 'services',
  },
  atlas: {
    appId: 'atlas',
    appName: 'Atlas Pipeline',
    appType: 'system',
    systemPromptAddition: 'Help manage the product pipeline, feature tracking, and project orchestration.',
    relevantServices: ['scheduler', 'watch'],
    minLayer: 'services',
  },
  agents: {
    appId: 'agents',
    appName: 'Agent Fleet',
    appType: 'monitor',
    systemPromptAddition: 'Help manage, monitor, and configure the fleet of AI agents.',
    relevantServices: ['microscheduler', 'watch', 'flux'],
    minLayer: 'services',
  },
  'linux-apps': {
    appId: 'linux-apps',
    appName: 'Linux App Launcher',
    appType: 'tools',
    systemPromptAddition: 'Help find and launch Linux applications.',
  },
  workflows: {
    appId: 'workflows',
    appName: 'Agentic Workflows',
    appType: 'system',
    systemPromptAddition: 'You are managing automated AI workflows. Help the user create, run, schedule, and monitor multi-step AI pipelines like research digests, voice-to-planning, email drafts, code monitoring, and image generation workflows. You can coordinate tasks through MicroScheduler and chain LLM/vision/canvas/voice steps together.',
    relevantServices: ['microscheduler', 'scheduler', 'watch', 'gateway', 'canvas', 'voice'],
    minLayer: 'services',
  },
}

// ============================================================================
// REGISTRAR COMPONENT
// ============================================================================

interface AgentContextRegistrarProps {
  windowId: string
  children: React.ReactNode
}

/**
 * Auto-registers agent context for a widget when it mounts.
 * Looks up the config from AGENT_APP_CONFIGS and registers it with the desktop agent context.
 * Falls back to a generic config if no specific one exists.
 */
export function AgentContextRegistrar({ windowId, children }: AgentContextRegistrarProps) {
  // Depend on the two STABLE callbacks, never on the whole context value.
  // DesktopAgentProvider builds a new value object on every render, and registering
  // forces a render, so `[windowId, agentCtx]` re-ran this effect after every
  // registration: unregister -> render -> register -> render -> ... forever, for every
  // open window. Measured 2026-10-01 on ?shell=aither-desktop: a nonstop render storm
  // that turned into React #185 ("Settings Unavailable") the moment Settings opened.
  // Guarded by __tests__/agent-context-registrar-loop.test.tsx.
  const { registerAppContext, unregisterAppContext } = useDesktopAgent()

  useEffect(() => {
    // Get base widget ID (strip file: prefix for file editors)
    const baseId = windowId.startsWith('file:') ? 'file-editor' : windowId
    const config = AGENT_APP_CONFIGS[baseId]

    if (config) {
      registerAppContext(windowId, {
        ...config,
        appId: windowId,  // Use actual windowId for per-instance tracking
      })
    } else {
      // Fallback: register a generic context
      registerAppContext(windowId, {
        appId: windowId,
        appName: windowId.charAt(0).toUpperCase() + windowId.slice(1),
        appType: 'tools',
      })
    }

    return () => {
      unregisterAppContext(windowId)
    }
  }, [windowId, registerAppContext, unregisterAppContext])

  return <>{children}</>
}
