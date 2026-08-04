import { useState } from "react"
import { Check, Copy } from "lucide-react"

import { copyText } from "../../lib/clipboard"

/** One label/value pair inside a leaked record. */
export type LeakField = {
  label: string
  value: string
  /** A secret (password, hash). Rendered monospaced and tinted, like the web. */
  sensitive?: boolean
}

/** One source's answer for the query: where it came from and what it held. */
export type LeakRecord = {
  source: string
  fields: LeakField[]
}

/**
 * A single breach or leak record, drawn the way the web Search page draws it:
 * a source header (a status dot, the source name set in mono caps, the field
 * count) over a stack of copyable field rows.
 *
 * Every value is legible in full white; a secret is the one exception, tinted
 * and monospaced so it reads as a captured credential rather than as ordinary
 * profile text. Long opaque values (URLs, hashes, log ids) truncate and copy the
 * full string on click, so a card never blows its column out to the width of a
 * hash.
 */
export function RecordCard({ record }: { record: LeakRecord }) {
  return (
    <div className="glass-tile overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-2.5">
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/60" aria-hidden="true" />
          <span className="truncate font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-white">
            {record.source}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[10px] text-white/50">
          {record.fields.length} {record.fields.length === 1 ? "field" : "fields"}
        </span>
      </div>

      <div>
        {record.fields.map((field, i) => (
          <FieldRow
            key={`${field.label}-${i}`}
            field={field}
            last={i === record.fields.length - 1}
          />
        ))}
      </div>
    </div>
  )
}

function FieldRow({ field, last }: { field: LeakField; last: boolean }) {
  const [copied, setCopied] = useState(false)

  async function onCopy() {
    const ok = await copyText(field.value)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  // A long opaque value (URL, path, log id, hash) is shown truncated; the whole
  // string is still on the clipboard, since that is what a value like this is
  // for.
  const isLong =
    /^(url|path|log[\s_]?id|logid|hash|machine[\s_]?id)$/i.test(field.label.trim()) ||
    /^https?:\/\//i.test(field.value.trim())
  const truncated = isLong && field.value.length > 24 ? `${field.value.slice(0, 24)}…` : field.value

  return (
    <div
      className={`group grid grid-cols-[104px_1fr_auto] items-start gap-3 px-4 py-2.5 sm:grid-cols-[132px_1fr_auto] ${
        last ? "" : "border-b border-white/[0.05]"
      }`}
    >
      <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
        {field.label}
      </span>
      {isLong ? (
        <button
          type="button"
          onClick={onCopy}
          title={`Copy ${field.value}`}
          className="min-w-0 truncate text-left font-mono text-sm text-white underline-offset-2 hover:underline"
        >
          {truncated}
        </button>
      ) : (
        <span
          className={`min-w-0 break-words text-sm ${
            field.sensitive ? "font-mono text-amber-200" : "text-white"
          }`}
        >
          {field.value}
        </span>
      )}
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy ${field.label.toLowerCase()}`}
        title="Copy"
        className="shrink-0 rounded-md p-1 text-white/50 opacity-0 transition-opacity hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-[var(--color-positive)]" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
