import type { ReactNode } from "react"

export type Field = {
  label: string
  /** Null, undefined or an empty string renders as "Not reported". */
  value: ReactNode
  /** IDs, hashes and timestamps read better monospaced. */
  mono?: boolean
}

function isBlank(value: ReactNode): boolean {
  return value === null || value === undefined || value === "" || value === false
}

/**
 * Label and value pairs.
 *
 * A field the providers did not answer says so rather than rendering an empty
 * cell: a blank next to a label reads as a bug, and "Not reported" is the
 * honest statement, since none of these upstreams distinguishes "absent" from
 * "empty".
 */
export function FieldGrid({
  fields,
  /** Drop unanswered fields instead of labelling them. */
  hideEmpty = false,
}: {
  fields: Field[]
  hideEmpty?: boolean
}) {
  const shown = hideEmpty ? fields.filter((f) => !isBlank(f.value)) : fields
  if (shown.length === 0) return null

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {shown.map((field) => (
        <div key={field.label} className="min-w-0">
          <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
            {field.label}
          </dt>
          <dd
            className={`mt-1 min-w-0 break-words text-[13px] ${field.mono ? "font-mono" : ""} ${
              isBlank(field.value) ? "text-[var(--color-muted-foreground)]" : ""
            }`}
          >
            {isBlank(field.value) ? "Not reported" : field.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
