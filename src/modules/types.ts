import type { ComponentType, ReactElement } from "react"

/** A page-header icon: any component taking an optional className (lucide fits). */
export type PageIcon = ComponentType<{ className?: string }>

/**
 * One field of a module's query.
 *
 * `validate` returns null when the value is acceptable and the message to show
 * otherwise. It mirrors the server's own regex so an obviously bad input never
 * becomes a metered request; the server remains the authority, so a value this
 * accepts can still be refused.
 */
export type InputField = {
  /** Key sent to the server, and the field's DOM id suffix. */
  name: string
  label: string
  placeholder: string
  /**
   * True when a blank value is a legitimate answer.
   *
   * Most fields are the query itself, where blank can only ever be a wasted
   * metered request. But the Roblox scraper's filters are genuinely optional
   * server-side, and a registry-wide test that demanded every field reject
   * blank forced them to become required, which is worse UX invented by a
   * test rather than by the product.
   */
  optional?: boolean
  validate(v: string): string | null
}

/**
 * Props a module's `Result` is handed.
 *
 * `data` is `any` on purpose. Each module normalises into its own documented,
 * additive-only shape, and the module's own file is where that shape is
 * described. Typing it as `Record<string, unknown>` here would make a
 * descriptor whose `Result` takes its own narrower payload unassignable under
 * `strictFunctionTypes`, which would push every module into casting instead.
 */
export type ResultProps = { data: any; partial: string[] }

/**
 * Everything the generic screen needs to run one module.
 *
 * `inputs` is a list even though most modules take a single value: the Roblox
 * scraper takes seven fields and Server Intel takes none at all.
 */
export type ModuleDescriptor = {
  /** The server-side module key passed to `ipc.lookup`. Never a path or host. */
  id: string
  /** The nav href this module answers on. Matched exactly, never by prefix. */
  route: string
  /** Heading, and the label the nav row already uses. */
  label: string
  /**
   * Optional page-header icon and one-line description, mirroring the web's
   * icon + title + description header on every dashboard page. When both are
   * absent the screen falls back to the bare title, so an un-annotated module
   * still renders.
   */
  icon?: PageIcon
  description?: string
  inputs: InputField[]
  Result: (props: ResultProps) => ReactElement | null
}
