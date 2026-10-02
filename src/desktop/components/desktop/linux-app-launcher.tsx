'use client'

/**
 * Linux App Launcher
 * ==================
 * 
 * A desktop window component that displays the Linux app catalog
 * and lets users install/launch real Linux desktop applications.
 * 
 * Applications run through:
 * - WSLg (Windows) — apps appear as native windows
 * - Docker + noVNC (containerized) — embedded in an iframe
 * - Native Linux — direct execution
 * 
 * Integrates with AitherDesktopBridge (port 8174).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Monitor, Download, Play, Square, Search, Grid, List,
    Cpu, Globe, Image, FileText, Music, Wrench, Code2,
    ExternalLink, Loader2, CheckCircle, XCircle, RefreshCw,
    AlertTriangle, Package, ChevronRight, Layers
} from 'lucide-react'
import { cn } from '../../lib/utils'

// =============================================================================
// TYPES
// =============================================================================

interface CatalogApp {
    id: string
    name: string
    description: string
    icon: string
    category: string
    binary: string
    package: string
    wslg_capable: boolean
    container_image: string
    needs_gpu: boolean
}

interface RunningApp {
    instance_id: string
    app_id: string
    app_name: string
    backend: string
    status: string
    pid: number | null
    container_id: string | null
    vnc_port: number | null
    novnc_url: string | null
    started_at: string
    error: string | null
}

// =============================================================================
// CONSTANTS
// =============================================================================

const BRIDGE_URL = 'http://localhost:8177'

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    development: { label: 'Development', icon: <Code2 className="w-4 h-4" />, color: '#3b82f6' },
    internet: { label: 'Internet', icon: <Globe className="w-4 h-4" />, color: '#22c55e' },
    graphics: { label: 'Graphics', icon: <Image className="w-4 h-4" />, color: '#f59e0b' },
    office: { label: 'Office', icon: <FileText className="w-4 h-4" />, color: '#5EC9CC' },
    media: { label: 'Media', icon: <Music className="w-4 h-4" />, color: '#ec4899' },
    system: { label: 'System', icon: <Wrench className="w-4 h-4" />, color: '#06b6d4' },
}

// =============================================================================
// APP CARD
// =============================================================================

function AppCard({
    app,
    isInstalled,
    isRunning,
    runningInstance,
    onLaunch,
    onInstall,
    onStop,
    onEmbed,
}: {
    app: CatalogApp
    isInstalled: boolean
    isRunning: boolean
    runningInstance: RunningApp | null
    onLaunch: (appId: string) => void
    onInstall: (appId: string) => void
    onStop: (instanceId: string) => void
    onEmbed: (url: string, title: string) => void
}) {
    const catMeta = CATEGORY_META[app.category] || CATEGORY_META.system
    const isLaunching = runningInstance?.status === 'starting'

    return (
        <div className={cn(
            "group relative p-3.5 rounded-xl border transition-all duration-200",
            "bg-zinc-900/40 hover:bg-zinc-900/70",
            isRunning
                ? "border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.05)]"
                : "border-zinc-800/40 hover:border-zinc-700/60"
        )}>
            {/* App icon + name */}
            <div className="flex items-start gap-3 mb-2.5">
                <span className="text-2xl select-none">{app.icon}</span>
                <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-zinc-100 truncate">{app.name}</h4>
                    <p className="text-[11px] text-zinc-500 line-clamp-2 leading-tight mt-0.5">
                        {app.description}
                    </p>
                </div>
            </div>

            {/* Tags */}
            <div className="flex items-center gap-1.5 mb-3">
                <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-md"
                    style={{ backgroundColor: catMeta.color + '15', color: catMeta.color }}
                >
                    {catMeta.label}
                </span>
                {app.needs_gpu && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400">
                        GPU
                    </span>
                )}
                {isInstalled && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-green-500/10 text-green-400">
                        Installed
                    </span>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5">
                {isRunning && runningInstance ? (
                    <>
                        <button
                            onClick={() => onStop(runningInstance.instance_id)}
                            className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg
                         bg-red-500/10 text-red-400 text-xs font-medium
                         hover:bg-red-500/20 transition-colors"
                        >
                            <Square className="w-3 h-3" />
                            Stop
                        </button>
                        {runningInstance.novnc_url && (
                            <button
                                onClick={() => onEmbed(runningInstance.novnc_url!, app.name)}
                                className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg
                           bg-blue-500/10 text-blue-400 text-xs font-medium
                           hover:bg-blue-500/20 transition-colors"
                            >
                                <ExternalLink className="w-3 h-3" />
                                Open
                            </button>
                        )}
                    </>
                ) : isInstalled ? (
                    <button
                        onClick={() => onLaunch(app.id)}
                        disabled={isLaunching}
                        className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg
                       bg-green-500/10 text-green-400 text-xs font-medium
                       hover:bg-green-500/20 transition-colors disabled:opacity-50"
                    >
                        {isLaunching ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> Launching...</>
                        ) : (
                            <><Play className="w-3 h-3" /> Launch</>
                        )}
                    </button>
                ) : (
                    <button
                        onClick={() => onInstall(app.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg
                       bg-zinc-800 text-zinc-300 text-xs font-medium
                       hover:bg-zinc-700 transition-colors"
                    >
                        <Download className="w-3 h-3" />
                        Install
                    </button>
                )}
            </div>

            {/* Running indicator */}
            {isRunning && (
                <div className="absolute top-2 right-2">
                    <span className="flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                    </span>
                </div>
            )}
        </div>
    )
}


