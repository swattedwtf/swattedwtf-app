import { useState } from "react"
import { ArrowUpRight, Check, Code2, Crown, RefreshCw, Tag, User, VenetianMask } from "lucide-react"

import { ipc, type Overview, type PlanTier } from "../lib/ipc"
import { messageOf } from "../lib/errors"
import { list, withDefaults } from "./safe"

/**
 * Plans, laid out to match the web page at /dashboard/plans.
 *
 * NOT A LOOKUP, and deliberately not a module: nothing is searched for, nothing
 * is metered, and there is no query to submit. It is a built-in route beside
 * /dashboard, /settings and /api.
 *
 * PAYMENT DOES NOT HAPPEN HERE. This screen presents the tiers, what the
 * account holds and what it would pay, then hands off to the web checkout. Card
 * entry, the payment provider's SDK, promo redemption and fulfillment all live
 * on the web behind browser-only controls (the signed-in mutation gate, the
 * origin check, the device attestation the webview cannot produce). A native
 * re-implementation would mean weakening every one of them to sell the same
 * thing, so the button opens a browser instead.
 *
 * THE PRICES ARE THE SERVER'S. Every number and every feature line arrives in
 * the boot-time Overview, built from the same table lib/plans.ts charges from
 * in the Parallax repo. A price typed into this file would be a price that can
 * drift from the invoice, which is a billing lie rather than a cosmetic bug.
 * `yourPriceUsd` is what THIS account pays: the Premium -> Heist upgrade credit
 * and any account discount are already applied to it server-side.
 *
 * A purchase completes in the browser, out of this app's sight, so the screen
 * offers a refresh that re-reads the same Overview the app booted on rather
 * than asking the user to restart.
 */

/** Where the web checkout lives. https only, which is all `open_external` opens. */
const CHECKOUT_URL = "https://swattedw.tf/dashboard/checkout"
const PLANS_URL = "https://swattedw.tf/dashboard/plans"
const TERMS_URL = "https://swattedw.tf/terms"

const EMPTY_PLANS: Overview["plans"] = { currentId: "", discountPercent: 0, tiers: [] }

const EMPTY_TIER: PlanTier = {
  id: "",
  name: "",
  shortName: "",
  term: "",
  lifetime: false,
  badge: null,
  highlight: false,
  includes: null,
  features: [],
  priceUsd: 0,
  yourPriceUsd: 0,
  relation: "default",
}

/** Icons are this screen's own, exactly as they are the web page's own. */
const ICONS: Record<string, typeof User> = { free: User, pro: Crown, plus: VenetianMask }

