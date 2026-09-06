/**
 * On-device AI panel — a model running entirely in the visitor's browser
 * (WebGPU), summoned beside the room conversation with `/local`.
 *
 * Light queries cost ZERO server compute and keep working offline. Additive
 * by design: it never touches the app's main (server-backed) chat. The host
 * app supplies `workerFactory` because a Worker URL must be resolved by the
 * consumer's bundler (`new Worker(new URL('./webgpu-worker.ts',
 * import.meta.url))`); portal-kit ships the worker core, not the entry.
 */
import { useState } from 'react'
import {
  WebGPUChat,
  isWebGPUAvailable,
  readyWebMLModels,
  type WebMLTools,
} from '../webml'
import {
  BONSAI_MODELS_INFO,
  DEFAULT_BONSAI_MODEL_ID,
  suggestBonsaiModelId,
} from '../webml/bonsai-models'
import Tooltip from '../ui/Tooltip'

export interface OnDevicePanelProps {
  /** Builds the WebML worker; bundler-specific, so the host app owns it. */
  workerFactory: () => Worker
  /** System prompt for the local model. Keep it honest about its limits. */
  system?: string
  /** Host-side tools (e.g. a local knowledge-base search) the model may call. */
  tools?: WebMLTools
  /** Shown when WebGPU is unavailable in this browser. */
  appName?: string
}

export default function OnDevicePanel({
  workerFactory,
  system,
  tools,
  appName = 'this app',
}: OnDevicePanelProps) {
  const readyModels = readyWebMLModels()
  // Size the FIRST-USE download to the visitor's device.
  //
  // This is the SHARED panel, so it is the copy every portal product renders —
  // which makes a fixed default the most expensive version of this bug. It used
  // DEFAULT_WEBML_MODEL_ID, which is 'bonsai-27b-text': a 3.6 GB download
  // attempted on first use by every visitor, phones included. The panel then
  // sits there loading and reads as broken rather than as downloading, so the
  // symptom never points at the cause.
  //
  // suggestBonsaiModelId() already held the policy (Data Saver and 2G -> 236 MB
  // 1.7B; mobile -> 4B or 1.7B by deviceMemory; roomy desktop -> 8B) and was
  // called from nowhere. It is a SUGGESTION — the picker below still wins.
  const suggested = suggestBonsaiModelId()
  const [selectedModelId, setSelectedModelId] = useState(
    readyModels.find((m) => m.id === suggested)?.id
      || readyModels.find((m) => m.id === DEFAULT_BONSAI_MODEL_ID)?.id
      || readyModels[0]?.id,
  )

  if (typeof navigator !== 'undefined' && !isWebGPUAvailable()) {
    return (
      <div style={{ padding: 16, fontSize: 13, opacity: 0.75 }}>
        This browser has no WebGPU, so {appName} cannot run a model on your
        device. The main chat still works — it answers from the server.
      </div>
    )
  }

  const selectedBonsai = BONSAI_MODELS_INFO.find((m) => m.id === selectedModelId)
  const selectedModel = readyModels.find((m) => m.id === selectedModelId)

  return (
    <div style={{ padding: 12 }} data-tour="on-device">
      <div style={{ marginBottom: 10 }}>
        <Tooltip label="A small model runs entirely in this browser (WebGPU) — private, free, works offline; the server never sees it">
          <label
            htmlFor="on-device-model"
            style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, opacity: 0.8 }}
          >
            Model — runs in your browser, weights download once
          </label>
        </Tooltip>
        <select
          id="on-device-model"
          value={selectedModelId}
          onChange={(e) => setSelectedModelId(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: 12,
            borderRadius: 6,
            border: '1px solid rgba(0,0,0,0.15)',
            cursor: 'pointer',
          }}
        >
          {readyModels.map((model) => {
            const bonsai = BONSAI_MODELS_INFO.find((b) => b.id === model.id)
            return (
              <option key={model.id} value={model.id}>
                {model.label}
                {bonsai ? ` (${bonsai.sizeMb} MB)` : ''}
              </option>
            )
          })}
        </select>
        {(selectedBonsai?.blurb || selectedModel?.blurb) && (
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7, fontStyle: 'italic' }}>
            {selectedBonsai?.blurb || selectedModel?.blurb}
          </div>
        )}
      </div>

      <WebGPUChat
        key={selectedModelId}
        workerFactory={workerFactory}
        modelId={selectedModelId}
        system={system}
        tools={tools}
      />
    </div>
  )
}
