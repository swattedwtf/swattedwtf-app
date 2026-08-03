/**
 * Login-code helpers.
 *
 * swatted.wtf identifies accounts by a 12-digit code (see /api/auth/login,
 * which validates /^\d{12}$/ after stripping whitespace). The UI shows it as
 * three groups of four; the value sent to Rust is always normalized digits.
 */

const LENGTH = 12

/** Digits only, capped at the code length. Safe for paste and for IME input. */
export function normalizeLoginCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, LENGTH)
}

/** Display form: groups of four separated by single spaces, no trailing space. */
export function formatLoginCode(raw: string): string {
  const digits = normalizeLoginCode(raw)
  return digits.replace(/(.{4})(?=.)/g, "$1 ")
}

export function isCompleteLoginCode(raw: string): boolean {
  return normalizeLoginCode(raw).length === LENGTH
}
