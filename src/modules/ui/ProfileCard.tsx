import type { ReactNode } from "react"

import { RemoteImage } from "../RemoteImage"
import { FieldGrid, type Field } from "./FieldGrid"

/**
 * The head of a result: who or what was found.
 *
 * Every module that resolves to a person, an account or a place opens with
 * this, so the answer always appears in the same spot on the screen.
 */
export function ProfileCard({
  avatarUrl,
  name,
  subtitle,
  meta = [],
  badges,
  children,
}: {
  avatarUrl?: string | null
  /** Display name. Also what the avatar placeholder takes its initials from. */
  name: string
  /** Handle, ID, or whatever identifies this one account. */
  subtitle?: ReactNode
  /** A few headline fields, beneath the name. */
  meta?: Field[]
  badges?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="glass">
      <div className="glass-body">
        <div className="flex items-start gap-4">
          <RemoteImage
            url={avatarUrl}
            alt={name}
            className="h-16 w-16 shrink-0 rounded-2xl text-lg font-medium"
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold tracking-tight">{name}</h2>
            {subtitle ? (
              <p className="mt-0.5 truncate font-mono text-[12px] text-[var(--color-muted-foreground)]">
                {subtitle}
              </p>
            ) : null}
            {badges ? <div className="mt-3">{badges}</div> : null}
          </div>
        </div>

        {meta.length > 0 ? (
          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <FieldGrid fields={meta} />
          </div>
        ) : null}

        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    </section>
  )
}
