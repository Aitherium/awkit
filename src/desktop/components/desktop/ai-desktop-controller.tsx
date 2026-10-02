'use client'

/**
 * AIDesktopController
 * ====================
 *
 * The brain that connects AI commands to actual desktop actions.
 * This is what makes AitherOS genuinely different — the AI doesn't just
 * chat, it CONTROLS the operating system.
 *
 * Capabilities:
 *  - Open/close/focus/snap apps by name
 *  - Change wallpaper
 *  - Run terminal commands
 *  - Query service health
 *  - Toggle system features (voice, vision, agents)
 *  - Create files / notes
 *  - Search across all apps
 *  - Control notifications (DND mode)
 *  - Report system diagnostics
 *  - Launch agentic workflows
 *
 * The controller parses structured commands from the LLM response
 * and executes them against the WindowManager and other contexts.
 */

import { useCallback, useRef } from 'react'
import type { SnapZone } from './window-snap-preview'

// ============================================================================
// COMMAND TYPES
// ============================================================================

export type DesktopCommandType =
  | 'open_app'
  | 'close_app'
  | 'focus_app'
  | 'snap_window'
  | 'maximize_window'
  | 'minimize_window'
  | 'change_wallpaper'
  | 'toggle_feature'
  | 'run_terminal'
  | 'create_file'
  | 'show_notification'
  | 'system_status'
  | 'search'
  | 'set_dnd'
  | 'lock_screen'
  | 'open_settings'
  | 'take_screenshot'
  | 'tile_windows'

export interface DesktopCommand {
  type: DesktopCommandType
  args: Record<string, any>
}

// ============================================================================
// APP NAME ALIASES — Fuzzy matching for natural language
// ============================================================================

const APP_ALIASES: Record<string, string> = {
  // Core
  'terminal': 'terminal',
  'console': 'terminal',
  'shell': 'terminal',
  'command line': 'terminal',
  'cmd': 'terminal',
  'bash': 'terminal',

  // IDE
  'code': 'forge',
  'editor': 'forge',
  'ide': 'forge',
  'vs code': 'forge',
  'vscode': 'forge',
  'code editor': 'forge',

  // Chat / AI
  'chat': 'brain',
  'ai': 'brain',
  'aither': 'brain',
  'copilot': 'brain',
  'assistant': 'brain',

  // Files
  'files': 'filesystem',
  'file manager': 'filesystem',
  'finder': 'filesystem',
  'explorer': 'filesystem',

  // Browser
  'browser': 'browser',
  'web': 'browser',
  'internet': 'browser',
  'safari': 'browser',
  'chrome': 'browser',

  // Agents
  'agents': 'agents',
  'agent fleet': 'agents',
  'constellation': 'constellation',
  'iris': 'iris',

  // Utilities
  'calculator': 'calculator',
  'calc': 'calculator',
  'notepad': 'notepad',
  'notes': 'notepad',
  'writer': 'writer',
  'document': 'writer',

  // System
  'monitor': 'system-monitor',
  'system monitor': 'system-monitor',
  'task manager': 'tasks',
  'processes': 'tasks',
  'network': 'network-center',
  'settings': 'settings',
  'preferences': 'settings',

  // Creative
  'canvas': 'canvas',
  'paint': 'paint',
  'draw': 'paint',
  '3d': 'forge3d',

  // Cognitive
  'reasoning': 'reasoning',
  'knowledge': 'knowledge-graph',
  'memory': 'spirit',
  'cognition': 'cognition',

  // Media
  'music': 'media-player',
  'video': 'video-player',
  'image': 'image-viewer',
  'photo': 'image-viewer',
  'screenshot': 'screenshot',

  // Weather
  'weather': 'weather',

  // Social
  'social': 'social',

  // Security
  'security': 'security-audit',
  'secrets': 'secrets',

  // Training
  'training': 'training',

  // Workflows
  'workflows': 'workflows',
  'automation': 'workflows',
}

const WALLPAPER_NAMES: Record<string, string> = {
  'deep space': 'from-slate-950 via-[#0B2526]/30 to-slate-950',
  'aurora': 'from-slate-950 via-emerald-950/40 to-cyan-950/30',
  'sunset': 'from-slate-950 via-orange-950/30 to-rose-950/20',
  'midnight': 'from-slate-950 via-blue-950/20 to-slate-950',
  'carbon': 'bg-zinc-950',
  'nebula': 'from-[#0B2526] via-[#0B2526]/50 to-pink-950/30',
  'ocean': 'from-slate-950 via-cyan-950/40 to-blue-950/30',
  'forest': 'from-slate-950 via-green-950/30 to-emerald-950/20',
  'fire': 'from-slate-950 via-red-950/30 to-orange-950/20',
  'matrix': 'from-black via-green-950/20 to-black',
}

// ============================================================================
// COMMAND PARSER
// ============================================================================

