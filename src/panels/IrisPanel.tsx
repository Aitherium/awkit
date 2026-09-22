'use client'

/**
 * IrisPanel — The Visual Artisan panel for the Living Desktop
 *
 * Iris orchestrates Media Forge operations. This panel allows: brief → pipeline →
 * evaluate → refine; style card generation; critique of any Studio result.
 */

import React, { useState } from 'react'
import { Sparkles, RefreshCw, AlertCircle } from 'lucide-react'

export interface IrisPanelProps {
  className?: string
}

export default function IrisPanel({
  className = ''
}: IrisPanelProps) {
  const [brief, setBrief] = useState('')
  const [activeTab, setActiveTab] = useState<'brief' | 'pipeline' | 'critique'>('brief')

  return (
    <div className={`bg-slate-900/60 backdrop-blur-xl border border-purple-500/20 rounded-lg flex flex-col ${className}`}>
      <div className="px-4 py-3 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-medium text-slate-100">Iris</h3>
          <span className="text-xs text-slate-500 ml-auto">The Visual Artisan</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-4 space-y-4">
          {/* Tab buttons */}
          <div className="flex gap-2 border-b border-slate-700 pb-3">
            {(['brief', 'pipeline', 'critique'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
                  activeTab === tab
                    ? 'text-purple-400 border-b-2 border-purple-400'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'brief' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">
                Describe what you want Iris to create or refine.
              </p>
              <textarea
                placeholder="E.g., 'Generate concept art for a cyberpunk cityscape with neon signs...'"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                className="w-full min-h-24 bg-slate-800/50 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
              <button
                disabled={!brief.trim()}
                className="w-full px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 text-slate-100 text-sm font-medium rounded transition-colors"
              >
                <Sparkles className="inline w-4 h-4 mr-2" />
                Generate Pipeline
              </button>
            </div>
          )}

          {activeTab === 'pipeline' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">Generated style options:</p>
              <p className="text-xs text-slate-500">
                Create a brief above to generate style options.
              </p>
            </div>
          )}

          {activeTab === 'critique' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-400">
                Upload or reference a Studio result to critique.
              </p>
              <button className="w-full px-3 py-2 border border-slate-600 hover:border-slate-500 text-slate-300 text-sm font-medium rounded transition-colors">
                <RefreshCw className="inline w-4 h-4 mr-2" />
                Evaluate Result
              </button>
              <p className="text-xs text-slate-500">
                Iris will score quality, suggest refinements, and offer up to 3 iterations.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
