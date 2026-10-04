/**
 * PersonaPlex WebSocket Client
 * ============================
 * 
 * TypeScript client for full-duplex voice conversations with PersonaPlex/Moshi.
 * Handles WebSocket connection, audio streaming, and response handling.
 * 
 * Features:
 * - WebSocket connection to PersonaPlex (port 8089)
 * - Audio chunk streaming (base64-encoded WAV, 24kHz)
 * - Persona configuration (voice presets, text prompts)
 * - Audio response playback
 * - Auto-reconnection with exponential backoff
 */

// ============================================================================
// TYPES
// ============================================================================

export type PersonaPlexVoice = 
  | 'NATF0' | 'NATF1' | 'NATF2' | 'NATF3'  // Natural Female
  | 'NATM0' | 'NATM1' | 'NATM2' | 'NATM3'  // Natural Male
  | 'VARF0' | 'VARF1' | 'VARF2' | 'VARF3' | 'VARF4'  // Variety Female
  | 'VARM0' | 'VARM1' | 'VARM2' | 'VARM3' | 'VARM4'  // Variety Male

/** A workspace custom voice (Genesis /voice-builds/voices), id `custom:<name>`. */
export type CustomVoiceId = `custom:${string}`

/** The Aither voice synthesised on-device (awkit/webml/tts), id `local:aither`. */
export type LocalVoiceId = 'local:aither'

/** What the voice picker stores: a PersonaPlex preset, a custom voice, or the on-device Aither voice. */
export type SelectedVoice = PersonaPlexVoice | CustomVoiceId | LocalVoiceId

export type VoiceMode = 'ptt' | 'vad' | 'continuous'  // Push-to-talk, Voice Activity Detection, Continuous

export interface PersonaConfig {
  voice: PersonaPlexVoice
  textPrompt: string
  mode?: VoiceMode
}

export interface VoiceSettings {
  voice: SelectedVoice
  mode: VoiceMode
  inputDeviceId: string | null
  outputDeviceId: string | null
  inputVolume: number  // 0.0 - 1.0
  outputVolume: number // 0.0 - 1.0
  vadSensitivity: number // 0.0 - 1.0 (for VAD mode)
  autoPlayResponses: boolean
  showTranscripts: boolean
  stopListeningWhileSpeaking: boolean
  useBrowserSTT: boolean
}

export interface AudioDevice {
  deviceId: string
  label: string
  kind: 'audioinput' | 'audiooutput'
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting'

export interface PersonaPlexMessage {
  type: 'connected' | 'config_updated' | 'audio' | 'text' | 'pong' | 'error' | 'end_turn'
  session_id?: string
  voices?: PersonaPlexVoice[]
  persona?: PersonaConfig
  data?: string  // Base64 audio
  content?: string  // Text transcript
  full_response?: string
  error?: string
}

export interface PersonaPlexCallbacks {
  onConnected?: (sessionId: string, voices: PersonaPlexVoice[]) => void
  onConfigured?: (persona: PersonaConfig) => void
  onAudioResponse?: (audioData: ArrayBuffer, mimeType: string) => void
  onTranscript?: (text: string, isFinal: boolean) => void
  onError?: (error: string) => void
  onStateChange?: (state: ConnectionState) => void
  onTurnEnd?: () => void
}

// ============================================================================
// DEFAULT SETTINGS
// ============================================================================

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  voice: 'NATF2',
  mode: 'ptt',
  inputDeviceId: null,
  outputDeviceId: null,
  inputVolume: 1.0,
  outputVolume: 1.0,
  vadSensitivity: 0.5,
  autoPlayResponses: true,
  showTranscripts: true,
  stopListeningWhileSpeaking: true,
  useBrowserSTT: false,
}

const STORAGE_KEY = 'aither_voice_settings'

// ============================================================================
// SETTINGS PERSISTENCE
// ============================================================================

export function loadVoiceSettings(): VoiceSettings {
  if (typeof window === 'undefined') return DEFAULT_VOICE_SETTINGS
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return { ...DEFAULT_VOICE_SETTINGS, ...parsed }
    }
  } catch (e) {
    console.warn('Failed to load voice settings:', e)
  }
  return DEFAULT_VOICE_SETTINGS
}

export function saveVoiceSettings(settings: Partial<VoiceSettings>): VoiceSettings {
  if (typeof window === 'undefined') return DEFAULT_VOICE_SETTINGS
  
  const current = loadVoiceSettings()
  const updated = { ...current, ...settings }
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch (e) {
    console.warn('Failed to save voice settings:', e)
  }
  
  return updated
}

// ============================================================================
// AUDIO DEVICE ENUMERATION
// ============================================================================

