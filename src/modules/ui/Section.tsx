import type { ReactNode } from "react"

/**
 * One block of a result, on the app's panel material.
 *
 * Every module composes these rather than styling its own containers, so
 * sixteen screens written one at a time cannot drift into sixteen visual
 * languages.
 */
export function Section({
  title,
  action,
  children,
}: {
  title: string
  /** A control for this section, right-aligned against the caption. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="glass">
      <div className="glass-body">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
            {title}
          </h2>
          {action}
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </section>
  )
}
