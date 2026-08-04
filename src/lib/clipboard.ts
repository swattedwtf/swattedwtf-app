/**
 * Clipboard write that degrades instead of throwing.
 *
 * The Tauri webview is a secure context, so navigator.clipboard is normally
 * present, but WebKitGTK without a running clipboard owner can still reject, and
 * a copy button must never take the panel down with it. Returns whether the copy
 * landed, so a caller can flash a confirmation only when it actually worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const field = document.createElement("textarea")
    field.value = text
    field.setAttribute("readonly", "")
    field.style.position = "fixed"
    field.style.opacity = "0"
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(field)
    return ok
  } catch {
    return false
  }
}