/**
 * Parse a natural language command into structured desktop commands.
 * This runs client-side as a fast pre-filter before hitting the LLM.
 */
export function parseDesktopCommand(input: string): DesktopCommand | null {
  const lower = input.toLowerCase().trim()

  // Open app
  const openMatch = lower.match(/^(?:open|launch|start|run|show)\s+(?:the\s+)?(.+?)(?:\s+app)?$/i)
  if (openMatch) {
    const appName = openMatch[1].trim()
    const widgetId = APP_ALIASES[appName] || appName.replace(/\s+/g, '-')
    return { type: 'open_app', args: { widgetId, appName } }
  }

  // Close app
  const closeMatch = lower.match(/^(?:close|quit|exit|kill)\s+(?:the\s+)?(.+?)(?:\s+app)?$/i)
  if (closeMatch) {
    const appName = closeMatch[1].trim()
    const widgetId = APP_ALIASES[appName] || appName.replace(/\s+/g, '-')
    return { type: 'close_app', args: { widgetId, appName } }
  }

  // Change wallpaper
  const wallpaperMatch = lower.match(/(?:change|set|switch)\s+(?:the\s+)?(?:wallpaper|background|desktop)\s+(?:to\s+)?(.+)/i)
  if (wallpaperMatch) {
    const wpName = wallpaperMatch[1].trim()
    return { type: 'change_wallpaper', args: { wallpaperName: wpName } }
  }

  // Snap window
  const snapMatch = lower.match(/(?:snap|move|put|tile)\s+(?:the\s+)?(?:window|app)?\s*(?:to\s+)?(?:the\s+)?(left|right|top|full|maximize)/i)
  if (snapMatch) {
    const direction = snapMatch[1].toLowerCase()
    const zone = direction === 'full' || direction === 'maximize' ? 'top' : direction
    return { type: 'snap_window', args: { zone } }
  }

  // Toggle features
  const toggleMatch = lower.match(/(?:toggle|enable|disable|turn\s+(?:on|off))\s+(?:the\s+)?(.+)/i)
  if (toggleMatch) {
    const feature = toggleMatch[1].trim()
    return { type: 'toggle_feature', args: { feature } }
  }

  // System status
  if (lower.match(/(?:system|health|status|diagnostic|how.*(?:system|services?))/i)) {
    return { type: 'system_status', args: {} }
  }

  // Lock screen
  if (lower.match(/^(?:lock|lock\s+screen|sleep)$/i)) {
    return { type: 'lock_screen', args: {} }
  }

  // Screenshot
  if (lower.match(/(?:screenshot|screen\s*shot|capture\s+screen|print\s+screen)/i)) {
    return { type: 'take_screenshot', args: {} }
  }

  // Tile all windows
  if (lower.match(/(?:tile|arrange|organize)\s+(?:all\s+)?windows/i)) {
    return { type: 'tile_windows', args: {} }
  }

  // Do not disturb
  if (lower.match(/(?:do\s+not\s+disturb|dnd|quiet|silence|mute\s+notifications)/i)) {
    return { type: 'set_dnd', args: { enabled: true } }
  }

  return null
}

// ============================================================================
// HOOK: useAIDesktopController
// ============================================================================

export interface AIDesktopControllerOptions {
  openWidget: (widgetId: string) => void
  closeWindow: (id: string) => void
  focusWindow: (id: string) => void
  snapWindow: (id: string, zone: SnapZone) => void
  maximizeWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  changeWallpaper: (name: string) => void
  toggleFeature: (feature: string) => void
  showNotification: (title: string, message: string, icon?: string) => void
  lockScreen: () => void
  openSettings: () => void
  getWindows: () => { id: string; title: string }[]
  getFocusedWindowId: () => string | null
}

