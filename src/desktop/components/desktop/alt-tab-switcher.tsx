'use client'

/**
 * AltTabSwitcher
 * ==============
 * 
 * Window switcher overlay (Alt+Tab) for the desktop mode.
 * Shows thumbnail cards of all open windows for quick switching.
 */

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain, Terminal, Settings, Folder, Bot, Sparkles, Radio,
  Feather, Library, Wand2, Gamepad2, GitBranch, Activity,
  HardDrive, Network, Eye, MessageSquare, Code2, Flame,
  Shield, Zap, Globe, Monitor,
} from 'lucide-react'

const ICON_MAP: Record<string, React.ElementType> = {
  brain: Brain, terminal: Terminal, settings: Settings, folder: Folder,
  bot: Bot, sparkles: Sparkles, radio: Radio, feather: Feather,
  library: Library, wand: Wand2, gamepad: Gamepad2, git: GitBranch,
  activity: Activity, harddrive: HardDrive, network: Network,
  eye: Eye, message: MessageSquare, code: Code2, flame: Flame,
  shield: Shield, zap: Zap, globe: Globe, monitor: Monitor,
}

interface AltTabWindow {
  id: string
  title: string
  icon: string
  isMinimized: boolean
}

interface AltTabSwitcherProps {
  isOpen: boolean
  windows: AltTabWindow[]
  selectedIndex: number
  onSelect: (id: string) => void
  onClose: () => void
}

export function AltTabSwitcher({
  isOpen,
  windows,
  selectedIndex,
  onSelect,
  onClose,
}: AltTabSwitcherProps) {
  if (!isOpen || windows.length === 0) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[400] bg-black/60 backdrop-blur-md flex items-center justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-zinc-900/90 backdrop-blur-xl border border-zinc-700/80 rounded-2xl p-6 shadow-2xl max-w-3xl"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 flex-wrap justify-center">
            {windows.map((win, idx) => {
              const Icon = ICON_MAP[win.icon] || Monitor
              const isSelected = idx === selectedIndex
              return (
                <button
                  key={win.id}
                  onClick={() => onSelect(win.id)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl transition-all w-28
                    ${isSelected
                      ? 'bg-white/15 ring-2 ring-[#5EC9CC]/60 shadow-lg shadow-[#5EC9CC]/10'
                      : 'hover:bg-white/8'
                    }
                    ${win.isMinimized ? 'opacity-60' : ''}`}
                >
                  <div className={`p-3 rounded-xl ${isSelected ? 'bg-[#5EC9CC]/20' : 'bg-white/5'} transition-colors`}>
                    <Icon className={`w-6 h-6 ${isSelected ? 'text-[#5EC9CC]' : 'text-zinc-400'}`} />
                  </div>
                  <span className={`text-[11px] font-medium truncate w-full text-center ${isSelected ? 'text-white' : 'text-zinc-500'}`}>
                    {win.title}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="text-center text-[10px] text-zinc-600 mt-4 font-mono">
            Alt+Tab to cycle • Enter to select • Esc to cancel
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
