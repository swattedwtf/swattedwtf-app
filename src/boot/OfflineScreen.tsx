/**
 * Blocking network failure.
 *
 * There is deliberately no way past this. Account details, lookups and billing
 * all come from the API, so letting someone through would just render empty
 * panels and read as a broken app rather than a missing connection.
 */
export function OfflineScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="drag flex h-full flex-col items-center justify-center gap-5 bg-[#0b0b0b] px-10">
      <h1 className="text-lg font-semibold tracking-tight">Can't reach swatted.wtf</h1>

      <p className="max-w-[380px] text-center text-xs leading-relaxed text-[var(--color-muted-foreground)]">
        The app needs a connection for account details and lookups. Check your network and try
        again.
      </p>

      {error && (
        <p className="max-w-[420px] break-all text-center font-mono text-[10px] leading-relaxed text-white/25">
          {error}
        </p>
      )}

      <button
        onClick={onRetry}
        className="no-drag h-10 rounded-lg bg-white px-6 font-medium text-black"
      >
        Retry
      </button>
    </div>
  )
}