// =============================================================================
// LINUX APP LAUNCHER (Main Component)
// =============================================================================

export function LinuxAppLauncher({ className }: { className?: string }) {
    const [catalog, setCatalog] = useState<CatalogApp[]>([])
    const [runningApps, setRunningApps] = useState<RunningApp[]>([])
    const [installedMap, setInstalledMap] = useState<Record<string, boolean>>({})
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [backend, setBackend] = useState<string>('unknown')
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [embedUrl, setEmbedUrl] = useState<string | null>(null)
    const [embedTitle, setEmbedTitle] = useState<string>('')
    const [installingApps, setInstallingApps] = useState<Set<string>>(new Set())

    // Fetch catalog
    const fetchCatalog = useCallback(async () => {
        try {
            const resp = await fetch(`${BRIDGE_URL}/apps/catalog`)
            if (resp.ok) {
                const data = await resp.json()
                setCatalog(data.apps || [])
                setBackend(data.backend || 'unknown')
                setError(null)
            } else {
                throw new Error('Bridge offline')
            }
        } catch (_e) {
            setError('DesktopBridge offline — showing catalog in demo mode')
            // Fallback catalog
            setCatalog([
                { id: 'firefox', name: 'Firefox', description: 'Mozilla Firefox web browser', icon: '🦊', category: 'internet', binary: 'firefox', package: 'firefox', wslg_capable: true, container_image: 'jlesage/firefox:latest', needs_gpu: false },
                { id: 'vscode', name: 'Visual Studio Code', description: 'Feature-rich code editor', icon: '💻', category: 'development', binary: 'code', package: 'code', wslg_capable: true, container_image: 'codercom/code-server:latest', needs_gpu: false },
                { id: 'gimp', name: 'GIMP', description: 'GNU Image Manipulation Program', icon: '🎨', category: 'graphics', binary: 'gimp', package: 'gimp', wslg_capable: true, container_image: 'jlesage/gimp:latest', needs_gpu: false },
                { id: 'blender', name: 'Blender', description: '3D creation suite', icon: '🧊', category: 'graphics', binary: 'blender', package: 'blender', wslg_capable: true, container_image: '', needs_gpu: true },
                { id: 'libreoffice', name: 'LibreOffice', description: 'Full office suite', icon: '📝', category: 'office', binary: 'libreoffice', package: 'libreoffice', wslg_capable: true, container_image: 'jlesage/libreoffice:latest', needs_gpu: false },
                { id: 'vlc', name: 'VLC', description: 'Universal media player', icon: '🎬', category: 'media', binary: 'vlc', package: 'vlc', wslg_capable: true, container_image: '', needs_gpu: false },
                { id: 'htop', name: 'htop', description: 'Interactive process viewer', icon: '📊', category: 'system', binary: 'htop', package: 'htop', wslg_capable: true, container_image: '', needs_gpu: false },
                { id: 'gnome-terminal', name: 'GNOME Terminal', description: 'Full Linux terminal', icon: '🖥️', category: 'development', binary: 'gnome-terminal', package: 'gnome-terminal', wslg_capable: true, container_image: '', needs_gpu: false },
                { id: 'nsight-compute', name: 'NVIDIA Nsight Compute', description: 'GPU kernel profiler', icon: '🔬', category: 'development', binary: 'ncu-ui', package: 'nsight-compute', wslg_capable: true, container_image: '', needs_gpu: true },
                { id: 'chromium', name: 'Chromium', description: 'Open-source Chrome browser', icon: '🌐', category: 'internet', binary: 'chromium-browser', package: 'chromium-browser', wslg_capable: true, container_image: '', needs_gpu: false },
                { id: 'thunderbird', name: 'Thunderbird', description: 'Email, calendar, contacts', icon: '📧', category: 'internet', binary: 'thunderbird', package: 'thunderbird', wslg_capable: true, container_image: 'jlesage/thunderbird:latest', needs_gpu: false },
                { id: 'nautilus', name: 'Files (Nautilus)', description: 'GNOME file manager', icon: '📁', category: 'system', binary: 'nautilus', package: 'nautilus', wslg_capable: true, container_image: '', needs_gpu: false },
            ])
        } finally {
            setIsLoading(false)
        }
    }, [])

    // Fetch running apps
    const fetchRunning = useCallback(async () => {
        try {
            const resp = await fetch(`${BRIDGE_URL}/apps/running`)
            if (resp.ok) {
                const data = await resp.json()
                setRunningApps(data.apps || [])
            }
        } catch (_e) { /* offline */ }
    }, [])

    // Initial load
    useEffect(() => {
        fetchCatalog()
        fetchRunning()
        const interval = setInterval(fetchRunning, 5000)
        return () => clearInterval(interval)
    }, [fetchCatalog, fetchRunning])

    // Launch an app
    const handleLaunch = useCallback(async (appId: string) => {
        try {
            const resp = await fetch(`${BRIDGE_URL}/apps/launch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ app_id: appId }),
            })
            if (resp.ok) {
                const data = await resp.json()
                if (data.success) {
                    fetchRunning()
                    // If container with noVNC, auto-embed
                    if (data.instance?.novnc_url) {
                        setTimeout(() => {
                            setEmbedUrl(data.instance.novnc_url)
                            setEmbedTitle(data.instance.app_name)
                        }, 2000) // Give container time to start
                    }
                }
            }
        } catch (e) {
            console.error('Launch failed:', e)
        }
    }, [fetchRunning])

    // Install an app
    const handleInstall = useCallback(async (appId: string) => {
        setInstallingApps(prev => new Set(prev).add(appId))
        try {
            const resp = await fetch(`${BRIDGE_URL}/apps/install/${appId}`, {
                method: 'POST',
            })
            if (resp.ok) {
                const data = await resp.json()
                if (data.success) {
                    setInstalledMap(prev => ({ ...prev, [appId]: true }))
                }
            }
        } catch (e) {
            console.error('Install failed:', e)
        } finally {
            setInstallingApps(prev => {
                const next = new Set(prev)
                next.delete(appId)
                return next
            })
        }
    }, [])

    // Stop an app
    const handleStop = useCallback(async (instanceId: string) => {
        try {
            await fetch(`${BRIDGE_URL}/apps/stop/${instanceId}`, { method: 'POST' })
            setTimeout(fetchRunning, 500)
        } catch (_e) { /* ignore */ }
    }, [fetchRunning])

    // Embed noVNC in window
    const handleEmbed = useCallback((url: string, title: string) => {
        setEmbedUrl(url)
        setEmbedTitle(title)
    }, [])

    // Filter catalog
    const filteredApps = useMemo(() => {
        let apps = catalog
        if (selectedCategory) {
            apps = apps.filter(a => a.category === selectedCategory)
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase()
            apps = apps.filter(a =>
                a.name.toLowerCase().includes(q) ||
                a.description.toLowerCase().includes(q) ||
                a.category.toLowerCase().includes(q)
            )
        }
        return apps
    }, [catalog, selectedCategory, searchQuery])

    const categories = useMemo(() => {
        const cats = new Set(catalog.map(a => a.category))
        return Array.from(cats).sort()
    }, [catalog])

    const runningMap = useMemo(() => {
        const map: Record<string, RunningApp> = {}
        for (const app of runningApps) {
            map[app.app_id] = app
        }
        return map
    }, [runningApps])

    // ── Embedded App View ──
    if (embedUrl) {
        return (
            <div className={cn("flex flex-col h-full bg-zinc-950", className)}>
                <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800">
                    <div className="flex items-center gap-2">
                        <Monitor className="w-4 h-4 text-cyan-400" />
                        <span className="text-sm font-medium text-zinc-200">{embedTitle}</span>
                        <span className="text-[10px] text-zinc-500 font-mono">{embedUrl}</span>
                    </div>
                    <button
                        onClick={() => { setEmbedUrl(null); setEmbedTitle('') }}
                        className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-zinc-800"
                    >
                        ← Back to Launcher
                    </button>
                </div>
                <iframe
                    src={embedUrl}
                    className="flex-1 w-full border-none"
                    title={embedTitle}
                    allow="clipboard-read; clipboard-write"
                />
            </div>
        )
    }

    // ── Launcher View ──
    return (
        <div className={cn("flex flex-col h-full bg-zinc-950 text-white", className)}>
            {/* Header */}
            <div className="px-4 py-3 border-b border-zinc-800/50">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Layers className="w-5 h-5 text-cyan-400" />
                        <h2 className="text-base font-bold">Linux Apps</h2>
                        <span className="text-[10px] text-zinc-500 font-mono px-1.5 py-0.5 bg-zinc-800/50 rounded">
                            {backend.toUpperCase()}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">
                            {runningApps.length} running
                        </span>
                        <button onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')} className="p-1 rounded hover:bg-zinc-800">
                            {viewMode === 'grid' ? <List className="w-4 h-4 text-zinc-400" /> : <Grid className="w-4 h-4 text-zinc-400" />}
                        </button>
                        <button onClick={() => { fetchCatalog(); fetchRunning() }} className="p-1 rounded hover:bg-zinc-800">
                            <RefreshCw className="w-4 h-4 text-zinc-400" />
                        </button>
                    </div>
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search apps..."
                        className="w-full pl-9 pr-3 py-2 bg-zinc-900/60 border border-zinc-800/50 rounded-lg
                       text-sm text-zinc-200 placeholder:text-zinc-600
                       focus:outline-none focus:border-zinc-700 transition-colors"
                    />
                </div>

                {/* Categories */}
                <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto pb-0.5">
                    <button
                        onClick={() => setSelectedCategory(null)}
                        className={cn(
                            "px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                            !selectedCategory
                                ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/25"
                                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                        )}
                    >
                        All ({catalog.length})
                    </button>
                    {categories.map(cat => {
                        const meta = CATEGORY_META[cat] || CATEGORY_META.system
                        const count = catalog.filter(a => a.category === cat).length
                        return (
                            <button
                                key={cat}
                                onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                                className={cn(
                                    "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                                    selectedCategory === cat
                                        ? `border`
                                        : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                                )}
                                style={selectedCategory === cat ? {
                                    backgroundColor: meta.color + '15',
                                    color: meta.color,
                                    borderColor: meta.color + '40',
                                } : {}}
                            >
                                {meta.icon}
                                {meta.label} ({count})
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Error banner */}
            {error && (
                <div className="mx-4 mt-3 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400 flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    {error}
                </div>
            )}

            {/* App Grid */}
            <div className="flex-1 overflow-auto p-4">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full text-zinc-500">
                        <Loader2 className="w-6 h-6 animate-spin mr-2" />
                        Loading catalog...
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {filteredApps.map(app => (
                            <AppCard
                                key={app.id}
                                app={app}
                                isInstalled={installedMap[app.id] ?? true} // Assume installed by default
                                isRunning={!!runningMap[app.id]}
                                runningInstance={runningMap[app.id] || null}
                                onLaunch={handleLaunch}
                                onInstall={handleInstall}
                                onStop={handleStop}
                                onEmbed={handleEmbed}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {filteredApps.map(app => {
                            const isRunning = !!runningMap[app.id]
                            const catMeta = CATEGORY_META[app.category] || CATEGORY_META.system
                            return (
                                <div
                                    key={app.id}
                                    className={cn(
                                        "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer",
                                        isRunning
                                            ? "border-green-500/20 bg-green-500/5"
                                            : "border-zinc-800/30 bg-zinc-900/30 hover:bg-zinc-900/60"
                                    )}
                                >
                                    <span className="text-xl">{app.icon}</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-zinc-200">{app.name}</p>
                                        <p className="text-[11px] text-zinc-500 truncate">{app.description}</p>
                                    </div>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                                        backgroundColor: catMeta.color + '15',
                                        color: catMeta.color,
                                    }}>{catMeta.label}</span>
                                    {isRunning ? (
                                        <button onClick={() => handleStop(runningMap[app.id].instance_id)} className="text-xs text-red-400 hover:text-red-300">
                                            Stop
                                        </button>
                                    ) : (
                                        <button onClick={() => handleLaunch(app.id)} className="text-xs text-green-400 hover:text-green-300">
                                            Launch
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Running apps bar */}
            {runningApps.length > 0 && (
                <div className="px-4 py-2.5 border-t border-zinc-800/50 bg-zinc-900/30">
                    <div className="flex items-center gap-2 overflow-x-auto">
                        <span className="text-[10px] text-zinc-500 whitespace-nowrap">Running:</span>
                        {runningApps.map(app => (
                            <span
                                key={app.instance_id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-green-500/10 text-green-400 text-[11px] font-medium whitespace-nowrap"
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                {app.app_name}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