export async function getAudioDevices(): Promise<{
  inputs: AudioDevice[]
  outputs: AudioDevice[]
}> {
  try {
    // Request permission first
    await navigator.mediaDevices.getUserMedia({ audio: true })
    
    const devices = await navigator.mediaDevices.enumerateDevices()
    
    const inputs: AudioDevice[] = devices
      .filter(d => d.kind === 'audioinput')
      .map(d => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
        kind: 'audioinput' as const,
      }))
    
    const outputs: AudioDevice[] = devices
      .filter(d => d.kind === 'audiooutput')
      .map(d => ({
        deviceId: d.deviceId,
        label: d.label || `Speaker ${d.deviceId.slice(0, 8)}`,
        kind: 'audiooutput' as const,
      }))
    
    return { inputs, outputs }
  } catch (e) {
    console.error('Failed to enumerate audio devices:', e)
    return { inputs: [], outputs: [] }
  }
}

// ============================================================================
// PERSONAPLEX CLIENT
// ============================================================================

export class PersonaPlexClient {
  private ws: WebSocket | null = null
  private sessionId: string | null = null
  private callbacks: PersonaPlexCallbacks = {}
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectTimeout: NodeJS.Timeout | null = null
  private pingInterval: NodeJS.Timeout | null = null
  private state: ConnectionState = 'disconnected'
  
  // Audio playback
  private audioContext: AudioContext | null = null
  private audioQueue: ArrayBuffer[] = []
  private isPlaying = false
  private outputDeviceId: string | null = null
  private outputVolume = 1.0
  
  // Service URL
  private baseUrl: string
  
