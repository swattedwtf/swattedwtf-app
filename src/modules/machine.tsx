import { list, withDefaults } from "./safe"
import type { ModuleDescriptor, ResultProps } from "./types"
import { EmptyState, FieldGrid, ProfileCard, Section } from "./ui"

/**
 * Machine Browser.
 *
 * The full stealer-log dump for one Horus victim PC, pulled by its machine key.
 * One field, one server call: the screen opens with the machine's identity and
 * then lists everything the dump carried (saved credentials, passwords, email
 * addresses, files), each section reporting its own count.
 *
 * There are no images and no links on a machine dump, so nothing here goes
 * through RemoteImage or ipc.openExternal. Nothing styles a container of its
 * own: every block is a `ui/` primitive.
 */

const PCKEY_MAX = 200

type MachineData = {
  pcKey: string
  pcName: string
  ingestedAt: string | null
  credentialPairs: string[]
  passwords: string[]
  emails: string[]
  files: string[]
  metadata: { key: string; value: string }[]
  counts: {
    credentialPairs: number
    passwords: number
    emails: number
    files: number
  }
}

const EMPTY_COUNTS = { credentialPairs: 0, passwords: 0, emails: 0, files: 0 }

function formatDate(iso: string | null): string {
  if (!iso) return ""
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""
  return at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/** A section over a flat string list. Bounded, so a huge dump cannot lock the
 *  render, and each row reads monospaced because these are raw log lines. */
function StringList({
  title,
  count,
  rows,
  empty,
}: {
  title: string
  count: number
  rows: string[]
  empty: string
}) {
  return (
    <Section title={`${title}${count ? ` (${count})` : ""}`}>
      {rows.length === 0 ? (
        <EmptyState message={empty} />
      ) : (
        <ul className="space-y-1 font-mono text-[11px] leading-relaxed text-white/70">
          {rows.slice(0, 100).map((row, i) => (
            <li key={i} className="truncate">
              {row || "Empty record"}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

export function Result({ data, partial }: ResultProps) {
  // Coerced once, at the top: a renderer that reads `.length` on an absent
  // field throws inside React's render, which in this app is a white window with
  // no reachable console. `withDefaults` drops explicit nulls too, so a provider
  // that answered null for a section still lands on the empty array below.
  const raw = withDefaults(data, {} as Partial<MachineData>)
  const d: MachineData = {
    pcKey: typeof raw.pcKey === "string" ? raw.pcKey : "",
    pcName: typeof raw.pcName === "string" ? raw.pcName : "",
    ingestedAt: typeof raw.ingestedAt === "string" ? raw.ingestedAt : null,
    credentialPairs: list<string>(raw.credentialPairs),
    passwords: list<string>(raw.passwords),
    emails: list<string>(raw.emails),
    files: list<string>(raw.files),
    metadata: list<{ key: string; value: string }>(raw.metadata),
    counts: withDefaults(raw.counts, EMPTY_COUNTS),
  }

  return (
    <div className="space-y-4">
      <ProfileCard
        avatarUrl={null}
        name={d.pcName || d.pcKey || "Unknown machine"}
        subtitle={d.pcKey || null}
        meta={[
          { label: "Machine key", value: d.pcKey, mono: true },
          { label: "Ingested", value: formatDate(d.ingestedAt) },
        ]}
      />

      <StringList
        title="Credentials"
        count={d.counts.credentialPairs}
        rows={d.credentialPairs}
        empty="No saved credentials in this dump."
      />

      <StringList
        title="Passwords"
        count={d.counts.passwords}
        rows={d.passwords}
        empty="No passwords in this dump."
      />

      <StringList
        title="Email addresses"
        count={d.counts.emails}
        rows={d.emails}
        empty="No email addresses in this dump."
      />

      <StringList
        title="Files"
        count={d.counts.files}
        rows={d.files}
        empty="No files listed in this dump."
      />

      {d.metadata.length > 0 && (
        <Section title="Machine details">
          <FieldGrid
            fields={d.metadata.map((m, i) => ({
              label: m.key || `Detail ${i + 1}`,
              value: m.value,
              mono: true,
            }))}
          />
        </Section>
      )}

      {partial.length > 0 && (
        <p className="px-1 text-[11px] text-[var(--color-muted-foreground)]">
          Some sources did not answer: {partial.join(", ")}.
        </p>
      )}
    </div>
  )
}

export const descriptor: ModuleDescriptor = {
  id: "machine",
  route: "/machine",
  label: "Machine Browser",
  inputs: [
    {
      name: "pcKey",
      label: "Machine key",
      placeholder: "e.g. the pcKey from a Search result",
      // Mirrors the server's own bound (non-empty, up to 200) so an input that
      // cannot succeed never becomes a metered request. The server is still the
      // authority.
      validate: (v) =>
        v.trim().length > 0 && v.trim().length <= PCKEY_MAX ? null : "Enter a machine key.",
    },
  ],
  Result,
}
