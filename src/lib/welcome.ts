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
  const tg = normalizeTelegram(o.telegram.username)
  if (tg) return tg

  const local = o.user.email?.split("@")[0]?.trim()
  if (local) return local

  return `User #${o.user.userNumber}`
}

/** The reveal shows a quiet nudge when there is no Telegram to greet them by. */
export function shouldPromptTelegram(o: WelcomeInput): boolean {
  return normalizeTelegram(o.telegram.username) === ""
}