  // Idle timeout (lazy connect - disconnect after 60s of inactivity)
  private idleTimeout: NodeJS.Timeout | null = null
  private readonly IDLE_TIMEOUT_MS = 60000  // 60 seconds
  private lastActivityTime = 0
  
  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || '/api/bridge/persona'
  }
  
  // ===========================================================================
  // IDLE TIMEOUT MANAGEMENT (Lazy connect, disconnect after 60s idle)
  // ===========================================================================
  
  private resetIdleTimer(): void {
    this.lastActivityTime = Date.now()
    
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout)
    }
    
    this.idleTimeout = setTimeout(() => {
      if (this.state === 'connected') {
        console.log('[PersonaPlex] Idle timeout - disconnecting')
        this.disconnect()
      }
    }, this.IDLE_TIMEOUT_MS)
  }
  
  private clearIdleTimer(): void {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout)
      this.idleTimeout = null
    }
  }
  
  /**
   * Lazy connect - only connect when needed, with auto-disconnect on idle
   */
  async ensureConnected(callbacks?: PersonaPlexCallbacks): Promise<void> {
    if (this.isConnected) {
      this.resetIdleTimer()
      if (callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks }
      }
      return
    }
    
    await this.connect(callbacks || this.callbacks)
    this.resetIdleTimer()
  }
  
  // ===========================================================================
  // CONNECTION MANAGEMENT
  // ===========================================================================
  
  async connect(callbacks: PersonaPlexCallbacks = {}): Promise<void> {
    this.callbacks = callbacks
    this.setState('connecting')
    
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.baseUrl.replace('http', 'ws') + '/ws/conversation'
        this.ws = new WebSocket(wsUrl)
        
        this.ws.onopen = () => {
          console.log('[PersonaPlex] WebSocket connected')
          this.reconnectAttempts = 0
          this.startPingInterval()
        }
        
        this.ws.onmessage = (event) => {
          this.handleMessage(event.data)
        }
        
        this.ws.onerror = (error) => {
          console.error('[PersonaPlex] WebSocket error:', error)
          this.callbacks.onError?.('WebSocket connection error')
        }
        
        this.ws.onclose = (event) => {
          console.log('[PersonaPlex] WebSocket closed:', event.code, event.reason)
          this.stopPingInterval()
          
          if (this.state !== 'disconnected') {
            this.scheduleReconnect()
          }
        }
        
        // Resolve when connected message is received (see handleMessage)
        const timeout = setTimeout(() => {
          if (this.state === 'connecting') {
            reject(new Error('Connection timeout'))
            this.disconnect()
          }
        }, 10000)
        
        // Store resolve/reject for handleMessage to use
        ;(this as any)._connectResolve = () => {
          clearTimeout(timeout)
          resolve()
        }
        ;(this as any)._connectReject = (err: Error) => {
          clearTimeout(timeout)
          reject(err)
        }
        
      } catch (error) {
        this.setState('error')
        reject(error)
      }
    })
  }
  
  disconnect(): void {
    this.setState('disconnected')
    this.stopPingInterval()
    this.clearIdleTimer()
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect')
      this.ws = null
    }
    
    this.sessionId = null
  }
  
  private setState(state: ConnectionState): void {
    this.state = state
    this.callbacks.onStateChange?.(state)
  }
  
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState('error')
      this.callbacks.onError?.('Max reconnection attempts reached')
      return
    }
    
    this.setState('reconnecting')
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    
    console.log(`[PersonaPlex] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)
    
    this.reconnectTimeout = setTimeout(() => {
      this.connect(this.callbacks).catch(err => {
        console.error('[PersonaPlex] Reconnection failed:', err)
      })
    }, delay)
  }
  
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' })
    }, 30000)
  }
  
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }
  
  // ===========================================================================
  // MESSAGE HANDLING
  // ===========================================================================
  
  private handleMessage(data: string): void {
    try {
      const message: PersonaPlexMessage = JSON.parse(data)
      
      switch (message.type) {
        case 'connected':
          this.sessionId = message.session_id || null
          this.setState('connected')
          this.callbacks.onConnected?.(
            message.session_id || '',
            message.voices || []
          )
          // Resolve connection promise
          ;(this as any)._connectResolve?.()
          break
          
        case 'config_updated':
          this.callbacks.onConfigured?.(message.persona as PersonaConfig)
          break
          
        case 'audio':
          if (message.data) {
            const audioData = this.base64ToArrayBuffer(message.data)
            this.callbacks.onAudioResponse?.(audioData, 'audio/wav')
            this.queueAudioPlayback(audioData)
          }
          break
          
        case 'text':
          this.callbacks.onTranscript?.(
            message.content || '',
            !message.full_response
          )
          break
          
        case 'end_turn':
          this.callbacks.onTurnEnd?.()
          break
          
        case 'error':
          this.callbacks.onError?.(message.error || 'Unknown error')
          break
          
        case 'pong':
          // Keepalive acknowledged
          break
      }
    } catch (e) {
      console.error('[PersonaPlex] Failed to parse message:', e)
    }
  }
  
  private send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }
  
  // ===========================================================================
  // VOICE CONFIGURATION
  // ===========================================================================
  
  configurePersona(config: PersonaConfig): void {
    this.send({
      type: 'config',
      voice: config.voice,
      text_prompt: config.textPrompt,
    })
  }
  
  // ===========================================================================
  // AUDIO INPUT (SEND TO SERVER)
  // ===========================================================================
  
  sendAudioChunk(audioData: ArrayBuffer): void {
    this.resetIdleTimer()  // Activity - reset idle timer
    const base64 = this.arrayBufferToBase64(audioData)
    this.send({
      type: 'audio',
      data: base64,
    })
  }
  
  endTurn(): void {
    this.resetIdleTimer()  // Activity - reset idle timer
    this.send({ type: 'end_turn' })
  }
  
  // ===========================================================================
  // AUDIO OUTPUT (PLAYBACK)
  // ===========================================================================
  
  setOutputDevice(deviceId: string | null): void {
    this.outputDeviceId = deviceId
  }
  
  setOutputVolume(volume: number): void {
    this.outputVolume = Math.max(0, Math.min(1, volume))
  }
  
  private async queueAudioPlayback(audioData: ArrayBuffer): Promise<void> {
    this.audioQueue.push(audioData)
    
    if (!this.isPlaying) {
      this.playNextInQueue()
    }
  }
  
  private async playNextInQueue(): Promise<void> {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false
      return
    }
    
    this.isPlaying = true
    const audioData = this.audioQueue.shift()!
    
    try {
      // Create audio context if needed
      if (!this.audioContext) {
        this.audioContext = new AudioContext({ sampleRate: 24000 })
      }
      
      // Decode audio
      const audioBuffer = await this.audioContext.decodeAudioData(audioData.slice(0))
      
      // Create gain node for volume control
      const gainNode = this.audioContext.createGain()
      gainNode.gain.value = this.outputVolume
      gainNode.connect(this.audioContext.destination)
      
      // Create and play source
      const source = this.audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(gainNode)
      
      source.onended = () => {
        this.playNextInQueue()
      }
      
      source.start()
      
    } catch (e) {
      console.error('[PersonaPlex] Audio playback error:', e)
      this.playNextInQueue()
    }
  }
  
  stopPlayback(): void {
    this.audioQueue = []
    this.isPlaying = false
    
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
  }
  
  // ===========================================================================
  // UTILITY FUNCTIONS
  // ===========================================================================
  
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }
  
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }
  
  // ===========================================================================
  // STATUS
  // ===========================================================================
  
  get isConnected(): boolean {
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN
  }
  
  get connectionState(): ConnectionState {
    return this.state
  }
  
  getSessionId(): string | null {
    return this.sessionId
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let clientInstance: PersonaPlexClient | null = null

export function getPersonaPlexClient(): PersonaPlexClient {
  if (!clientInstance) {
    clientInstance = new PersonaPlexClient()
  }
  return clientInstance
}
