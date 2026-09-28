'use client'

/**
 * ProvisionPanel — the company.yaml editor (.PRODUCTS/.PROVISION, layer 5).
 *
 * One config provisions the company: edit the company and its agents, get the
 * company.yaml to commit and the exact per-agent `adk up` plan. Runs entirely
 * in the browser — nothing is provisioned from here. The mapping mirrors the
 * ADK composer (`adk/shell/plugins/builtins/provision.py`), whose tests parse
 * every emitted command with the real `adk` parser: `reach: offline` becomes
 * `--offline`, never `--reach offline`.
 */

import React, { useMemo, useState } from 'react'
import { Building2, Plus, Trash2, Copy, AlertCircle } from 'lucide-react'

export const REACH_CHOICES = ['tunnel', 'mesh', 'offline'] as const
export const CLOUD_MODES = ['local_first', 'cloud_first', 'cloud_only'] as const
export const MODELS = ['gateway', 'local', 'deepseek', 'openai', 'anthropic'] as const

export type Reach = (typeof REACH_CHOICES)[number]
export type CloudMode = (typeof CLOUD_MODES)[number]
export type Model = (typeof MODELS)[number]

export interface CompanyAgent {
  identity: string
  name: string
  port: number
  reach: Reach
  model: Model
  approve: string
  /** -> adk up --brain-pack (file or dir); empty = adk's ./brain_pack.yaml */
  brainPack?: string
}

export interface CompanyConfig {
  name: string
  tenant: string
  portal: string
  cloudMode: CloudMode
  agents: CompanyAgent[]
}

export interface ProvisionPanelProps {
  className?: string
  initial?: CompanyConfig
}

const DEFAULT_CONFIG: CompanyConfig = {
  name: 'Acme',
  tenant: 'acme',
  portal: '',
  cloudMode: 'local_first',
  agents: [
    { identity: 'aither', name: 'acme-exec', port: 8080, reach: 'tunnel', model: 'gateway', approve: 'file_write,shell_exec' },
  ],
}

