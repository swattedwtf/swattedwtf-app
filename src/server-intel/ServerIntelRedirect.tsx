import { useEffect } from "react"
import { ExternalLink, Radio } from "lucide-react"

import { ipc } from "../lib/ipc"
import { PageHeader } from "../modules/PageHeader"

/**
 * Roblox Server Intel is a live pairing session: the operator mints a connector,
 * pastes it into their Roblox executor, and the browser holds the socket that
 * streams the roster back. That handshake belongs in a real browser tab, not the
 * app webview, so - exactly like the Agent - the app hands it off to the web
 * dashboard rather than half-reimplementing it. It opens the web page on mount
 * and leaves a button for a second try if the browser did not come forward.
 */

const WEB_URL = "https://swattedw.tf/dashboard/roblox/server-intel"

export function ServerIntelRedirect() {
  useEffect(() => {
    void ipc.openExternal(WEB_URL).catch(() => {})
  }, [])

  return (
    <div>
      <PageHeader icon={Radio} title="Server Intel" description="Roblox live-server pairing" />
      <div className="mt-6 max-w-xl rounded-xl border border-[var(--color-border)] bg-white/[0.02] p-6">
        <p className="text-[13px] leading-relaxed text-white/80">
          Server Intel pairs with your live Roblox server over a browser session, so it runs on the web
          dashboard. It should have opened in your browser just now.
        </p>
        <button
          type="button"
          onClick={() => void ipc.openExternal(WEB_URL).catch(() => {})}
          className="btn-secondary btn-compact mt-4 inline-flex items-center gap-1.5"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          Open Server Intel on the web
        </button>
      </div>
    </div>
  )
}
