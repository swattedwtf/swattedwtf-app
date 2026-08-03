import ReactDOM from "react-dom/client"
import { Walkthrough } from "./Walkthrough"
import "../theme.css"

function markDone() {
  ;(window as unknown as { __done?: number }).__done =
    (((window as unknown as { __done?: number }).__done) ?? 0) + 1
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <div className="app-root">
    <Walkthrough onDone={markDone} />
  </div>,
)
