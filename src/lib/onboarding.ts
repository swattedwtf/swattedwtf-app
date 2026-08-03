/**
 * First-run walkthrough state.
 *
 * Pure functions only, deliberately: the walkthrough itself is a React tree
 * that cannot be unit tested in this repo (vitest runs on the node environment,
 * there is no DOM and no testing-library), so every decision it makes lives
 * here where it can be.
 *
 * The "seen" flag is versioned. A future release that adds or rewrites steps
 * bumps WALKTHROUGH_VERSION and the walkthrough shows once more, without
 * needing a migration or a second key.
 */

/** Bump to re-show the walkthrough to everyone on the next launch. */
export const WALKTHROUGH_VERSION = 1

export const WALKTHROUGH_SEEN_KEY = `swattedwtf.walkthrough.seen.v${WALKTHROUGH_VERSION}`

/**
 * localStorage, or null when it is unavailable.
 *
 * WebView2 and WebKitGTK can both be configured with storage disabled, in which
 * case the property either is missing, is null, or throws a SecurityError on
 * mere access. All three have to be survivable: this runs on the first frame
 * after login, and throwing here would replace the walkthrough with a blank
 * window on someone's very first run.
 */
function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage | null }).localStorage ?? null
  } catch {
    return null
  }
}

/** Whether this version of the walkthrough has already been completed or skipped. */
export function hasSeenWalkthrough(): boolean {
  try {
    return storage()?.getItem(WALKTHROUGH_SEEN_KEY) === "1"
  } catch {
    // Reads can throw independently of the property access (a partitioned or
    // revoked store). Unknown means "not seen": showing the tour a second time
    // is a far smaller cost than crashing.
    return false
  }
}

/** Records the walkthrough as done. Never throws, even with storage disabled. */
export function markWalkthroughSeen(): void {
  try {
    storage()?.setItem(WALKTHROUGH_SEEN_KEY, "1")
  } catch {
    // Quota, private mode, or storage switched off. The walkthrough will show
    // again next launch, which is an acceptable outcome; an exception here is
    // not, because it happens on the dismiss click.
  }
}

/** Forgets the flag so the walkthrough shows again. For manual QA and support. */
export function clearWalkthroughSeen(): void {
  try {
    storage()?.removeItem(WALKTHROUGH_SEEN_KEY)
  } catch {
    // Same reasoning as markWalkthroughSeen.
  }
}

/** Clamps an arbitrary index into [0, total - 1]. Non-integers are truncated. */
export function clampStep(step: number, total: number): number {
  if (!Number.isFinite(step) || total <= 0) return 0
  return Math.min(Math.max(Math.trunc(step), 0), total - 1)
}

/** The next step, stopping on the last one rather than running off the end. */
export function nextStep(step: number, total: number): number {
  return clampStep(clampStep(step, total) + 1, total)
}

/** The previous step, stopping at the first one. */
export function prevStep(step: number): number {
  if (!Number.isFinite(step)) return 0
  return Math.max(Math.trunc(step) - 1, 0)
}
