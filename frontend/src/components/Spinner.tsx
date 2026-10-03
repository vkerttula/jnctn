// Small activity indicator — navy ring on light surfaces, `dark` for the
// DataExplorer's dark background. Label renders muted next to the ring.
export default function Spinner({
  label,
  dark = false,
  className = '',
}: {
  label?: string
  dark?: boolean
  className?: string
}) {
  return (
    <span
      role="status"
      aria-label={label ?? 'Loading'}
      className={`inline-flex items-center gap-2.5 ${className}`}
    >
      <span
        aria-hidden
        className={`h-4 w-4 animate-spin rounded-full border-2 ${
          dark ? 'border-white/20 border-t-white/70' : 'border-navy/15 border-t-navy/60'
        }`}
      />
      {label && (
        <span aria-hidden className={`text-sm ${dark ? 'text-white/40' : 'text-muted'}`}>
          {label}
        </span>
      )}
    </span>
  )
}
