import ReactDOM from "react-dom/client"
import { Walkthrough } from "./Walkthrough"
import "../theme.css"

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <div className="app-root">
    <Walkthrough onDone={() => console.log("done")} />
  </div>,
)
