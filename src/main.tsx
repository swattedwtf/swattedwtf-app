import React from "react"
import ReactDOM from "react-dom/client"

import App from "./app"
import { QuickLookup } from "./quick/QuickLookup"
import { ErrorBoundary } from "./ErrorBoundary"
import { WindowControls } from "./shell/WindowControls"
import { applyStoredTheme } from "./settings/theme"

/**
 * Both windows load this same bundle; the label decides which one renders.
 * Reading it from the URL rather than the Tauri API keeps this synchronous, so
 * neither window flashes the wrong UI for a frame while an async call resolves.
 */
const isQuickWindow = new URLSearchParams(window.location.search).get("window") === "quick"
  || window.location.hash === "#quick"
  || (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
    .__TAURI_INTERNALS__?.metadata?.currentWindow?.label === "quick"

/**
 * Before the root exists, not from an effect inside it: the variables are read
 * during the first paint, so applying them a frame later means the app opens on
 * the default theme and then visibly changes colour. Both windows do this, so
 * the quick-lookup overlay matches whatever the main window is wearing.
 */
applyStoredTheme()

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary chrome={<WindowControls />}>
      {isQuickWindow ? <QuickLookup /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
)
