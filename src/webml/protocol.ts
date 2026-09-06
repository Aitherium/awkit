// Message protocol between the UI (hook) and the WebGPU worker. Shared so every
// consumer (Veil, adk GUI, customer apps) speaks the same wire format.

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export type WorkerRequest =
  | { type: "load"; modelId: string }
  | {
      type: "generate";
      messages: ChatMessage[];
      maxTokens?: number;
      temperature?: number;
      topK?: number;
      topP?: number;
      repetitionPenalty?: number;
      /** Reasoning models only: token cap inside `<think>` before it is force-closed. */
      reasoningBudget?: number;
    }
  | { type: "interrupt" };

export type WorkerResponse =
  // download/compile progress (transformers.js progress_callback shape, loosened)
  | { type: "progress"; file?: string; progress?: number; loaded?: number; total?: number }
  | { type: "ready"; modelId: string }
  /** Reasoning models split their stream: `thinking` is chain-of-thought and must NOT be
   *  rendered as the reply. Absent means "answer" (non-reasoning runtimes, legacy workers). */
  | { type: "token"; text: string; channel?: "thinking" | "answer" }
  | { type: "done"; text: string; reasoning?: string; tokensPerSecond?: number }
  /**
   * A tool the model called asked the HOST to do something the worker cannot do itself.
   *
   * Tools execute inside the Worker, which has no window manager and no DOM — so a tool
   * like `open_app` can only ever REQUEST the effect. Without this variant the request has
   * nowhere to go and the tool is inert in the most convincing way possible: it returns a
   * cheerful "Opened the Sprite window", the model repeats that to the visitor, and no
   * window opens.
   */
  | { type: "tool_action"; actions: Array<{ kind: "open"; app: string }> }
  /**
   * `fatal` marks a failure the HOST must not retry. Optional and additive — every existing
   * producer and consumer is unaffected.
   *
   * `device-lost` is the case it was added for. `GPUDevice.lost` resolving with a reason
   * other than "destroyed" means the platform tore the device away; on Windows that is
   * almost always a TDR display-driver reset, i.e. a GPU command packet that ran past the
   * ~2 s watchdog deadline. The device is not recoverable in place, and a retry submits the
   * same work to the same adapter and resets the driver AGAIN — which the visitor
   * experiences as their screen flashing repeatedly (incident 2026-07-31, Lenovo Yoga 7i /
   * Iris Xe, where the loop outlived the browser tab).
   *
   * Hosts distinguish it structurally rather than by sniffing message text, because the
   * generic error path deliberately re-arms so an ordinary failure can be retried, and that
   * is exactly the wrong response here.
   */
  | { type: "error"; message: string; fatal?: "device-lost" };