const slug = (s: string) => s.trim().toLowerCase().split(/\s+/).filter(Boolean).join('-') || 'company'
const q = (s: string) => (/^[A-Za-z0-9_./:,@=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)
const yq = (s: string) => JSON.stringify(s)

/** Schema problems; mirrors validate() in the ADK composer. */
export function validateCompany(cfg: CompanyConfig): string[] {
  const errors: string[] = []
  if (!cfg.agents.length) errors.push('add at least one agent')
  // tenant is never sent: agents register under the signed-in account's tenant
  const tenant = cfg.tenant.trim()
  if (tenant && !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(tenant)) errors.push("tenant must be a slug (a-z, 0-9, '-')")
  const ports = new Map<number, number>()
  const names = new Map<string, number>()
  cfg.agents.forEach((a, i) => {
    if (!a.identity.trim()) errors.push(`agent ${i + 1}: identity is required`)
    if (!Number.isInteger(a.port) || a.port < 1024 || a.port > 65535) errors.push(`agent ${i + 1}: port must be 1024..65535`)
    else if (ports.has(a.port)) errors.push(`agent ${i + 1}: port ${a.port} already used by agent ${ports.get(a.port)! + 1}`)
    else ports.set(a.port, i)
    const n = a.name.trim()
    if (n && names.has(n)) errors.push(`agent ${i + 1}: name '${n}' already used by agent ${names.get(n)! + 1}`)
    else if (n) names.set(n, i)
  })
  return errors
}

/** The exact `adk up` argv per agent; mirrors build_plan() in the ADK composer. */
export function buildPlan(cfg: CompanyConfig): { name: string; env: Record<string, string>; cmd: string[] }[] {
  return cfg.agents.map((a) => {
    const identity = a.identity.trim()
    const name = a.name.trim() || `${slug(cfg.name)}-${identity}`
    const cmd = ['adk', 'up', '--identity', identity, '--name', name, '--port', String(a.port)]
    const brainPack = (a.brainPack || '').trim()
    if (brainPack) cmd.push('--brain-pack', brainPack)
    const env: Record<string, string> = { AITHER_CLOUD_MODE: cfg.cloudMode }
    if (a.reach === 'offline') {
      cmd.push('--offline')
      env.AITHER_OFFLINE = '1'
    } else {
      cmd.push('--reach', a.reach)
      if (cfg.portal.trim()) cmd.push('--portal', cfg.portal.trim())
    }
    if (a.model !== 'gateway' && a.model !== 'local') cmd.push('--provider', a.model)
    const approve = a.approve.split(',').map((s) => s.trim()).filter(Boolean).join(',')
    if (approve) cmd.push('--approve', approve)
    return { name, env, cmd }
  })
}

/** company.yaml text for the config (every scalar JSON-quoted, which YAML reads as a string). */
export function toCompanyYaml(cfg: CompanyConfig): string {
  const lines = ['company:', `  name: ${yq(cfg.name)}`]
  if (cfg.tenant.trim()) lines.push(`  tenant: ${yq(cfg.tenant.trim())}`)
  if (cfg.portal.trim()) lines.push(`  portal: ${yq(cfg.portal.trim())}`)
  lines.push(`  cloud_mode: ${cfg.cloudMode}`, '  agents:')
  for (const a of cfg.agents) {
    lines.push(`    - identity: ${yq(a.identity.trim())}`)
    if (a.name.trim()) lines.push(`      name: ${yq(a.name.trim())}`)
    if ((a.brainPack || '').trim()) lines.push(`      brain_pack: ${yq((a.brainPack || '').trim())}`)
    lines.push(`      port: ${a.port}`, `      reach: ${a.reach}`, `      model: ${a.model}`)
    const approve = a.approve.split(',').map((s) => s.trim()).filter(Boolean)
    if (approve.length) lines.push(`      approve: [${approve.map(yq).join(', ')}]`)
  }
  return lines.join('\n') + '\n'
}

const input = 'bg-slate-800/50 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-cyan-500'

export default function ProvisionPanel({ className = '', initial = DEFAULT_CONFIG }: ProvisionPanelProps) {
  const [cfg, setCfg] = useState<CompanyConfig>(initial)
  const [tab, setTab] = useState<'plan' | 'yaml'>('plan')
  const errors = useMemo(() => validateCompany(cfg), [cfg])
  const plan = useMemo(() => (errors.length ? [] : buildPlan(cfg)), [cfg, errors])
  const yaml = useMemo(() => toCompanyYaml(cfg), [cfg])

  const setAgent = (i: number, patch: Partial<CompanyAgent>) =>
    setCfg((c) => ({ ...c, agents: c.agents.map((a, j) => (j === i ? { ...a, ...patch } : a)) }))
  const addAgent = () =>
    setCfg((c) => {
      const port = Math.max(8079, ...c.agents.map((a) => a.port)) + 1
      return { ...c, agents: [...c.agents, { identity: 'aither', name: '', port, reach: 'tunnel', model: 'gateway', approve: '' }] }
    })
  const removeAgent = (i: number) => setCfg((c) => ({ ...c, agents: c.agents.filter((_, j) => j !== i) }))
  const copy = (text: string) => { void navigator.clipboard?.writeText(text) }

  const planText = plan
    .map((p) => `${Object.entries(p.env).map(([k, v]) => `${k}=${v}`).join(' ')} ${p.cmd.map(q).join(' ')} --yes`)
    .join('\n')

  return (
    <div className={`bg-slate-900/60 backdrop-blur-xl border border-cyan-500/20 rounded-lg flex flex-col ${className}`}>
      <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
        <Building2 className="w-5 h-5 text-cyan-400" />
        <h3 className="text-lg font-medium text-slate-100">Company Provisioning</h3>
        <span className="text-xs text-slate-500 ml-auto">one company.yaml → every agent</span>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-400">Company<input className={`${input} w-full`} value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} /></label>
          <label className="text-xs text-slate-400">Tenant<input className={`${input} w-full`} value={cfg.tenant} onChange={(e) => setCfg({ ...cfg, tenant: e.target.value })} /></label>
          <label className="text-xs text-slate-400">Portal URL<input className={`${input} w-full`} placeholder="adk default" value={cfg.portal} onChange={(e) => setCfg({ ...cfg, portal: e.target.value })} /></label>
          <label className="text-xs text-slate-400">Cloud mode
            <select className={`${input} w-full`} value={cfg.cloudMode} onChange={(e) => setCfg({ ...cfg, cloudMode: e.target.value as CloudMode })}>
              {CLOUD_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>

        <div className="space-y-2">
          {cfg.agents.map((a, i) => (
            <div key={i} className="grid grid-cols-8 gap-1 items-center">
              <input aria-label="identity" className={input} value={a.identity} onChange={(e) => setAgent(i, { identity: e.target.value })} />
              <input aria-label="name" className={input} placeholder="auto" value={a.name} onChange={(e) => setAgent(i, { name: e.target.value })} />
              <input aria-label="brain pack" className={input} placeholder="brain pack (opt.)" value={a.brainPack || ''} onChange={(e) => setAgent(i, { brainPack: e.target.value })} />
              <input aria-label="port" className={input} type="number" value={a.port} onChange={(e) => setAgent(i, { port: Number(e.target.value) })} />
              <select aria-label="reach" className={input} value={a.reach} onChange={(e) => setAgent(i, { reach: e.target.value as Reach })}>
                {REACH_CHOICES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <select aria-label="model" className={input} value={a.model} onChange={(e) => setAgent(i, { model: e.target.value as Model })}>
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input aria-label="approve" className={input} placeholder="approve: file_write,…" value={a.approve} onChange={(e) => setAgent(i, { approve: e.target.value })} />
              <button aria-label="remove agent" className="text-slate-400 hover:text-red-400 justify-self-center" onClick={() => removeAgent(i)}><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button className="text-sm text-cyan-400 hover:text-cyan-300 flex items-center gap-1" onClick={addAgent}><Plus className="w-4 h-4" />Add agent</button>
        </div>

        {errors.length > 0 && (
          <ul className="text-sm text-red-300 space-y-1">
            {errors.map((e) => <li key={e} className="flex gap-1"><AlertCircle className="w-4 h-4 shrink-0" />{e}</li>)}
          </ul>
        )}

        <div className="flex gap-2 border-b border-slate-700 pb-2">
          {(['plan', 'yaml'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1 text-sm rounded ${tab === t ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-slate-400 hover:text-slate-300'}`}>
              {t === 'plan' ? 'adk up plan' : 'company.yaml'}
            </button>
          ))}
          <button className="ml-auto text-slate-400 hover:text-slate-200" aria-label="copy" onClick={() => copy(tab === 'plan' ? planText : yaml)}><Copy className="w-4 h-4" /></button>
        </div>
        <pre className="text-xs text-slate-200 bg-slate-950/60 rounded p-3 overflow-auto whitespace-pre-wrap">
          {tab === 'plan' ? (planText || '# fix the problems above to see the plan') : yaml}
        </pre>
        <p className="text-xs text-slate-500">
          Nothing is provisioned from this panel. Save the YAML, then run <code>python provision_company.py --apply</code>
          {' '}or paste each command on the machine that should host the agent.
        </p>
      </div>
    </div>
  )
}
