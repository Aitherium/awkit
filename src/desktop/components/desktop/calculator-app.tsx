'use client'

/**
 * Calculator Pro
 * ==============
 *
 * Three modes:
 *  - Standard  (basic arithmetic, %, √)
 *  - Scientific (sin, cos, tan, log, ln, exp, π, e, powers, factorials)
 *  - Programmer (hex/dec/oct/bin, bitwise AND/OR/XOR/NOT/shift)
 *
 * Features:
 *  - Full keyboard support
 *  - Expression history with recall
 *  - Copy result to clipboard
 *  - Parentheses, operator precedence
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Copy, History, Delete, RotateCcw, ChevronDown, Sparkles, Send, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

// ============================================================================
// TYPES
// ============================================================================

type CalcMode = 'standard' | 'scientific' | 'programmer' | 'ai'
type ProgrammerBase = 'DEC' | 'HEX' | 'OCT' | 'BIN'

interface HistoryEntry {
  expression: string
  result: string
  timestamp: number
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function CalculatorApp({ className = '' }: { className?: string }) {
  const [mode, setMode] = useState<CalcMode>('standard')
  const [display, setDisplay] = useState('0')
  const [expression, setExpression] = useState('')
  const [memory, setMemory] = useState(0)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [pBase, setPBase] = useState<ProgrammerBase>('DEC')
  const [justEvaluated, setJustEvaluated] = useState(false)
  const [aiQuery, setAiQuery] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiExplanation, setAiExplanation] = useState('')
  const aiInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Focus container for keyboard events
  useEffect(() => { containerRef.current?.focus() }, [mode])

  // ── Evaluation ────────────────────────────────────────────────────────
  const evaluate = useCallback(() => {
    try {
      // Replace display symbols with JS-safe equivalents
      let expr = expression + display
      expr = expr
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/−/g, '-')   // Unicode minus (U+2212) → hyphen-minus
        .replace(/—/g, '-')   // Em-dash → hyphen-minus
        .replace(/π/g, `${Math.PI}`)
        .replace(/e(?![x])/g, `${Math.E}`)
      expr = expr.replace(/√\(/g, 'Math.sqrt(')
      expr = expr.replace(/sin\(/g, 'Math.sin(').replace(/cos\(/g, 'Math.cos(').replace(/tan\(/g, 'Math.tan(')
      expr = expr.replace(/log\(/g, 'Math.log10(').replace(/ln\(/g, 'Math.log(')
      expr = expr.replace(/(\d+)!/g, '(function f(n){return n<=1?1:n*f(n-1)})($1)')
      expr = expr.replace(/\^/g, '**')

       
      let result = eval(expr)
      if (typeof result !== 'number' || !isFinite(result)) {
        setDisplay('Error')
        return
      }

      // Round to avoid floating point noise
      result = Math.round(result * 1e12) / 1e12
      const resultStr = mode === 'programmer' ? formatForBase(result, pBase) : String(result)

      setHistory(prev => [{
        expression: expression + display,
        result: resultStr,
        timestamp: Date.now(),
      }, ...prev.slice(0, 49)])

      setDisplay(resultStr)
      setExpression('')
      setJustEvaluated(true)
    } catch (_e) {
      setDisplay('Error')
    }
  }, [display, expression, mode, pBase])

  // ── Input handlers ────────────────────────────────────────────────────
  const inputDigit = useCallback((d: string) => {
    if (justEvaluated) { setDisplay(d); setJustEvaluated(false); return }
    setDisplay(prev => prev === '0' ? d : prev + d)
  }, [justEvaluated])

  const inputOperator = useCallback((op: string) => {
    // Normalize unicode operators to ASCII equivalents for evaluation
    const normalizedOp = op === '−' ? '-' : op
    setExpression(prev => prev + display + normalizedOp)
    setDisplay('0')
    setJustEvaluated(false)
  }, [display])

  const inputFunction = useCallback((fn: string) => {
    if (fn === '√') { setDisplay(prev => String(Math.sqrt(parseFloat(prev)))); setJustEvaluated(true); return }
    if (fn === '!') {
      const n = parseInt(display)
      let f = 1; for (let i = 2; i <= n; i++) f *= i
      setDisplay(String(f)); setJustEvaluated(true); return
    }
    if (fn === '%') { setDisplay(prev => String(parseFloat(prev) / 100)); setJustEvaluated(true); return }
    if (fn === '±') { setDisplay(prev => prev.startsWith('-') ? prev.slice(1) : '-' + prev); return }
    if (fn === 'π') { setDisplay(String(Math.PI)); setJustEvaluated(true); return }
    if (fn === 'e') { setDisplay(String(Math.E)); setJustEvaluated(true); return }
    // Trig / log
    const val = parseFloat(display)
    const fns: Record<string, (x: number) => number> = {
      sin: Math.sin, cos: Math.cos, tan: Math.tan,
      asin: Math.asin, acos: Math.acos, atan: Math.atan,
      log: Math.log10, ln: Math.log, exp: Math.exp,
      abs: Math.abs, ceil: Math.ceil, floor: Math.floor,
    }
    if (fns[fn]) {
      const r = fns[fn](val)
      setDisplay(String(Math.round(r * 1e12) / 1e12))
      setJustEvaluated(true)
    }
  }, [display])

  const clear = useCallback(() => { setDisplay('0'); setExpression(''); setJustEvaluated(false) }, [])
  const backspace = useCallback(() => {
    setDisplay(prev => prev.length <= 1 ? '0' : prev.slice(0, -1))
  }, [])

  const inputDot = useCallback(() => {
    if (justEvaluated) { setDisplay('0.'); setJustEvaluated(false); return }
    if (!display.includes('.')) setDisplay(prev => prev + '.')
  }, [display, justEvaluated])

  const copyResult = useCallback(() => {
    navigator.clipboard.writeText(display)
    toast.success('Copied to clipboard')
  }, [display])

  // ── AI query handler ──────────────────────────────────────────────────
  const askAI = useCallback(async (question?: string) => {
    const q = (question || aiQuery).trim()
    if (!q || aiLoading) return
    setAiLoading(true)
    setAiExplanation('')
    try {
      const res = await fetch('/api/calculator/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          context: { display, expression, mode },
        }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
        return
      }
      if (data.result && data.result !== 'N/A') {
        setDisplay(String(data.result))
        setJustEvaluated(true)
        setHistory(prev => [{
          expression: `🤖 ${q}`,
          result: String(data.result),
          timestamp: Date.now(),
        }, ...prev.slice(0, 49)])
      }
      if (data.explanation) {
        setAiExplanation(data.explanation)
      }
    } catch (_e) {
      toast.error('AI unavailable — use standard calculator')
    } finally {
      setAiLoading(false)
      setAiQuery('')
    }
  }, [aiQuery, aiLoading, display, expression, mode])

  // ── Programmer mode helpers ───────────────────────────────────────────
  function formatForBase(val: number, base: ProgrammerBase): string {
    const n = Math.round(val)
    switch (base) {
      case 'HEX': return '0x' + n.toString(16).toUpperCase()
      case 'OCT': return '0o' + n.toString(8)
      case 'BIN': return '0b' + n.toString(2)
      default: return String(n)
    }
  }

  function parseDisplay(): number {
    const d = display.replace(/,/g, '')
    if (d.startsWith('0x')) return parseInt(d, 16)
    if (d.startsWith('0o')) return parseInt(d, 8)
    if (d.startsWith('0b')) return parseInt(d, 2)
    return parseFloat(d)
  }

  const bitwiseOp = useCallback((op: string) => {
    const val = Math.round(parseDisplay())
    if (op === 'NOT') { setDisplay(formatForBase(~val, pBase)); setJustEvaluated(true); return }
    // AND, OR, XOR, LSH, RSH need second operand — use operator flow
    const opSymbol = op === 'AND' ? '&' : op === 'OR' ? '|' : op === 'XOR' ? '^' : op === 'LSH' ? '<<' : '>>'
    inputOperator(opSymbol)
  }, [pBase, inputOperator])

  // ── Keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if ('0123456789'.includes(e.key)) { inputDigit(e.key); e.preventDefault() }
      if (e.key === '.') { inputDot(); e.preventDefault() }
      if (e.key === '+') { inputOperator('+'); e.preventDefault() }
      if (e.key === '-') { inputOperator('-'); e.preventDefault() }
      if (e.key === '*') { inputOperator('×'); e.preventDefault() }
      if (e.key === '/') { inputOperator('÷'); e.preventDefault() }
      if (e.key === 'Enter' || e.key === '=') { evaluate(); e.preventDefault() }
      if (e.key === 'Backspace') { backspace(); e.preventDefault() }
      if (e.key === 'Escape') { clear(); e.preventDefault() }
      if (e.key === '%') { inputFunction('%'); e.preventDefault() }
      if (e.key === '(' || e.key === ')') { inputDigit(e.key); e.preventDefault() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [inputDigit, inputDot, inputOperator, evaluate, backspace, clear, inputFunction])

  // ── Button helper ─────────────────────────────────────────────────────
  const Btn = ({ label, onClick, cls = '', span = 1 }: {
    label: string; onClick: () => void; cls?: string; span?: number
  }) => (
    <button
      onClick={onClick}
      className={`${span > 1 ? 'col-span-2' : ''} h-10 rounded-lg text-sm font-medium transition-colors active:scale-95 ${cls}`}
    >
      {label}
    </button>
  )

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════

  return (
    <div ref={containerRef} tabIndex={0}
      className={`flex flex-col h-full bg-zinc-950 outline-none ${className}`}>
      {/* Mode tabs */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800/60 bg-zinc-900/50">
        {(['standard', 'scientific', 'programmer', 'ai'] as CalcMode[]).map(m => (
          <button key={m} onClick={() => { setMode(m); if (m !== 'ai') clear(); if (m === 'ai') setTimeout(() => aiInputRef.current?.focus(), 100) }}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 ${
              mode === m
                ? m === 'ai' ? 'bg-[#5EC9CC]/20 text-[#5EC9CC]' : 'bg-white/10 text-white'
                : 'text-zinc-500 hover:text-zinc-300'}`}>
            {m === 'ai' && <Sparkles className="w-3 h-3" />}
            {m === 'ai' ? 'AI' : m}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => setShowHistory(!showHistory)} className={`p-1 rounded transition-colors ${showHistory ? 'text-[#5EC9CC]' : 'text-zinc-600 hover:text-zinc-300'}`}>
          <History className="w-3.5 h-3.5" />
        </button>
        <button onClick={copyResult} className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors">
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Programmer base selector */}
      {mode === 'programmer' && (
        <div className="flex items-center gap-1 px-3 py-1 border-b border-zinc-800/40 bg-zinc-900/30">
          {(['DEC', 'HEX', 'OCT', 'BIN'] as ProgrammerBase[]).map(b => (
            <button key={b} onClick={() => { setPBase(b); setDisplay(formatForBase(parseDisplay(), b)) }}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                pBase === b ? 'bg-[#5EC9CC]/20 text-[#5EC9CC]' : 'text-zinc-600 hover:text-zinc-400'}`}>
              {b}
            </button>
          ))}
          <div className="flex-1" />
          <span className="text-[10px] text-zinc-700 font-mono">
            {(() => { const v = Math.round(parseDisplay()); return `D:${v} H:${v.toString(16).toUpperCase()} B:${v.toString(2)}` })()}
          </span>
        </div>
      )}

      {/* Display */}
      <div className="px-4 py-3 border-b border-zinc-800/40">
        {expression && <div className="text-right text-xs text-zinc-600 mb-1 truncate font-mono">{expression}</div>}
        <div className="text-right text-3xl font-bold text-white tabular-nums truncate font-mono tracking-tight">{display}</div>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="border-b border-zinc-800/40 bg-zinc-900/60 max-h-32 overflow-y-auto scrollbar-none">
          {history.length === 0 ? (
            <div className="py-4 text-center text-zinc-700 text-xs">No history yet</div>
          ) : (
            <div className="divide-y divide-zinc-800/20">
              {history.map((h, i) => (
                <button key={i} onClick={() => { setDisplay(h.result); setJustEvaluated(true) }}
                  className="w-full px-4 py-1.5 text-right hover:bg-white/5 transition-colors">
                  <div className="text-[10px] text-zinc-600 truncate">{h.expression}</div>
                  <div className="text-xs text-zinc-300 font-mono">{h.result}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Keypad */}
      <div className="flex-1 p-2 overflow-hidden flex flex-col">
        {mode === 'standard' && (
          <div className="grid grid-cols-4 gap-1 flex-1">
            <Btn label="C" onClick={clear} cls="bg-red-500/10 text-red-400 hover:bg-red-500/20" />
            <Btn label="±" onClick={() => inputFunction('±')} cls="bg-zinc-800 text-zinc-300 hover:bg-zinc-700" />
            <Btn label="%" onClick={() => inputFunction('%')} cls="bg-zinc-800 text-zinc-300 hover:bg-zinc-700" />
            <Btn label="÷" onClick={() => inputOperator('÷')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />

            <Btn label="7" onClick={() => inputDigit('7')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="8" onClick={() => inputDigit('8')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="9" onClick={() => inputDigit('9')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="×" onClick={() => inputOperator('×')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />

            <Btn label="4" onClick={() => inputDigit('4')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="5" onClick={() => inputDigit('5')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="6" onClick={() => inputDigit('6')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="−" onClick={() => inputOperator('-')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />

            <Btn label="1" onClick={() => inputDigit('1')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="2" onClick={() => inputDigit('2')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="3" onClick={() => inputDigit('3')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="+" onClick={() => inputOperator('+')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />

            <Btn label="0" onClick={() => inputDigit('0')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700 col-span-2" span={2} />
            <Btn label="." onClick={inputDot} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="=" onClick={evaluate} cls="bg-[#5EC9CC] text-[#050507] hover:bg-[#7AD6D8]" />
          </div>
        )}

        {mode === 'scientific' && (
          <div className="grid grid-cols-5 gap-1 flex-1">
            <Btn label="sin" onClick={() => inputFunction('sin')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />
            <Btn label="cos" onClick={() => inputFunction('cos')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />
            <Btn label="tan" onClick={() => inputFunction('tan')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />
            <Btn label="π" onClick={() => inputFunction('π')} cls="bg-zinc-800/40 text-[#5EC9CC] hover:bg-zinc-700" />
            <Btn label="e" onClick={() => inputFunction('e')} cls="bg-zinc-800/40 text-[#5EC9CC] hover:bg-zinc-700" />

            <Btn label="log" onClick={() => inputFunction('log')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />
            <Btn label="ln" onClick={() => inputFunction('ln')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />
            <Btn label="√" onClick={() => inputFunction('√')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700" />
            <Btn label="x²" onClick={() => { setDisplay(String(Math.pow(parseFloat(display), 2))); setJustEvaluated(true) }} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />
            <Btn label="xʸ" onClick={() => inputOperator('^')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />

            <Btn label="n!" onClick={() => inputFunction('!')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />
            <Btn label="(" onClick={() => inputDigit('(')} cls="bg-zinc-800/40 text-zinc-400 hover:bg-zinc-700" />
            <Btn label=")" onClick={() => inputDigit(')')} cls="bg-zinc-800/40 text-zinc-400 hover:bg-zinc-700" />
            <Btn label="C" onClick={clear} cls="bg-red-500/10 text-red-400 hover:bg-red-500/20" />
            <Btn label="⌫" onClick={backspace} cls="bg-zinc-800 text-zinc-300 hover:bg-zinc-700" />

            <Btn label="7" onClick={() => inputDigit('7')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="8" onClick={() => inputDigit('8')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="9" onClick={() => inputDigit('9')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="÷" onClick={() => inputOperator('÷')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />
            <Btn label="×" onClick={() => inputOperator('×')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />

            <Btn label="4" onClick={() => inputDigit('4')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="5" onClick={() => inputDigit('5')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="6" onClick={() => inputDigit('6')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="−" onClick={() => inputOperator('-')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />
            <Btn label="+" onClick={() => inputOperator('+')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />

            <Btn label="1" onClick={() => inputDigit('1')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="2" onClick={() => inputDigit('2')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="3" onClick={() => inputDigit('3')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="±" onClick={() => inputFunction('±')} cls="bg-zinc-800 text-zinc-300 hover:bg-zinc-700" />
            <Btn label="%" onClick={() => inputFunction('%')} cls="bg-zinc-800 text-zinc-300 hover:bg-zinc-700" />

            <Btn label="0" onClick={() => inputDigit('0')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700 col-span-2" span={2} />
            <Btn label="." onClick={inputDot} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="exp" onClick={() => inputFunction('exp')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />
            <Btn label="=" onClick={evaluate} cls="bg-[#5EC9CC] text-[#050507] hover:bg-[#7AD6D8]" />
          </div>
        )}

        {mode === 'programmer' && (
          <div className="grid grid-cols-4 gap-1 flex-1">
            <Btn label="AND" onClick={() => bitwiseOp('AND')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />
            <Btn label="OR" onClick={() => bitwiseOp('OR')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />
            <Btn label="XOR" onClick={() => bitwiseOp('XOR')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />
            <Btn label="NOT" onClick={() => bitwiseOp('NOT')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />

            <Btn label="LSH" onClick={() => bitwiseOp('LSH')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />
            <Btn label="RSH" onClick={() => bitwiseOp('RSH')} cls="bg-zinc-800/40 text-cyan-400 hover:bg-zinc-700 text-[11px]" />
            <Btn label="C" onClick={clear} cls="bg-red-500/10 text-red-400 hover:bg-red-500/20" />
            <Btn label="⌫" onClick={backspace} cls="bg-zinc-800 text-zinc-300 hover:bg-zinc-700" />

            <Btn label="A" onClick={() => inputDigit('A')} cls={`bg-zinc-800/40 hover:bg-zinc-700 ${pBase === 'HEX' ? 'text-[#5EC9CC]' : 'text-zinc-700'}`} />
            <Btn label="B" onClick={() => inputDigit('B')} cls={`bg-zinc-800/40 hover:bg-zinc-700 ${pBase === 'HEX' ? 'text-[#5EC9CC]' : 'text-zinc-700'}`} />
            <Btn label="C" onClick={() => inputDigit('C')} cls={`bg-zinc-800/40 hover:bg-zinc-700 ${pBase === 'HEX' ? 'text-[#5EC9CC]' : 'text-zinc-700'}`} />
            <Btn label="÷" onClick={() => inputOperator('÷')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />

            <Btn label="D" onClick={() => inputDigit('D')} cls={`bg-zinc-800/40 hover:bg-zinc-700 ${pBase === 'HEX' ? 'text-[#5EC9CC]' : 'text-zinc-700'}`} />
            <Btn label="E" onClick={() => inputDigit('E')} cls={`bg-zinc-800/40 hover:bg-zinc-700 ${pBase === 'HEX' ? 'text-[#5EC9CC]' : 'text-zinc-700'}`} />
            <Btn label="F" onClick={() => inputDigit('F')} cls={`bg-zinc-800/40 hover:bg-zinc-700 ${pBase === 'HEX' ? 'text-[#5EC9CC]' : 'text-zinc-700'}`} />
            <Btn label="×" onClick={() => inputOperator('×')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />

            <Btn label="7" onClick={() => inputDigit('7')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="8" onClick={() => inputDigit('8')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="9" onClick={() => inputDigit('9')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="−" onClick={() => inputOperator('-')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />

            <Btn label="4" onClick={() => inputDigit('4')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="5" onClick={() => inputDigit('5')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="6" onClick={() => inputDigit('6')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="+" onClick={() => inputOperator('+')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />

            <Btn label="1" onClick={() => inputDigit('1')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="2" onClick={() => inputDigit('2')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="3" onClick={() => inputDigit('3')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="=" onClick={evaluate} cls="bg-[#5EC9CC] text-[#050507] hover:bg-[#7AD6D8]" />

            <Btn label="0" onClick={() => inputDigit('0')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700 col-span-2" span={2} />
            <Btn label="." onClick={inputDot} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
            <Btn label="±" onClick={() => inputFunction('±')} cls="bg-zinc-800 text-zinc-300 hover:bg-zinc-700" />
          </div>
        )}

        {mode === 'ai' && (
          <div className="flex flex-col gap-2 flex-1 px-1">
            {/* AI Input */}
            <form onSubmit={(e) => { e.preventDefault(); askAI() }} className="flex items-center gap-1.5">
              <div className="flex-1 relative">
                <input
                  ref={aiInputRef}
                  type="text"
                  value={aiQuery}
                  onChange={(e) => setAiQuery(e.target.value)}
                  placeholder="Ask anything… e.g. 'what's 15% tip on $84.50?'"
                  className="w-full px-3 py-2 bg-zinc-800/60 border border-zinc-700/50 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-[#5EC9CC]/50 focus:ring-1 focus:ring-[#5EC9CC]/20"
                  disabled={aiLoading}
                />
              </div>
              <button
                type="submit"
                disabled={aiLoading || !aiQuery.trim()}
                className="p-2 rounded-lg bg-[#5EC9CC] text-[#050507] hover:bg-[#7AD6D8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </form>

            {/* AI Explanation */}
            {aiExplanation && (
              <div className="px-3 py-2 bg-[#5EC9CC]/10 border border-[#5EC9CC]/20 rounded-lg text-xs text-zinc-300 leading-relaxed">
                <div className="flex items-center gap-1.5 mb-1 text-[#5EC9CC] font-medium">
                  <Sparkles className="w-3 h-3" />
                  Explanation
                </div>
                {aiExplanation}
              </div>
            )}

            {/* Quick prompts */}
            <div className="flex flex-wrap gap-1 mt-1">
              {[
                'square root of ' + (display !== '0' ? display : '144'),
                display !== '0' ? `${display} in binary` : '255 in binary',
                '15% tip on $85',
                'convert 72°F to Celsius',
                'compound interest: $1000 at 5% for 3 years',
                display !== '0' ? `is ${display} prime?` : 'prime factors of 360',
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setAiQuery(q); askAI(q) }}
                  className="px-2 py-1 rounded-md bg-zinc-800/50 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors truncate max-w-[200px]"
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Standard keypad still available in AI mode */}
            <div className="grid grid-cols-4 gap-1 mt-auto">
              <Btn label="C" onClick={clear} cls="bg-red-500/10 text-red-400 hover:bg-red-500/20" />
              <Btn label="±" onClick={() => inputFunction('±')} cls="bg-zinc-800 text-zinc-300 hover:bg-zinc-700" />
              <Btn label="%" onClick={() => inputFunction('%')} cls="bg-zinc-800 text-zinc-300 hover:bg-zinc-700" />
              <Btn label="÷" onClick={() => inputOperator('÷')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />
              <Btn label="7" onClick={() => inputDigit('7')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
              <Btn label="8" onClick={() => inputDigit('8')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
              <Btn label="9" onClick={() => inputDigit('9')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
              <Btn label="×" onClick={() => inputOperator('×')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />
              <Btn label="4" onClick={() => inputDigit('4')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
              <Btn label="5" onClick={() => inputDigit('5')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
              <Btn label="6" onClick={() => inputDigit('6')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
              <Btn label="−" onClick={() => inputOperator('-')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />
              <Btn label="1" onClick={() => inputDigit('1')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
              <Btn label="2" onClick={() => inputDigit('2')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
              <Btn label="3" onClick={() => inputDigit('3')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
              <Btn label="+" onClick={() => inputOperator('+')} cls="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20" />
              <Btn label="0" onClick={() => inputDigit('0')} cls="bg-zinc-800/60 text-white hover:bg-zinc-700 col-span-2" span={2} />
              <Btn label="." onClick={inputDot} cls="bg-zinc-800/60 text-white hover:bg-zinc-700" />
              <Btn label="=" onClick={evaluate} cls="bg-[#5EC9CC] text-[#050507] hover:bg-[#7AD6D8]" />
            </div>
          </div>
        )}
      </div>

      {/* Memory bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-t border-zinc-800/40 bg-zinc-900/30 text-[10px]">
        <button onClick={() => setMemory(parseFloat(display) || 0)} className="px-1.5 py-0.5 text-zinc-600 hover:text-zinc-300 rounded hover:bg-white/5">MS</button>
        <button onClick={() => { setDisplay(String(memory)); setJustEvaluated(true) }} className="px-1.5 py-0.5 text-zinc-600 hover:text-zinc-300 rounded hover:bg-white/5">MR</button>
        <button onClick={() => setMemory(prev => prev + (parseFloat(display) || 0))} className="px-1.5 py-0.5 text-zinc-600 hover:text-zinc-300 rounded hover:bg-white/5">M+</button>
        <button onClick={() => setMemory(prev => prev - (parseFloat(display) || 0))} className="px-1.5 py-0.5 text-zinc-600 hover:text-zinc-300 rounded hover:bg-white/5">M-</button>
        <button onClick={() => setMemory(0)} className="px-1.5 py-0.5 text-zinc-600 hover:text-zinc-300 rounded hover:bg-white/5">MC</button>
        {memory !== 0 && <span className="text-zinc-600 ml-1">M={memory}</span>}
      </div>
    </div>
  )
}
