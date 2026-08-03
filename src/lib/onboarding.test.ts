import { afterEach, describe, expect, it, vi } from "vitest"

import {
  WALKTHROUGH_SEEN_KEY,
  WALKTHROUGH_VERSION,
  clampStep,
  clearWalkthroughSeen,
  hasSeenWalkthrough,
  markWalkthroughSeen,
  nextStep,
  prevStep,
} from "./onboarding"

/** A minimal in-memory Storage, with hooks for making individual calls throw. */
function memoryStorage(
  fail: { get?: boolean; set?: boolean; remove?: boolean } = {},
): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem(k: string) {
      if (fail.get) throw new Error("storage read blocked")
      return map.get(k) ?? null
    },
    setItem(k: string, v: string) {
      if (fail.set) throw new Error("quota exceeded")
      map.set(k, v)
    },
    removeItem(k: string) {
      if (fail.remove) throw new Error("storage write blocked")
      map.delete(k)
    },
    clear() {
      map.clear()
    },
  }
}

/** Replaces globalThis.localStorage with a property whose getter throws. */
function installThrowingAccessor(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError")
    },
  })
  return () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    if (original) Object.defineProperty(globalThis, "localStorage", original)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("WALKTHROUGH_SEEN_KEY", () => {
  it("carries the version, so a bump re-shows the walkthrough", () => {
    expect(WALKTHROUGH_SEEN_KEY).toContain(`v${WALKTHROUGH_VERSION}`)
  })
})

describe("hasSeenWalkthrough / markWalkthroughSeen", () => {
  it("is false before anything is written", () => {
    vi.stubGlobal("localStorage", memoryStorage())
    expect(hasSeenWalkthrough()).toBe(false)
  })

  it("is true after being marked, under the versioned key", () => {
    const store = memoryStorage()
    vi.stubGlobal("localStorage", store)

    markWalkthroughSeen()

    expect(hasSeenWalkthrough()).toBe(true)
    expect(store.map.get(WALKTHROUGH_SEEN_KEY)).toBe("1")
  })

  it("ignores a value written under a different version's key", () => {
    const store = memoryStorage()
    store.map.set("swattedwtf.walkthrough.seen.v0", "1")
    vi.stubGlobal("localStorage", store)

    expect(hasSeenWalkthrough()).toBe(false)
  })

  it("treats an unexpected stored value as not seen", () => {
    const store = memoryStorage()
    store.map.set(WALKTHROUGH_SEEN_KEY, "0")
    vi.stubGlobal("localStorage", store)

    expect(hasSeenWalkthrough()).toBe(false)
  })

  it("clears the flag again", () => {
    const store = memoryStorage()
    vi.stubGlobal("localStorage", store)

    markWalkthroughSeen()
    clearWalkthroughSeen()

    expect(hasSeenWalkthrough()).toBe(false)
    expect(store.map.has(WALKTHROUGH_SEEN_KEY)).toBe(false)
  })
})

describe("storage being unavailable", () => {
  it("survives localStorage being undefined", () => {
    vi.stubGlobal("localStorage", undefined)

    expect(() => markWalkthroughSeen()).not.toThrow()
    expect(() => clearWalkthroughSeen()).not.toThrow()
    expect(hasSeenWalkthrough()).toBe(false)
  })

  it("survives localStorage being null", () => {
    vi.stubGlobal("localStorage", null)

    expect(() => markWalkthroughSeen()).not.toThrow()
    expect(hasSeenWalkthrough()).toBe(false)
  })

  it("survives a getter that throws, as when storage is switched off", () => {
    const restore = installThrowingAccessor()
    try {
      expect(() => markWalkthroughSeen()).not.toThrow()
      expect(() => clearWalkthroughSeen()).not.toThrow()
      expect(hasSeenWalkthrough()).toBe(false)
    } finally {
      restore()
    }
  })

  it("survives getItem throwing", () => {
    vi.stubGlobal("localStorage", memoryStorage({ get: true }))
    expect(hasSeenWalkthrough()).toBe(false)
  })

  it("survives setItem throwing, as on a full or private-mode store", () => {
    vi.stubGlobal("localStorage", memoryStorage({ set: true }))
    expect(() => markWalkthroughSeen()).not.toThrow()
  })

  it("survives removeItem throwing", () => {
    vi.stubGlobal("localStorage", memoryStorage({ remove: true }))
    expect(() => clearWalkthroughSeen()).not.toThrow()
  })
})

describe("nextStep", () => {
  it("advances", () => {
    expect(nextStep(0, 4)).toBe(1)
    expect(nextStep(2, 4)).toBe(3)
  })

  it("clamps on the last step", () => {
    expect(nextStep(3, 4)).toBe(3)
    expect(nextStep(99, 4)).toBe(3)
  })

  it("clamps a negative index back into range", () => {
    expect(nextStep(-5, 4)).toBe(1)
  })

  it("returns 0 when there are no steps", () => {
    expect(nextStep(0, 0)).toBe(0)
    expect(nextStep(3, 0)).toBe(0)
  })
})

describe("prevStep", () => {
  it("goes back", () => {
    expect(prevStep(3)).toBe(2)
    expect(prevStep(1)).toBe(0)
  })

  it("clamps at the first step", () => {
    expect(prevStep(0)).toBe(0)
    expect(prevStep(-4)).toBe(0)
  })
})

describe("clampStep", () => {
  it("clamps both ends", () => {
    expect(clampStep(-1, 4)).toBe(0)
    expect(clampStep(4, 4)).toBe(3)
    expect(clampStep(2, 4)).toBe(2)
  })

  it("truncates non-integers and rejects NaN", () => {
    expect(clampStep(1.9, 4)).toBe(1)
    expect(clampStep(Number.NaN, 4)).toBe(0)
    expect(clampStep(Number.POSITIVE_INFINITY, 4)).toBe(0)
  })
})