/** `$20`, `$46.75`. Whole dollars keep no trailing zeros, cents are never dropped. */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return "$0"
  const rounded = Math.round(amount * 100) / 100
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`
}

/**
 * A promo code, reduced to what a code can be.
 *
 * The value is forwarded to the web in a URL, so it is stripped to the
 * characters a code is made of rather than trusted: nothing here can become
 * another query parameter or a second path.
 */
export function normalizePromo(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 64)
}

/**
 * The web checkout URL for a tier.
 *
 * `plan` and `billing` are what the checkout page reads (it ignores any other
 * billing cycle and prices Premium monthly, Heist lifetime). `discount=50` is
 * DISPLAY ONLY: the server re-derives eligibility from the profile when it
 * creates the invoice, so passing it can only make the checkout page agree with
 * what this screen showed, never grant anything. `promo` is likewise validated
 * server-side; carrying it just spares the buyer typing it twice.
 *
 * Exported so its shape is pinned by a test: this is the one string in the app
 * that decides what a user is about to be charged for.
 */
export function checkoutUrl(
  tierId: string,
  opts: { discountPercent?: number; promo?: string } = {},
): string {
  const params = new URLSearchParams({ plan: tierId, billing: "monthly" })
  if (opts.discountPercent === 50) params.set("discount", "50")
  const promo = normalizePromo(opts.promo ?? "")
  if (promo) params.set("promo", promo)
  return `${CHECKOUT_URL}?${params.toString()}`
}

/** The line under the price, matching the web's wording. */
function termCaption(tier: PlanTier): string {
  if (tier.lifetime) return "One-time lifetime"
  if (tier.id === "free") return "Free access"
  return "Monthly subscription"
}

/**
 * The tier's action: label, whether it is pressable, and whether it is an
 * upgrade (which gets the filled treatment and the arrow).
 *
 * Mirrors getPlanState in app/dashboard/plans/plans-client.tsx exactly, so the
 * desktop reads the same as the web: one full-width pill per card, disabled for
 * everything that is not a purchase, with the same one-word copy. This replaces
 * the old free-form captions ("Every account starts here", "Lower tier than X,
 * not a purchase") that read as filler beside the real buttons.
 */
function planCta(tier: PlanTier): { cta: string; disabled: boolean; isUpgrade: boolean } {
  if (tier.relation === "upgrade") {
    return { cta: `Get ${tier.shortName || tier.name}`, disabled: false, isUpgrade: true }
  }
  if (tier.relation === "current") return { cta: "Current plan", disabled: true, isUpgrade: false }
  if (tier.id === "free") return { cta: "Default", disabled: true, isUpgrade: false }
  return { cta: "Downgrade", disabled: true, isUpgrade: false }
}

function TierCard({
  tier,
  discountPercent,
  onBuy,
}: {
  tier: PlanTier
  discountPercent: number
  onBuy: (tier: PlanTier) => void
}) {
  const Icon = ICONS[tier.id] ?? User
  const isPaid = tier.id !== "free"
  // Struck through only when the two genuinely differ, so a full-price tier
  // does not pretend to be a saving.
  const discounted = isPaid && tier.yourPriceUsd < tier.priceUsd

  return (
    <div
      className={`glass flex h-full flex-col ${
        tier.highlight ? "ring-1 ring-white/20" : ""
      }`}
    >
      <div className="glass-body flex h-full flex-col">
        <div className="mb-4 flex min-h-[20px] flex-wrap items-center gap-2">
          {tier.badge ? (
            <span className="glass-tile rounded-full px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-white">
              {tier.badge}
            </span>
          ) : null}
          {tier.relation === "current" ? (
            <span className="glass-tile rounded-full px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
              Your plan
            </span>
          ) : null}
        </div>

        <p className="flex items-center gap-2 text-sm font-medium text-white">
          <Icon
            className="h-4 w-4 text-[var(--color-muted-foreground)]"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          {tier.name}
        </p>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-5xl font-medium tracking-tight tabular-nums text-white">
            {formatUsd(tier.yourPriceUsd)}
          </span>
          <span className="text-sm text-white/70">{tier.term}</span>
          {discounted ? (
            <span className="text-sm tabular-nums text-[var(--color-muted-foreground)] line-through">
              {formatUsd(tier.priceUsd)}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
          {termCaption(tier)}
        </p>
        {discounted && discountPercent > 0 && tier.relation !== "current" ? (
          <p className="mt-1 text-xs text-white/70">{discountPercent}% off applied to your account.</p>
        ) : null}
        {discounted && discountPercent === 0 && tier.relation === "upgrade" ? (
          // The Premium -> Heist credit, named rather than left as a mystery
          // discount: the buyer already paid the difference.
          <p className="mt-1 text-xs text-white/70">
            {formatUsd(tier.priceUsd - tier.yourPriceUsd)} credited for your current plan.
          </p>
        ) : null}

        {(() => {
          const { cta, disabled, isUpgrade } = planCta(tier)
          return (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (!disabled) onBuy(tier)
              }}
              className={`group mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                isUpgrade && tier.highlight
                  ? "bg-white text-[#0b0b0b] hover:bg-white/90"
                  : isUpgrade
                    ? "border border-white/15 bg-transparent text-white hover:border-white/40 hover:bg-white/[0.06]"
                    : "border border-white/12 bg-transparent text-white/60"
              }`}
            >
              {cta}
              {isUpgrade ? (
                <ArrowUpRight
                  className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              ) : null}
            </button>
          )
        })()}

        <div className="my-6 border-t border-white/[0.06]" />

        {tier.includes ? (
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
            {tier.includes}
          </p>
        ) : null}

        <ul className="flex-1 space-y-3">
          {list<string>(tier.features).map((feature) => (
            <li key={feature} className="flex items-start gap-3 text-[13px] leading-relaxed text-white">
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              {feature}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function Plans({
  overview,
  onNavigate,
}: {
  overview: Overview
  /** Used only to reach the API Access screen, which is an add-on and not a tier. */
  onNavigate?: (route: string) => void
}) {
  // The screen keeps its own copy so a purchase made in the browser can be
  // picked up without restarting the app. It starts as the payload the app
  // booted on and is replaced by a fresh read of the SAME endpoint, so there is
  // one definition of plan state rather than two.
  const [current, setCurrent] = useState<Overview>(overview)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [promo, setPromo] = useState("")
  const [handedOff, setHandedOff] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  const plans = withDefaults(current?.plans, EMPTY_PLANS)
  const tiers = list<Partial<PlanTier>>(plans.tiers).map((t) => withDefaults(t, EMPTY_TIER))
  const currentTier = tiers.find((t) => t.relation === "current")

  const refresh = () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshError(null)
    void ipc
      .getOverview()
      .then((fresh) => setCurrent(fresh))
      .catch((err) => setRefreshError(messageOf(err)))
      .finally(() => setRefreshing(false))
  }

  const buy = (tier: PlanTier) => {
    const url = checkoutUrl(tier.id, { discountPercent: plans.discountPercent, promo })
    setOpenError(null)
    void ipc
      .openExternal(url)
      .then(() => setHandedOff(tier.name))
      .catch(() => setOpenError(url))
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
          / Plans
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">
          Choose your intelligence tier
        </h1>
        <p className="mt-1 max-w-[70ch] text-sm text-white/70">
          Free accounts cannot run searches, so a paid plan is required. Plans decide which tools you
          can reach and how much you can run; Reverse Face is pay as you go ($0.60 per search) on any
          paid plan. Checkout happens in your browser.
        </p>
        {plans.discountPercent > 0 ? (
          <p className="glass-tile mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white">
            <Tag className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            {plans.discountPercent}% off applied
          </p>
        ) : null}
      </div>

      <section className="glass">
        <div className="glass-body flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
              Current plan
            </p>
            <p className="mt-1 text-lg font-semibold text-white">
              {currentTier?.name || current?.plan?.label || "Free"}
            </p>
          </div>
          <div className="text-right">
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="btn-secondary btn-compact"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {refreshing ? "Refreshing" : "Refresh plan"}
            </button>
            <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
              Bought a plan in your browser? Refresh to pick it up.
            </p>
          </div>
        </div>
      </section>

      {refreshError ? (
        <p className="glass-tile px-4 py-3 text-[13px] text-white/75">
          Could not re-read your plan: {refreshError}
        </p>
      ) : null}

      {handedOff ? (
        <p className="glass-tile px-4 py-3 text-[13px] text-white/75">
          Checkout for {handedOff} opened in your browser. Finish there, then use Refresh plan.
        </p>
      ) : null}

      {openError ? (
        <p className="glass-tile px-4 py-3 text-[13px] text-white/75">
          Could not open your browser. Go to {openError} to finish the purchase.
        </p>
      ) : null}

      {tiers.length === 0 ? (
        // An empty catalog is a server that did not answer with one, not a set
        // of free tiers. Saying so beats drawing three $0 cards.
        <section className="glass">
          <div className="glass-body text-center">
            <p className="text-sm text-white">Plan details could not be loaded.</p>
            <p className="mx-auto mt-1 max-w-[52ch] text-[13px] text-white/70">
              Prices and features come from the server, and this build will not guess at them.
              Refresh, or open the plans page in your browser.
            </p>
            <button
              type="button"
              onClick={() => void ipc.openExternal(PLANS_URL).catch(() => {})}
              className="btn-secondary btn-compact mt-4"
            >
              Open plans in browser
            </button>
          </div>
        </section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              discountPercent={plans.discountPercent}
              onBuy={buy}
            />
          ))}
        </div>
      )}

      <section className="glass">
        <div className="glass-body">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
            Discount code
          </p>
          <p className="mt-2 max-w-[64ch] text-[13px] text-white/70">
            A code is checked and redeemed at checkout, in your browser. Enter it here and it travels
            with you, so you do not have to type it twice. The price above does not change until the
            code has been verified.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={promo}
              onChange={(e) => setPromo(normalizePromo(e.target.value))}
              placeholder="Enter a code"
              autoComplete="off"
              spellCheck={false}
              aria-label="Discount code"
              className="glass-input min-w-0 flex-1 px-3 py-2 font-mono text-[12px] uppercase tracking-[0.12em]"
            />
            {promo ? (
              <button
                type="button"
                onClick={() => setPromo("")}
                className="btn-secondary btn-compact"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="glass">
        <div className="glass-body flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-white">
              <Code2
                className="h-4 w-4 text-[var(--color-muted-foreground)]"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              API Access
            </p>
            <p className="mt-1 max-w-[64ch] text-[13px] text-white/70">
              A separate paid add-on, not part of any plan. Buying or renewing a plan neither enables
              nor disables it.
            </p>
          </div>
          {onNavigate ? (
            <button
              type="button"
              onClick={() => onNavigate("/api")}
              className="btn-secondary btn-compact"
            >
              View API Access
            </button>
          ) : null}
        </div>
      </section>

      <p className="text-xs text-[var(--color-muted-foreground)]">
        All plans are billed in USD. Purchases are subject to our{" "}
        <button
          type="button"
          onClick={() => void ipc.openExternal(TERMS_URL).catch(() => {})}
          className="underline underline-offset-2 hover:text-white"
        >
          Terms and Refund Policy
        </button>
        .
      </p>
    </div>
  )
}
