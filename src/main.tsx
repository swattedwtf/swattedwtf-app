import React from "react"
import ReactDOM from "react-dom/client"

import App from "./app"
import { QuickLookup } from "./quick/QuickLookup"
import { ErrorBoundary } from "./ErrorBoundary"
import { WindowControls } from "./shell/WindowControls"

/**
 * Both windows load this same bundle; the label decides which one renders.
 * Reading it from the URL rather than the Tauri API keeps this synchronous, so
 * neither window flashes the wrong UI for a frame while an async call resolves.
 */
const isQuickWindow = new URLSearchParams(window.location.search).get("window") === "quick"
  || window.location.hash === "#quick"
  || (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
    .__TAURI_INTERNALS__?.metadata?.currentWindow?.label === "quick"

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary chrome={<WindowControls />}>
      {isQuickWindow ? <QuickLookup /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
)
