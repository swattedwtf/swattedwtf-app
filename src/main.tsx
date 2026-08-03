import React from "react"
import ReactDOM from "react-dom/client"

import App from "./app"
import { ErrorBoundary } from "./ErrorBoundary"
import { WindowControls } from "./shell/WindowControls"

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary chrome={<WindowControls />}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
