import type { ReactElement } from "react"

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
  inputs: InputField[]
  Result: (props: ResultProps) => ReactElement | null
}
