/**
 * Shallow defaults for a lookup payload.
 *
 * The server normalises every module into a shape where each section is present
 * and empty rather than absent, so in practice a renderer can read `data.badges`
 * directly. This exists for when that stops being true: a provider shape change,
 * a schema the client does not know, a hand-rolled fixture in a test.
 *
 * The failure it prevents is specific and bad. A renderer that reads
 * `data.badges.length` on an absent field throws inside React's render, which in
 * this app is a white window with no console the user can reach and no way to
 * hotfix without shipping a release. Rendering a sparse card is always the
 * better outcome.
 *
 * Deliberately shallow, and nested objects are merged explicitly by the caller.
 * A deep merge would have to guess how to combine arrays, and guessing wrong
 * here means silently rendering a mixture of real and default data.
 */
export function withDefaults<T extends object>(data: unknown, defaults: T): T {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return defaults
  const merged = { ...defaults } as Record<string, unknown>
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    // An explicit null is still absent as far as rendering is concerned, and
    // several providers send null where they mean "we did not answer".
    if (value !== undefined && value !== null) merged[key] = value
  }
  return merged as T
}

/** An array, or an empty one. Never throws on a provider that sent a scalar. */
export function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/**
 * Like `list`, but for arrays of OBJECTS whose fields are read in render.
 *
 * `list` guarantees the outer array, not the shape of each element. A row that
 * arrives as `null` or a scalar reaches the render, where `row.field` throws on
 * the null and `row.field.join(...)` throws on the scalar, and a throw in this
 * app's render is an unrecoverable white window. This keeps only the elements
 * that are real objects, so a field read on any survivor is at worst
 * `undefined`, never a crash. A dropped row was never renderable anyway.
 */
export function rows<T extends object>(value: unknown): T[] {
  return list<unknown>(value).filter(
    (el): el is T => typeof el === "object" && el !== null && !Array.isArray(el),
  )
}
