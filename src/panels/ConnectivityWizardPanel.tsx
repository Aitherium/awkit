'use client'

/**
 * ConnectivityWizardPanel — the Academy self-host connectivity wizard
 * (`/api/v1/academy/connectivity/wizard/*`).
 *
 * Path selection → step forms with the server's validation errors → pre-flight
 * check (the teacher reports what their machine has; Genesis cannot probe it) →
 * the exact commands to run, with a copy button. Genesis never executes anything
 * on the teacher's host, so there is no deployment log to tail: the panel says
 * so rather than showing a fake stream.
 */

import { useState } from 'react'
import { ACADEMY_API, academyFetch } from './academyApi'

type WizardPath = 'adk' | 'awnode' | 'tunnel'

interface WizardStepDef {
  id: string
  title: string
  required: string[]
}

interface WizardState {
  session_id: string
  path: WizardPath
  status: string
  step_index: number
  steps: WizardStepDef[]
  next_step: WizardStepDef | null
  data: Record<string, unknown>
  validation_ok?: boolean
  errors?: string[]
}

interface Readiness {
  ready: boolean
  missing_tools: string[]
  fix_steps: string[]
}

interface DeployResult {
  status: string
  commands: string[]
  note: string
}

export interface ConnectivityWizardPanelProps {
  apiBase?: string
}

const PATHS: { id: WizardPath; title: string; blurb: string }[] = [
  { id: 'adk', title: 'Local agent (adk)', blurb: 'Run Academy with the Python ADK on this machine.' },
  { id: 'awnode', title: 'Mesh node (awnode)', blurb: 'Join a Docker/Podman node to your workspace mesh.' },
  { id: 'tunnel', title: 'Tunnel (awtunnel)', blurb: 'Expose a local Academy port with no inbound firewall rules.' },
]

const FIELD_LABELS: Record<string, string> = {
  workspace_name: 'Workspace name',
  node_name: 'Node name',
  port: 'Local port',
}

