import { Component, type ErrorInfo, type ReactNode } from "react"

/**
 * Last line of defence.
 *
 * A render throw would otherwise leave a blank frameless window with no title
 * bar and nothing to click. This keeps the window controls reachable and shows
 * the error rather than a black rectangle.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; chrome?: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No telemetry by design, so the console is the only place this goes.
    console.error("Unhandled render error", error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <>
        {this.props.chrome}
        <div
          data-tauri-drag-region
          className="drag flex h-full flex-col items-center justify-center gap-4 boot-surface px-10"
        >
          <h1 className="text-lg font-semibold tracking-tight">Something broke</h1>
          <p className="max-w-[380px] text-center text-xs leading-relaxed text-[var(--color-muted-foreground)]">
            The app hit an unexpected error and cannot continue. Restarting usually clears it. If it
            keeps happening, please report it with the message below.
          </p>
          <p className="no-drag max-w-[420px] select-text break-words text-center font-mono text-[11px] text-[var(--color-warning)]">
            {this.state.error.message}
          </p>
        </div>
      </>
    )
  }
}
