import type { ReactElement } from "react"
import type { InputField, PageIcon } from "./types"

/**
 * Descriptors for the STREAMING screens (Search, Live Intelligence).
 *
 * These differ from the one-shot `ModuleDescriptor` in one way: their result
 * arrives over many SSE frames rather than in a single payload, so the screen
 * has to render "what has arrived so far" and be cancellable. Everything else,
 * the inputs, the validation, the error panels, is shared with ModuleScreen.
 */

/** Where a stream is in its lifecycle. */
export type StreamStatus = "idle" | "streaming" | "done" | "error" | "cancelled"

/** One parsed SSE data event. Shape is the module's own; renderers coerce it. */
export type StreamFrame = Record<string, unknown>

/**
 * Props a streaming module's `Result` is handed.
 *
 * `frames` is every data frame received so far, in order. A renderer derives its
 * whole view from this list, so a re-render always reflects exactly what has
 * arrived. `status` distinguishes still-streaming from cleanly-done from failed,
 * and `error` carries the failure copy when a stream ended with an error frame
 * or the transport dropped. A FAILED stream must never look like one that
 * finished with nothing.
 */
export type StreamResultProps = {
  frames: StreamFrame[]
  status: StreamStatus
  error: string | null
  /** Open a captured machine in the Machine Browser (Search results only). When
   *  absent, a machine card falls back to copying its log id. */
  onOpenMachine?: (logId: string) => void
}

/** One selectable mode (Search's Email / Username / Domain toggle). */
export type StreamMode = { id: string; label: string }

/**
 * What resolving the form produced: the server module to run and its input, or a
 * message for an input the client can already tell is bad (so it never becomes a
 * metered request).
 */
export type StreamResolved =
  | { module: string; input: Record<string, unknown> }
  | { error: string }

/** Everything the streaming screen needs to run one module. */
export type StreamModuleDescriptor = {
  /** Registry id and React key. Not the server module id (a mode picks that). */
  id: string
  /** The nav href this screen answers on. Matched exactly, never by prefix. */
  route: string
  /** Heading, and the label the nav row already uses. */
  label: string
  /** Optional page-header icon and description, matching the web (see ModuleDescriptor). */
  icon?: PageIcon
  description?: string
  inputs: InputField[]
  /** Optional mode toggle. The first mode is the default. */
  modes?: StreamMode[]
  /**
   * Turn the validated form values (and the chosen mode) into the server call.
   * Returns an error string for anything the client can already reject.
   */
  resolve(values: Record<string, string>, mode: string | null): StreamResolved
  Result: (props: StreamResultProps) => ReactElement | null
}
