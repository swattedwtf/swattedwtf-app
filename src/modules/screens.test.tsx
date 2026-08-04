import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { MODULES } from "./registry"

/**
 * Every module's Result, against the two payloads that actually occur.
 *
 * Written once over the registry rather than per module: the failure this
 * guards is a renderer that assumes a field is present, and that assumption is
 * exactly as likely in the sixteenth module as in the first.
 */

/** Deep-empty stand-in: every property read yields an empty value, not a throw. */
function hollow(): unknown {
  return new Proxy(
    {},
    {
      get(_t, key) {
        if (key === Symbol.toPrimitive || key === "toString") return () => ""
        if (key === "length") return 0
        if (key === Symbol.iterator) return [][Symbol.iterator].bind([])
        if (key === "map" || key === "filter" || key === "slice") return () => []
        if (key === "then") return undefined
        return hollow()
      },
    },
  )
}

describe("every registered module renders defensively", () => {
  for (const m of MODULES) {
    it(`${m.id} survives an empty payload`, () => {
      // Providers routinely answer with part of the picture, and the server
      // normalises absent sections to empty rather than omitting them, so this
      // is the ordinary case rather than an edge one.
      const html = renderToStaticMarkup(
        <m.Result data={{ profile: {}, flags: {}, messages: {} }} partial={[]} />,
      )
      expect(typeof html).toBe("string")
    })

    it(`${m.id} survives a payload where every field is missing`, () => {
      expect(() =>
        renderToStaticMarkup(<m.Result data={hollow()} partial={["a"]} />),
      ).not.toThrow()
    })

    it(`${m.id} declares inputs that all validate`, () => {
      expect(m.inputs.length).toBeGreaterThan(0)
      for (const f of m.inputs) {
        expect(f.name).toBeTruthy()
        expect(f.label).toBeTruthy()
        if (f.optional) {
          // Blank is a legitimate answer for these, so demanding a message
          // would force an optional filter to behave like a required one.
          expect(f.validate(""), `${f.name} is optional and must accept blank`).toBeNull()
        } else {
          // Otherwise blank can only ever become a metered request for nothing.
          expect(f.validate(""), `${f.name} must reject blank`).toBeTruthy()
        }
      }
    })

    it(`${m.id} uses no em dashes in its copy`, () => {
      const html = renderToStaticMarkup(
        <m.Result data={{ profile: {}, flags: {}, messages: {} }} partial={[]} />,
      )
      expect(html).not.toContain("—")
    })
  }
})
