import { useState } from "react"
import { Clock, Crown, ExternalLink, Receipt, Search, Zap } from "lucide-react"
import type { Overview } from "../lib/ipc"
import { formatCount, formatResetIn, formatSince } from "../lib/format"
import { ApiCards } from "./ApiCards"
import { QuickActions, openWeb } from "./QuickActions"
import { StatCard } from "./StatCard"
import { UsageChart } from "./UsageChart"

const PLANS_URL = "https://swattedw.tf/dashboard/plans"

/**
 * Dashboard home, at parity with app/dashboard/page.tsx in the Parallax repo:
 * the same four stat cards computed from the same numbers, so the desktop and
 * the web dashboard never disagree.
 *
 * formatResetIn reads the clock once per render, so the countdown does not
 * tick. That is intentional for v1: the number is a coarse "6d", and a
 * per-second timer would be the only thing keeping the app awake at idle.
 */
export function Home({ overview }: { overview: Overview }) {
  const { usage, plan, user } = overview
  const [plansFailed, setPlansFailed] = useState(false)
  const icon = "h-4 w-4 text-white"

  async function openPlans() {
    setPlansFailed(!(await openWeb(PLANS_URL)))
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
          Welcome back
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{user.handle}</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Your account overview and quick access to OSINT tools.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Zap className={icon} aria-hidden="true" />}
          label="Requests (this month)"
          value={formatCount(usage.monthCount)}
          progress={plan.monthlyLimit > 0 ? (usage.monthCount / plan.monthlyLimit) * 100 : 0}
          caption={`of ${formatCount(plan.monthlyLimit)} this month`}
        />
        <StatCard
          icon={<Crown className={icon} aria-hidden="true" />}
          label="Account Tier"
          value={plan.label}
          caption={`Member since ${formatSince(plan.since)}`}
        />
        <StatCard
          icon={<Search className={icon} aria-hidden="true" />}
          label="Total Lookups"
          value={formatCount(usage.allTimeCount)}
          caption="All-time searches"
        />
        <StatCard
          icon={<Clock className={icon} aria-hidden="true" />}
          label="Resets In"
          value={formatResetIn(usage.nextResetMs)}
          caption="Until next reset"
        />
      </div>

      <ApiCards overview={overview} />
      <QuickActions />
      <UsageChart series={usage.series} />

      <div className="glass p-6">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-[var(--muted-foreground)]" aria-hidden="true" />
          <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
            Plan Order Status
          </h2>
        </div>

        <div className="flex flex-col items-center px-6 py-8 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5">
            <Receipt className="h-5 w-5 text-[var(--muted-foreground)]" aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-sm font-semibold tracking-tight">No Active Orders</h3>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-[var(--muted-foreground)]">
            Upgrade your plan to unlock more features, higher lookup limits, and priority support.
          </p>
          <button
            type="button"
            onClick={() => void openPlans()}
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/90"
          >
            View plans
            <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          </button>
          <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
            {plansFailed ? "Could not open your browser. Visit swattedw.tf/dashboard/plans." : "Opens in your browser."}
          </p>
        </div>
      </div>
    </div>
  )
}
