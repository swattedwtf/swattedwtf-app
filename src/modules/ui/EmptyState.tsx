/**
 * "There is nothing here", said once, the same way everywhere.
 *
 * Distinct from a locked section: this means the providers answered and had
 * nothing, not that the account cannot see it.
 */
export function EmptyState({ message }: { message: string }) {
  return (
    <p className="glass-tile px-4 py-6 text-center text-[13px] text-[var(--color-muted-foreground)]">
      {message}
    </p>
  )
}
