import { useState } from "react"
import { createRoot } from "react-dom/client"
import { Sidebar } from "./src/shell/Sidebar"
import "./src/theme.css"

function Preview() {
  const [route, setRoute] = useState("/dashboard")
  return (
    <div className="app-root">
      <div className="relative flex h-full bg-[#0b0b0b]">
        <div className="app-backdrop"><div className="app-backdrop-wash" /></div>
        <Sidebar route={route} onNavigate={setRoute} />
        <div className="relative z-10 flex-1 p-10 text-white/40">preview</div>
      </div>
    </div>
  )
}
createRoot(document.getElementById("root")!).render(<Preview />)
