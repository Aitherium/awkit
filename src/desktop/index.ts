/**
 * @aitheros/desktop-core
 * ======================
 * Shared desktop foundation for AitherOS.
 *
 * Consumed by:
 *   - AitherVeil (/desktop route — "Desktop Anywhere")
 *   - AitherDesktop (standalone web app on port 3001)
 *
 * Each consuming app provides its own `widgetImportMap` to control
 * which widgets are available in the desktop shell.
 */

// ── Core Shell & Types ──────────────────────────────────────────────────────
export { DesktopShell } from './components/desktop/desktop-shell'
export type { DesktopShellProps, WidgetImportMap } from './components/desktop/desktop-shell'

// ── Desktop Components ──────────────────────────────────────────────────────
export { DesktopCanvas } from './components/desktop/desktop-canvas'
export { DesktopWindow } from './components/desktop/desktop-window'
export { DesktopContextMenu } from './components/desktop/desktop-context-menu'
export { Taskbar } from './components/desktop/taskbar'
export { AccountChip, accountInitials } from './components/desktop/account-chip'
export type { DesktopAccount, DesktopIdentity } from './components/desktop/account-chip'
export { SystemTray } from './components/desktop/system-tray'
export { StartMenu } from './components/desktop/start-menu'
export { BootSequence } from './components/desktop/boot-sequence'
export { AltTabSwitcher } from './components/desktop/alt-tab-switcher'
export { NeuralMinimap } from './components/desktop/neural-minimap'
export { LockScreen } from './components/desktop/lock-screen'
export { NotificationCenter, NotificationToast } from './components/desktop/notification-center'
export type { DesktopNotification } from './components/desktop/notification-center'
export { WindowSnapPreview, detectSnapZone, getSnapGeometry } from './components/desktop/window-snap-preview'
export { SpotlightSearch } from './components/desktop/spotlight-search'
export { useAIDesktopController, parseDesktopCommand } from './components/desktop/ai-desktop-controller'
export { AgentCommandPalette } from './components/desktop/agent-command-palette'
export { AgentContextRegistrar } from './components/desktop/agent-context-registrar'
export { AgentSidebar } from './components/desktop/agent-sidebar'
export { AmbientSensesOverlay } from './components/desktop/ambient-senses-overlay'

// ── Desktop Widgets (built-in apps) ─────────────────────────────────────────
export { DesktopTerminal } from './components/desktop/desktop-terminal'
export { FileManagerPro } from './components/desktop/file-manager-pro'
export { FileEditor } from './components/desktop/file-editor'
export { NotepadPro } from './components/desktop/notepad-pro'
export { TaskManagerWidget } from './components/desktop/task-manager'
export { CalculatorApp } from './components/desktop/calculator-app'
export { WebBrowser } from './components/desktop/web-browser'
export { ImageViewer } from './components/desktop/image-viewer'
export { WeatherWidget } from './components/desktop/weather-widget'
export { SystemMonitor } from './components/desktop/system-monitor'
export { LinuxAppLauncher } from './components/desktop/linux-app-launcher'
export { NetworkCommandCenter } from './components/desktop/network-command-center'
export { ScreenshotTool } from './components/desktop/screenshot-tool'
export { AgenticWorkflowPanel } from './components/desktop/agentic-workflow-panel'

// ── Contexts ────────────────────────────────────────────────────────────────
export { WindowManagerProvider, useWindowManager } from './contexts/window-manager-context'
export { DesktopAgentProvider, useDesktopAgent } from './contexts/desktop-agent-context'
export { AgentControlBusProvider } from './contexts/agent-control-bus'
export { AppCatalogProvider, useAppCatalog } from './contexts/app-catalog-context'
export type { AppCatalogScope, CatalogEntry, HostApp } from './contexts/app-catalog-context'

// ── Error Boundaries ────────────────────────────────────────────────────────
export { WidgetErrorBoundary } from './components/error-boundaries/widget-error-boundary'
export { DashboardErrorBoundary } from './components/error-boundaries/dashboard-error-boundary'

// ── Data & Registry ─────────────────────────────────────────────────────────
export { buildWidgetRegistry, DESKTOP_APPS, DESKTOP_ICON_APPS, ALL_APPS } from './data/apps-manifest'
export type { AitherApp, DesktopWidgetConfig, DesktopIconConfig, AppCategory, AppStatus, AppAvailability } from './data/apps-manifest'

// ── Hooks ───────────────────────────────────────────────────────────────────
export { useAitherSenses } from './hooks/use-aither-senses'
export { useChatHistory } from './hooks/use-chat-history'

// ── Lib / Utils ─────────────────────────────────────────────────────────────
export { cn, isDemoMode } from './lib/utils'
export type { ScopeTag } from './lib/view-scope'
export { buildScopeTag, resolveAccessMode, resolveEffectiveTier } from './lib/view-scope'

// ── Types ───────────────────────────────────────────────────────────────────
export type { AeonMessage, AeonChatConfig } from './types/chat'