export default function ConnectivityWizardPanel({ apiBase = ACADEMY_API }: ConnectivityWizardPanelProps) {
  const [path, setPath] = useState<WizardPath>('adk')
  const [wiz, setWiz] = useState<WizardState | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [env, setEnv] = useState({ python_version: '', git: false, docker: false })
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [deploy, setDeploy] = useState<DeployResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const start = () =>
    run(async () => {
      const s = await academyFetch<WizardState>(apiBase, '/connectivity/wizard/start', {
        method: 'POST',
        body: JSON.stringify({ path }),
      })
      setWiz(s)
      setFields({})
      setReadiness(null)
      setDeploy(null)
    })

  const submitStep = () =>
    run(async () => {
      if (!wiz) return
      const s = await academyFetch<WizardState>(
        apiBase,
        `/connectivity/wizard/${encodeURIComponent(wiz.session_id)}/step`,
        { method: 'POST', body: JSON.stringify({ step_index: wiz.step_index, step_data: fields }) },
      )
      setWiz(s)
      if (s.validation_ok) setFields({})
    })

  const preflight = () =>
    run(async () => {
      if (!wiz) return
      setReadiness(
        await academyFetch<Readiness>(
          apiBase,
          `/connectivity/wizard/${encodeURIComponent(wiz.session_id)}/validate-env`,
          { method: 'POST', body: JSON.stringify({ ...env, python_version: env.python_version || null }) },
        ),
      )
    })

  const finish = () =>
    run(async () => {
      if (!wiz) return
      setDeploy(
        await academyFetch<DeployResult>(
          apiBase,
          `/connectivity/wizard/${encodeURIComponent(wiz.session_id)}/deploy`,
          { method: 'POST' },
        ),
      )
    })

  const copy = async () => {
    if (!deploy) return
    try {
      await navigator.clipboard.writeText(deploy.commands.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Clipboard unavailable — select the commands and copy them manually.')
    }
  }

  const step = wiz?.next_step ?? null
  const done = !!wiz && wiz.step_index >= wiz.steps.length

  return (
    <div className="p-4 space-y-4">
      <header>
        <h2 className="text-lg font-semibold">Connect Your Own Machine</h2>
        <p className="text-sm text-gray-500">
          Host Academy yourself. You get the exact commands; nothing runs on your machine without you.
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="text-sm font-semibold">1. Choose a path</legend>
        {PATHS.map((p) => (
          <label key={p.id} className="flex items-start gap-2 text-sm">
            <input type="radio" name="wizard-path" checked={path === p.id} onChange={() => setPath(p.id)} />
            <span>
              <span className="font-medium">{p.title}</span>
              <span className="block text-xs text-gray-500">{p.blurb}</span>
            </span>
          </label>
        ))}
        <button type="button" onClick={() => void start()} className="rounded border px-3 py-1 text-sm hover:bg-gray-50">
          {wiz ? 'Restart wizard' : 'Start'}
        </button>
      </fieldset>

      {wiz && (
        <>
          <ol className="flex flex-wrap gap-2 text-xs">
            {wiz.steps.map((s, i) => (
              <li
                key={s.id}
                className={`rounded px-2 py-1 ${
                  i < wiz.step_index ? 'bg-emerald-100 text-emerald-800'
                    : i === wiz.step_index ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {i + 1}. {s.title}
              </li>
            ))}
          </ol>

          {step && (
            <section className="space-y-2 rounded border p-3">
              <h3 className="text-sm font-semibold">{step.title}</h3>
              {step.required.map((k) => (
                <label key={k} className="block text-sm">
                  {FIELD_LABELS[k] || k}
                  <input
                    value={fields[k] || ''}
                    onChange={(e) => setFields({ ...fields, [k]: e.target.value })}
                    className="mt-1 block w-full rounded border px-2 py-1"
                  />
                </label>
              ))}
              {wiz.errors && wiz.errors.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-red-700">
                  {wiz.errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitStep()}
                className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
              >
                Continue
              </button>
            </section>
          )}

          <section className="space-y-2 rounded border p-3">
            <h3 className="text-sm font-semibold">Pre-flight check</h3>
            <p className="text-xs text-gray-500">Tell us what this machine has — the server cannot look.</p>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label>
                Python version{' '}
                <input
                  value={env.python_version}
                  onChange={(e) => setEnv({ ...env, python_version: e.target.value })}
                  placeholder="3.12"
                  className="w-20 rounded border px-2 py-1"
                />
              </label>
              <label><input type="checkbox" checked={env.git} onChange={(e) => setEnv({ ...env, git: e.target.checked })} /> git</label>
              <label><input type="checkbox" checked={env.docker} onChange={(e) => setEnv({ ...env, docker: e.target.checked })} /> Docker/Podman</label>
              <button type="button" disabled={busy} onClick={() => void preflight()} className="rounded border px-3 py-1 hover:bg-gray-50">
                Check
              </button>
            </div>
            {readiness && (
              readiness.ready ? (
                <p className="text-sm text-emerald-700">Ready.</p>
              ) : (
                <div className="text-sm text-amber-800">
                  Missing: {readiness.missing_tools.join(', ')}
                  <ul className="list-disc pl-5 text-xs">
                    {readiness.fix_steps.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                </div>
              )
            )}
          </section>

          {done && (
            <section className="space-y-2 rounded border p-3">
              <h3 className="text-sm font-semibold">Deploy</h3>
              <button type="button" disabled={busy} onClick={() => void finish()} className="rounded border px-3 py-1 text-sm hover:bg-gray-50">
                Get my commands
              </button>
              {deploy && (
                <>
                  <pre className="overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">
                    {deploy.commands.join('\n')}
                  </pre>
                  <button type="button" onClick={() => void copy()} className="rounded border px-3 py-1 text-sm hover:bg-gray-50">
                    {copied ? 'Copied' : 'Copy commands'}
                  </button>
                  <p className="text-xs text-gray-500">{deploy.note}</p>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