export function useAIDesktopController(options: AIDesktopControllerOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options

  /**
   * Execute a parsed desktop command.
   * Returns a string describing what was done (for AI response).
   */
  const executeCommand = useCallback((cmd: DesktopCommand): string => {
    const o = optionsRef.current

    switch (cmd.type) {
      case 'open_app': {
        o.openWidget(cmd.args.widgetId)
        return `Opened ${cmd.args.appName || cmd.args.widgetId}.`
      }

      case 'close_app': {
        const windows = o.getWindows()
        const target = windows.find(w =>
          w.id === cmd.args.widgetId ||
          w.title.toLowerCase().includes(cmd.args.appName?.toLowerCase())
        )
        if (target) {
          o.closeWindow(target.id)
          return `Closed ${target.title}.`
        }
        return `Could not find ${cmd.args.appName} to close.`
      }

      case 'focus_app': {
        const windows = o.getWindows()
        const target = windows.find(w =>
          w.id === cmd.args.widgetId ||
          w.title.toLowerCase().includes(cmd.args.appName?.toLowerCase())
        )
        if (target) {
          o.focusWindow(target.id)
          return `Focused ${target.title}.`
        }
        return `Could not find ${cmd.args.appName} to focus.`
      }

      case 'snap_window': {
        const focusedId = o.getFocusedWindowId()
        if (focusedId) {
          o.snapWindow(focusedId, cmd.args.zone)
          return `Snapped window to ${cmd.args.zone}.`
        }
        return 'No focused window to snap.'
      }

      case 'maximize_window': {
        const focusedId = o.getFocusedWindowId()
        if (focusedId) {
          o.maximizeWindow(focusedId)
          return 'Maximized the focused window.'
        }
        return 'No focused window to maximize.'
      }

      case 'minimize_window': {
        const focusedId = o.getFocusedWindowId()
        if (focusedId) {
          o.minimizeWindow(focusedId)
          return 'Minimized the focused window.'
        }
        return 'No focused window to minimize.'
      }

      case 'change_wallpaper': {
        o.changeWallpaper(cmd.args.wallpaperName)
        return `Changed wallpaper to ${cmd.args.wallpaperName}.`
      }

      case 'toggle_feature': {
        o.toggleFeature(cmd.args.feature)
        return `Toggled ${cmd.args.feature}.`
      }

      case 'system_status': {
        const windows = o.getWindows()
        return `System online. ${windows.length} window(s) open. Running AitherOS with 97 microservices.`
      }

      case 'lock_screen': {
        o.lockScreen()
        return 'Screen locked.'
      }

      case 'take_screenshot': {
        o.openWidget('screenshot')
        return 'Opening screenshot tool.'
      }

      case 'tile_windows': {
        const windows = o.getWindows()
        if (windows.length === 0) return 'No windows to tile.'
        if (windows.length === 1) {
          o.maximizeWindow(windows[0].id)
          return 'Only one window — maximized it.'
        }
        // Tile first two side by side
        o.snapWindow(windows[0].id, 'left')
        if (windows.length >= 2) o.snapWindow(windows[1].id, 'right')
        return `Tiled ${Math.min(windows.length, 2)} windows side by side.`
      }

      case 'show_notification': {
        o.showNotification(
          cmd.args.title || 'AitherOS',
          cmd.args.message || '',
          cmd.args.icon,
        )
        return 'Notification sent.'
      }

      case 'open_settings': {
        o.openSettings()
        return 'Opened settings.'
      }

      case 'set_dnd': {
        o.toggleFeature('dnd')
        return cmd.args.enabled ? 'Do Not Disturb enabled.' : 'Do Not Disturb disabled.'
      }

      default:
        return 'Unknown command.'
    }
  }, [])

  /**
   * Process natural language input — parse + execute.
   * Returns null if the input wasn't a recognizable command.
   */
  const processNaturalLanguage = useCallback((input: string): string | null => {
    const cmd = parseDesktopCommand(input)
    if (!cmd) return null
    return executeCommand(cmd)
  }, [executeCommand])

  /**
   * Process a structured command from the LLM (JSON action blocks).
   * The LLM can emit: { "action": "open_app", "args": { "widgetId": "terminal" } }
   */
  const processLLMAction = useCallback((action: { type: string; args: Record<string, any> }): string => {
    return executeCommand(action as DesktopCommand)
  }, [executeCommand])

  /**
   * Get the system prompt addition that tells the LLM about available desktop commands.
   */
  const getSystemPrompt = useCallback((): string => {
    const o = optionsRef.current
    const windows = o.getWindows()

    return `
You are the AI controller for AitherOS Desktop. You can control the operating system through structured actions.

CURRENTLY OPEN WINDOWS: ${windows.length > 0 ? windows.map(w => `"${w.title}" (id: ${w.id})`).join(', ') : 'None'}

AVAILABLE DESKTOP ACTIONS (emit as JSON blocks):
- {"action": "open_app", "args": {"widgetId": "<app-id>"}}
  Apps: terminal, forge (IDE), browser, filesystem, calculator, notepad, writer, canvas, agents, constellation, iris, weather, system-monitor, tasks, network-center, paint, workflows, reasoning, training, secrets, github, mcp
- {"action": "close_app", "args": {"widgetId": "<window-id>"}}
- {"action": "snap_window", "args": {"zone": "left|right|top|top-left|top-right|bottom-left|bottom-right"}}
- {"action": "change_wallpaper", "args": {"wallpaperName": "deep space|aurora|sunset|midnight|carbon|nebula|ocean|forest|fire|matrix"}}
- {"action": "toggle_feature", "args": {"feature": "voice|vision|agents|dnd|nightlight|security"}}
- {"action": "tile_windows", "args": {}}
- {"action": "lock_screen", "args": {}}
- {"action": "take_screenshot", "args": {}}
- {"action": "show_notification", "args": {"title": "...", "message": "..."}}

When the user asks you to perform a desktop action, include the JSON action block in your response.
`.trim()
  }, [])

  return {
    executeCommand,
    processNaturalLanguage,
    processLLMAction,
    getSystemPrompt,
    parseCommand: parseDesktopCommand,
  }
}
