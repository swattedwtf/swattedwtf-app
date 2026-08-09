import { useState } from "react"
import { Database, KeyRound, ShieldAlert } from "lucide-react"

import { RecordCard, type LeakField } from "./RecordCard"
import { StatTiles } from "./StatTiles"

/** One breach record, source + its labeled fields. Mark secrets `sensitive`. */
export type BreachEntry = { source: string; fields: LeakField[] }

/**
 * Breach records drawn the way the web draws them: a Rows / Passwords / Sources
 * stat row over per-source cards with labeled, copyable fields, and a
 * Reveal/Hide passwords toggle. Secrets stay masked until revealed. Shared by
 * Discord and Roblox (Minecraft has its own inline copy), so the three read
 * identically instead of one flattening passwords into a mono one-liner.
 */
export function BreachCards({ records }: { records: BreachEntry[] }) {
  const [reveal, setReveal] = useState(false)
  const total = records.length
  const passwords = records.filter((r) => r.fields.some((f) => f.sensitive && f.value)).length
  const sources = new Set(records.map((r) => r.source).filter(Boolean)).size

  return (
    <div className="space-y-3">
      <StatTiles
        tiles={[
          { icon: Database, label: "Breach rows", value: total },
          { icon: KeyRound, label: "Passwords", value: passwords },
          { icon: ShieldAlert, label: "Sources", value: sources },
        ]}
      />
      {passwords > 0 ? (
        <button type="button" onClick={() => setReveal((r) => !r)} className="btn-secondary btn-compact">
          {reveal ? "Hide passwords" : "Reveal passwords"}
        </button>
      ) : null}
      <div className="space-y-2.5">
        {records.slice(0, 100).map((r, i) => (
          <RecordCard
            key={i}
            record={{
              source: r.source || "Unknown source",
              fields: r.fields
                .filter((f) => f.value)
                .map((f) =>
                  f.sensitive && !reveal
                    ? { ...f, value: "•".repeat(Math.min(f.value.length, 12)) }
                    : f,
                ),
            }}
          />
        ))}
      </div>
    </div>
  )
}
