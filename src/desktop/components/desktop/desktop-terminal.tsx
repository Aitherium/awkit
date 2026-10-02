'use client'

/**
 * DesktopTerminal
 * ===============
 * 
 * A self-contained terminal widget for the desktop shell.
 * Connects to /api/terminal for a real PTY session.
 * Supports switching between Host (PowerShell/Bash) and Docker (Container) modes.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Terminal, RefreshCw, Server, Box, Lock, ShieldCheck } from 'lucide-react'
import { isDemoMode } from '../../lib/utils'

type TerminalMode = 'host' | 'docker'

export function DesktopTerminal({ className }: { className?: string }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [mode, setMode] = useState<TerminalMode>('host')
  const [output, setOutput] = useState('')
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isDocker, setIsDocker] = useState(false)
  const [envLoaded, setEnvLoaded] = useState(false)
  const [hostAuthed, setHostAuthed] = useState(false)
  const [showAuthPrompt, setShowAuthPrompt] = useState(false)
  const [adminKey, setAdminKey] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Kill session helper
  const killSession = useCallback(async (id: string) => {
    try {
      await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'kill', id })
      })
    } catch (e) {
      console.error('Kill session error:', e)
    }
  }, [])

  // Create terminal session
  const createSession = useCallback(async (targetMode: TerminalMode) => {
    if (isConnecting) return
    
    // Clear previous session if exists
    if (sessionId) {
      await killSession(sessionId)
      setSessionId(null)
    }

    if (isDemoMode()) {
      setOutput('\x1b[36m╭─ AitherZero Console (Demo Mode)\x1b[0m\n\x1b[36m│  Backend not available in static demo\x1b[0m\n\x1b[36m╰─ Visit the /demo page for interactive demos\x1b[0m\n')
      return
    }

    setIsConnecting(true)
    setIsConnected(false)
    setOutput('') // Clear output on new session

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      // Attach admin key for host mode authentication
      if (targetMode === 'host' && hostAuthed && adminKey) {
        headers['X-Admin-Key'] = adminKey
      }
      const response = await fetch('/api/terminal', {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          action: 'create',
          type: targetMode,
          container: targetMode === 'docker' ? 'aitheros-genesis' : undefined
        })
      })

      if (response.ok) {
        const data = await response.json()
        setSessionId(data.id)
        setIsConnected(true)
        const shellName = data.shell || (targetMode === 'docker' ? 'Container Shell' : 'Host Shell')
        const elevatedTag = targetMode === 'host' && isDocker ? '\x1b[33m[ELEVATED]\x1b[36m ' : ''
        setOutput(`\x1b[36m╭─ AitherZero Console v2.1\x1b[0m\n\x1b[36m│  ${elevatedTag}Connected to: ${shellName}\x1b[0m\n\x1b[36m╰─ ${data.cwd || '/app'}\x1b[0m\n\n`)
      } else if (response.status === 403) {
        const err = await response.json().catch(() => ({}))
        if (err.requiresAuth) {
          // Need admin auth — show prompt
          setShowAuthPrompt(true)
          setOutput(`\x1b[33m╭─ Host Access Requires Authentication\x1b[0m\n\x1b[33m│  Enter admin credentials to unlock host shell\x1b[0m\n\x1b[33m╰─ This is a privileged operation\x1b[0m\n`)
        } else {
          setOutput(`\x1b[31mAccess denied: ${err.error || 'Forbidden'}\x1b[0m\n`)
        }
      } else {
        const err = await response.json().catch(() => ({}))
        setOutput(`\x1b[31mFailed to create terminal session: ${err.error || 'Unknown error'}\x1b[0m\n`)
      }
    } catch (e) {
      console.error('Terminal create error:', e)
      setOutput(`\x1b[31mTerminal error: ${e}\x1b[0m\n`)
    } finally {
      setIsConnecting(false)
    }
  }, [sessionId, isConnecting, killSession, hostAuthed, adminKey, isDocker])

  // Poll for output
  useEffect(() => {
    if (!sessionId) return

    const poll = async () => {
      try {
        const response = await fetch(`/api/terminal?id=${sessionId}`)
        if (response.ok) {
          const data = await response.json()
          if (data.output) {
            setOutput(prev => prev + data.output)
          }
          // Server says process died
          if (data.alive === false) {
            setIsConnected(false)
            setSessionId(null)
          }
        } else if (response.status === 404) {
             // Session gone
             setIsConnected(false)
             setSessionId(null)
             setOutput(prev => prev + '\n\x1b[31mSession terminated\x1b[0m\n')
        }
      } catch (e) {
        console.error('Poll error:', e)
      }
    }

    pollRef.current = setInterval(poll, 100)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [sessionId])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [output])

  // Detect environment and create initial session with correct mode
  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const res = await fetch('/api/terminal?action=env')
        if (res.ok && !cancelled) {
          const env = await res.json()
          const docker = !!env.isDocker
          setIsDocker(docker)
          setEnvLoaded(true)
          // In Docker: default to Container (local shell IS the container)
          // On host: default to Host (local shell IS the host)
          const defaultMode: TerminalMode = docker ? 'docker' : 'host'
          setMode(defaultMode)
          createSession(defaultMode)
        }
      } catch (_e) {
        if (!cancelled) {
          setEnvLoaded(true)
          createSession('host')
        }
      }
    }
    if (!sessionId && !isConnecting && output === '') {
      init()
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle mode switch
  const handleModeChange = (newMode: TerminalMode) => {
    if (newMode !== mode) {
      setMode(newMode)
      createSession(newMode)
    }
  }

  // Focus input
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  // Send command
  const sendCommand = useCallback(async (cmd: string) => {
    if (!sessionId) {
      setOutput(prev => prev + `\x1b[31mNo active session — click refresh to reconnect\x1b[0m\n`)
      return
    }

    setHistory(prev => [cmd, ...prev.slice(0, 50)])
    setHistoryIndex(-1)
    setInput('')

    if (cmd === 'clear') {
      setOutput('')
      return
    }

    try {
      const resp = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'write', id: sessionId, data: cmd + '\n' })
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        setOutput(prev => prev + `\x1b[31m${err.error || 'Write failed'}\x1b[0m\n`)
        // Session is gone — mark disconnected
        if (resp.status === 404 || resp.status === 410) {
          setIsConnected(false)
          setSessionId(null)
        }
      }
    } catch (e) {
      console.error('Send error:', e)
      setOutput(prev => prev + `\x1b[31mFailed to send command\x1b[0m\n`)
    }
  }, [sessionId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionId) {
        killSession(sessionId)
      }
    }
  }, [sessionId, killSession])

  // Parse ANSI codes (Improved to strip non-color sequences)
  const renderOutput = useCallback((text: string) => {
    // Pre-process: strip OSC title sequences and normalize line endings
    const cleaned = text
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')  // OSC sequences
      .replace(/\r\n/g, '\n')  // normalize CRLF
      .replace(/\r/g, '')       // strip lone CR

    const parts: React.ReactNode[] = []
    // Match CSI sequences (Control Sequence Introducer): ESC [ ... char
    const ansiRegex = /\x1b\[[\?0-9;]*[a-zA-Z]/g
    let lastIndex = 0
    let currentColor = 'text-green-400'
    let match
    let key = 0

    const colorMap: Record<string, string> = {
      '0': 'text-green-400', '30': 'text-black', '31': 'text-red-400',
      '32': 'text-green-400', '33': 'text-yellow-400', '34': 'text-blue-400',
      '35': 'text-[#5EC9CC]', '36': 'text-cyan-400', '37': 'text-white',
      '90': 'text-gray-500', '91': 'text-red-300', '92': 'text-green-300',
      '93': 'text-yellow-300', '94': 'text-blue-300', '95': 'text-[#5EC9CC]', 
      '96': 'text-cyan-300', '97': 'text-white',
      '1': 'font-bold' // Basic bold support
    }
    
    while ((match = ansiRegex.exec(cleaned)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<span key={key++} className={currentColor}>{cleaned.slice(lastIndex, match.index)}</span>)
      }
      
      const seq = match[0]
      // Only process SGR (Select Graphic Rendition) codes ending in 'm'
      if (seq.endsWith('m')) {
        const codes = (seq.slice(2, -1) || '0').split(';')
        for (const code of codes) {
          if (colorMap[code]) currentColor = colorMap[code]
          else if (code === '0') currentColor = 'text-green-400'
        }
      }
      // Non-color codes (like cursor movement) are skipped/stripped
      
      lastIndex = match.index + seq.length
    }

    if (lastIndex < cleaned.length) {
      parts.push(<span key={key++} className={currentColor}>{cleaned.slice(lastIndex)}</span>)
    }

    return parts.length > 0 ? parts : cleaned
  }, [])

  return (
    <div className={`flex flex-col h-full bg-black text-green-400 font-mono text-sm ${className || ''}`}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-700/50 shrink-0">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Terminal className="w-3 h-3" />
          
          {/* Mode Selector */}
          <div className="flex items-center bg-zinc-800 rounded px-1 ml-1 overflow-hidden border border-zinc-700">
             <button 
                onClick={() => handleModeChange('docker')}
                className={`flex items-center gap-1 px-2 py-0.5 text-[10px] transition-colors ${mode === 'docker' ? 'bg-blue-900/60 text-blue-200 font-medium' : 'hover:bg-zinc-700/50 hover:text-zinc-300'}`}
             >
                <Box className="w-3 h-3" />
                Container
             </button>
             <div className="w-px h-3 bg-zinc-700" />
             <button 
                onClick={() => {
                  if (isDocker && !hostAuthed) {
                    setShowAuthPrompt(true)
                    setAuthError('')
                  } else {
                    handleModeChange('host')
                  }
                }}
                className={`flex items-center gap-1 px-2 py-0.5 text-[10px] transition-colors ${
                  isDocker && !hostAuthed ? 'opacity-50 text-zinc-500 hover:opacity-70' :
                  mode === 'host' ? 'bg-amber-900/60 text-amber-200 font-medium' : 'hover:bg-zinc-700/50 hover:text-zinc-300'
                }`}
                title={isDocker && !hostAuthed ? 'Requires admin authentication' : 'Elevated host shell'}
             >
                {isDocker && !hostAuthed ? <Lock className="w-3 h-3" /> : <Server className="w-3 h-3" />}
                Host
             </button>
          </div>

          <span className={`px-1.5 py-0.5 rounded text-[10px] ml-2 ${
            isConnected ? 'bg-green-500/20 text-green-400' :
            isConnecting ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {isConnected ? 'connected' : isConnecting ? 'connecting...' : 'disconnected'}
          </span>
          {hostAuthed && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] ml-1 bg-amber-500/15 text-amber-400">
              <ShieldCheck className="w-2.5 h-2.5" /> admin
            </span>
          )}
        </div>
        <button
          onClick={() => createSession(mode)}
          className="p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Restart terminal"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* Admin auth prompt overlay */}
      {showAuthPrompt && (
        <div className="px-4 py-3 bg-zinc-900/95 border-b border-amber-700/40 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] text-amber-300 font-medium">Host Shell — Admin Authentication Required</span>
          </div>
          <p className="text-[10px] text-zinc-500 mb-2">Enter the admin key to unlock elevated host access. This is a privileged operation.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              setAuthLoading(true)
              setAuthError('')
              try {
                const res = await fetch('/api/terminal', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Key': adminKey
                  },
                  body: JSON.stringify({ action: 'host-auth' })
                })
                const data = await res.json()
                if (data.authorized) {
                  setHostAuthed(true)
                  setShowAuthPrompt(false)
                  setAuthError('')
                  // Now auto-switch to host mode
                  setMode('host')
                  createSession('host')
                } else {
                  setAuthError(data.error || 'Authentication failed')
                }
              } catch (_e) {
                setAuthError('Failed to verify credentials')
              } finally {
                setAuthLoading(false)
              }
            }}
            className="flex items-center gap-2"
          >
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="Admin key"
              className="flex-1 max-w-[280px] px-2 py-1 text-[11px] rounded bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-amber-600/60"
              autoFocus
            />
            <button
              type="submit"
              disabled={authLoading || !adminKey}
              className="px-3 py-1 text-[10px] rounded bg-amber-600/20 text-amber-300 hover:bg-amber-600/30 disabled:opacity-40 transition-colors border border-amber-700/40"
            >
              {authLoading ? 'Verifying...' : 'Authenticate'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAuthPrompt(false); setAdminKey(''); setAuthError('') }}
              className="px-2 py-1 text-[10px] rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
          </form>
          {authError && <p className="text-[10px] text-red-400 mt-1.5">{authError}</p>}
        </div>
      )}

      {/* Output area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto p-3 whitespace-pre-wrap break-all leading-relaxed font-mono"
        onClick={() => inputRef.current?.focus()}
        style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace" }}
      >
        {renderOutput(output)}
      </div>

      {/* Input line */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-zinc-800 bg-zinc-950/50 shrink-0">
        <span className="text-green-500 text-xs">❯</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
               // Allow empty commands
               if (input.trim() || input === '') {
                 sendCommand(input)
               }
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              if (historyIndex < history.length - 1) {
                const newIdx = historyIndex + 1
                setHistoryIndex(newIdx)
                setInput(history[newIdx])
              }
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              if (historyIndex > 0) {
                const newIdx = historyIndex - 1
                setHistoryIndex(newIdx)
                setInput(history[newIdx])
              } else {
                setHistoryIndex(-1)
                setInput('')
              }
            }
          }}
          className="flex-1 bg-transparent outline-none text-green-400 placeholder:text-zinc-700 text-sm"
          placeholder={isConnected ? 'Type a command...' : 'Waiting for connection...'}
          disabled={!isConnected && !isDemoMode()}
          autoFocus
        />
      </div>
    </div>
  )
}
