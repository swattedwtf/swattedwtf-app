/**
 * Welcome-screen name resolution.
 *
 * Priority order: linked Telegram username, then the local part of the email,
 * then the user number. Mirrors resolveHandle in the Parallax repo's
 * lib/desktop/overview.ts, except that the server has no reason to prefer
 * Telegram (it is building a dashboard header) while the reveal does, because
 * being greeted by your Telegram handle is the point of linking it.
 *
 * Every fallback is guarded on trimmed content rather than mere presence: the
 * server can hand back an empty string, and "Welcome, " with nothing after it
 * would be worse than showing a user number.
 */

type WelcomeInput = {
  user: { email: string | null; userNumber: number }
  telegram: { username: string | null; linked: boolean }
}

/** Telegram handles are stored with or without the @ depending on the source. */
function normalizeTelegram(username: string | null): string {
  return (username ?? "").trim().replace(/^@/, "").trim()
}

export function resolveWelcomeName(o: WelcomeInput): string {
  // Optional chaining even though the type says these are present. This runs on
  // the very first frame after login, at a render site where a throw white-
  // windows the app with no way back short of a release. A partial Overview
  // from a server mid-deploy must degrade to "User #n", never crash the reveal.
  const tg = normalizeTelegram(o.telegram?.username ?? null)
  if (tg) return tg

  const local = o.user?.email?.split("@")[0]?.trim()
  if (local) return local

  return `User #${o.user?.userNumber ?? ""}`.trimEnd()
}

/** The reveal shows a quiet nudge when there is no Telegram to greet them by. */
export function shouldPromptTelegram(o: WelcomeInput): boolean {
  return normalizeTelegram(o.telegram?.username ?? null) === ""
}
