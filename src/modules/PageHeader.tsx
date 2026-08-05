import type { PageIcon } from "./types"

/**
 * The dashboard page header, shared by ModuleScreen and StreamScreen.
 *
 * Mirrors swattedw.tf's every-page header: an icon in a soft tile, the title,
 * and a one-line description underneath. Before this the app rendered a bare
 * <h1> and nothing else, which is what made the desktop pages read as emptier
 * and less finished than the site even though the forms below were identical.
 *
 * A module that has not been given an icon or a description degrades to the old
 * plain title, so nothing breaks for a screen that has not opted in yet.
 */
export function PageHeader({
  icon: Icon,
  title,
  description,
}: {
  icon?: PageIcon
  title: string
  description?: string
}) {
  if (!Icon && !description) {
    return <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
  }
  return (
    <header className="flex items-start gap-3.5">
      {Icon ? (
        <span className="glass-tile flex h-11 w-11 shrink-0 items-center justify-center text-white">
          <Icon className="h-5 w-5" />
        </span>
      ) : null}
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            {description}
          </p>
        ) : null}
      </div>
    </header>
  )
}
