/**
 * Turning a keypress into a shortcut string, and a shortcut string into
 * something readable.
 *
 * The wire format is whatever `Shortcut::from_str` accepts on the Rust side,
 * which is `Modifier+Modifier+Key` with the key named the way the DOM names it:
 * `KeyK`, `Digit4`, `Space`, `F9`, `ArrowUp`, `Numpad0`. That is a happy
 * coincidence worth relying on, because it means the recorder can send
 * `event.code` straight through instead of maintaining a translation table
 * between two spellings of every key on the keyboard.
 *
 * `event.code` and not `event.key`: `code` is the physical key, so Alt+Shift+K
 * records as `KeyK` rather than as `˚` on macOS or as a dead key on a European
 * layout. It also means the recorded combo follows the key's position, which is
 * what the operating system matches on anyway.
 *
 * Rust validates all of this again before anything reaches the OS. The checks
 * here exist so the user is told what is wrong while they are still pressing
 * keys, not so Rust can trust the input.
 */

/** The parts of a KeyboardEvent this module reads. */
export type KeyPress = {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export type Capture =
  /** A modifier on its own. Keep listening; this is not an error. */
  | { kind: "pending" }
  /** Escape with nothing held. The user is backing out. */
  | { kind: "cancel" }
  | { kind: "rejected"; reason: string }
  | { kind: "combo"; combo: string }

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
])

/**
 * Every key the Rust parser knows, under the name the DOM gives it.
 *
 * Mirrors `parse_key` in global-hotkey. A key that is not in here would be
 * refused by Rust with a parse error, so catching it at the keystroke is only
 * about saying so sooner.
 */
const BINDABLE_CODES = new Set<string>([
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
  "Backquote",
  "Backslash",
  "BracketLeft",
  "BracketRight",
  "Comma",
  "Equal",
  "Minus",
  "Period",
  "Quote",
  "Semicolon",
  "Slash",
  "Backspace",
  "CapsLock",
  "Enter",
  "Space",
  "Tab",
  "Delete",
  "End",
  "Home",
  "Insert",
  "PageDown",
  "PageUp",
  "PrintScreen",
  "ScrollLock",
  "Pause",
  "Escape",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "NumLock",
  "NumpadAdd",
  "NumpadDecimal",
  "NumpadDivide",
  "NumpadEnter",
  "NumpadEqual",
  "NumpadMultiply",
  "NumpadSubtract",
  "AudioVolumeDown",
  "AudioVolumeUp",
  "AudioVolumeMute",
  "MediaPlay",
  "MediaPause",
  "MediaPlayPause",
  "MediaStop",
  "MediaTrackNext",
  "MediaTrackPrevious",
])

export const NO_MODIFIER_REASON =
  "Hold Ctrl, Alt, Shift or Cmd as well. A shortcut this app takes over system-wide would otherwise stop that key working in every other application."

/** Reads one keydown into a combo, or into a reason it cannot be one. */
export function captureCombo(event: KeyPress): Capture {
  if (MODIFIER_CODES.has(event.code)) return { kind: "pending" }

  const modifiers: string[] = []
  // Named separately rather than as CmdOrCtrl: on a Mac, Ctrl and Cmd are two
  // different keys and a user who pressed one of them meant that one.
  if (event.ctrlKey) modifiers.push("Control")
  if (event.altKey) modifiers.push("Alt")
  if (event.shiftKey) modifiers.push("Shift")
  if (event.metaKey) modifiers.push("Super")

  if (event.code === "Escape" && modifiers.length === 0) return { kind: "cancel" }

  if (!BINDABLE_CODES.has(event.code)) {
    return { kind: "rejected", reason: "That key cannot be used in a shortcut." }
  }

  if (modifiers.length === 0) {
    return { kind: "rejected", reason: NO_MODIFIER_REASON }
  }

  return { kind: "combo", combo: [...modifiers, event.code].join("+") }
}

/**
 * True on an Apple keyboard layout, where the modifiers are named differently.
 *
 * Guarded rather than reading `navigator` directly: these helpers are unit
 * tested outside a DOM, where the global may not exist at all.
 */
export function isMacPlatform(nav?: { platform?: string; userAgent?: string }): boolean {
  const source = nav ?? (typeof navigator === "undefined" ? undefined : navigator)
  return /mac/i.test(source?.platform ?? source?.userAgent ?? "")
}

const KEY_LABELS: Record<string, string> = {
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Equal: "=",
  Minus: "-",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  PageDown: "Page Down",
  PageUp: "Page Up",
  PrintScreen: "Print Screen",
  CapsLock: "Caps Lock",
  ScrollLock: "Scroll Lock",
  NumLock: "Num Lock",
  AudioVolumeDown: "Volume Down",
  AudioVolumeUp: "Volume Up",
  AudioVolumeMute: "Mute",
}

function labelForToken(token: string, mac: boolean): string {
  switch (token.toLowerCase()) {
    case "cmdorctrl":
    case "cmdorcontrol":
    case "commandorctrl":
    case "commandorcontrol":
      return mac ? "Cmd" : "Ctrl"
    case "control":
    case "ctrl":
      return "Ctrl"
    case "alt":
    case "option":
      return mac ? "Option" : "Alt"
    case "shift":
      return "Shift"
    case "super":
    case "cmd":
    case "command":
      return mac ? "Cmd" : "Win"
  }

  if (KEY_LABELS[token]) return KEY_LABELS[token]
  if (token.startsWith("Key") && token.length === 4) return token.slice(3)
  if (token.startsWith("Digit")) return token.slice(5)
  if (token.startsWith("Numpad")) return `Num ${token.slice(6) || "pad"}`
  return token
}

/**
 * Human-readable form of a stored combo.
 *
 * Display only. The stored string is what goes back to Rust, so this never has
 * to round-trip: "Ctrl + Shift + Space" is never parsed by anything.
 */
export function formatCombo(combo: string, mac: boolean = isMacPlatform()): string {
  return combo
    .split("+")
    .map((token) => labelForToken(token.trim(), mac))
    .join(" + ")
}
