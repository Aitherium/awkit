/**
 * ElysiumSyncIndicator — Shows sync status in desktop taskbar / dashboard header.
 *
 * Only visible in Elysium (desktop-anywhere) mode. Shows connection status
 * to the user's local awnode and allows configuring the sync target.
 *
 * @author AitherOS Team
 */

'use client'

import React, { useState } from 'react'
import {
    Cloud, Wifi, WifiOff, RefreshCw, Settings, Link2, Unlink2,
    CheckCircle2, AlertCircle, Loader2,
} from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '../ui/popover'
import { useElysiumSync, type NodeSyncStatus } from '../../hooks/use-elysium-sync'
import { useViewScope } from '../../contexts/view-scope-context'
import { cn } from '../../lib/utils'

const STATUS_CONFIG: Record<NodeSyncStatus, {
    icon: React.ElementType
    label: string
    color: string
    pulse: boolean
}> = {
    disconnected: { icon: WifiOff, label: 'Not Connected', color: 'text-zinc-500', pulse: false },
    connecting: { icon: Loader2, label: 'Connecting...', color: 'text-amber-400', pulse: true },
    connected: { icon: Wifi, label: 'Connected', color: 'text-emerald-400', pulse: false },
    syncing: { icon: RefreshCw, label: 'Syncing...', color: 'text-blue-400', pulse: true },
    error: { icon: AlertCircle, label: 'Connection Error', color: 'text-red-400', pulse: false },
}

export function ElysiumSyncIndicator() {
    const { accessMode } = useViewScope()
    // useElysiumSync exposes a slim interface since the offline-first
    // refactor (f2bca0276e); the richer connect/pendingOps surface is gone.
    const {
        nodeStatus, isNodeReachable, nodeUrl, lastSyncTime, setNodeUrl,
    } = useElysiumSync()

    const [nodeUrlInput, setNodeUrlInput] = useState(nodeUrl ?? '')
    const [isConnecting, setIsConnecting] = useState(false)

    // Only show in Elysium mode
    if (accessMode !== 'elysium') return null

    const config = STATUS_CONFIG[nodeStatus]
    const StatusIcon = config.icon

    const handleConnect = async () => {
        if (!nodeUrlInput.trim()) return
        setIsConnecting(true)
        setNodeUrl(nodeUrlInput.trim())
        setIsConnecting(false)
    }

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all',
                        'hover:bg-white/5 border border-transparent hover:border-white/10',
                        config.color,
                    )}
                >
                    <Cloud className="h-3.5 w-3.5" />
                    <StatusIcon className={cn(
                        'h-3 w-3',
                        config.pulse && 'animate-spin',
                    )} />
                </button>
            </PopoverTrigger>

            <PopoverContent align="end" className="w-72 p-3">
                <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-center gap-2">
                        <Cloud className="h-4 w-4 text-blue-400" />
                        <span className="text-sm font-medium">Elysium Sync</span>
                        <Badge
                            variant="outline"
                            className={cn(
                                'ml-auto h-5 text-[10px] border',
                                isNodeReachable
                                    ? 'border-emerald-500/30 text-emerald-300'
                                    : 'border-zinc-600/30 text-zinc-500'
                            )}
                        >
                            {config.label}
                        </Badge>
                    </div>

                    {/* Status */}
                    <div className="rounded-lg bg-zinc-900/50 border border-white/5 p-2 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-zinc-400">Status</span>
                            <span className={config.color}>{config.label}</span>
                        </div>
                        {lastSyncTime && (
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-400">Last Sync</span>
                                <span className="text-zinc-300 font-mono text-[10px]">
                                    {new Date(lastSyncTime).toLocaleTimeString()}
                                </span>
                            </div>
                        )}
                        {nodeUrl && (
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-400">Node</span>
                                <span className="text-zinc-300 font-mono text-[10px] truncate max-w-[140px]">
                                    {nodeUrl}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Connect / Disconnect */}
                    {!isNodeReachable ? (
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                                Local awnode URL
                            </label>
                            <div className="flex gap-1.5">
                                <Input
                                    value={nodeUrlInput}
                                    onChange={e => setNodeUrlInput(e.target.value)}
                                    placeholder="http://192.168.1.100:8080"
                                    className="h-7 text-xs bg-zinc-900/50"
                                />
                                <Button
                                    size="sm"
                                    onClick={handleConnect}
                                    disabled={isConnecting || !nodeUrlInput.trim()}
                                    className="h-7 px-2.5 text-xs"
                                >
                                    {isConnecting ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                        <Link2 className="h-3 w-3" />
                                    )}
                                </Button>
                            </div>
                            <p className="text-[10px] text-zinc-600">
                                Connect to your local awnode to sync files, settings, and chat history.
                            </p>
                        </div>
                    ) : (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setNodeUrl(null)}
                            className="w-full h-7 text-xs text-zinc-400 hover:text-red-400"
                        >
                            <Unlink2 className="h-3 w-3 mr-1.5" />
                            Disconnect
                        </Button>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}
