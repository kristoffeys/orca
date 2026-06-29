export function ProductiveIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      {/* Why: render a flat monochrome clipboard-check glyph so Productive matches
      Orca's other single-color provider marks instead of a branded tile. */}
      <path d="M9 2a1 1 0 0 0-1 1v1H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V3a1 1 0 0 0-1-1H9zm1 2h4v2h-4V4zm6.707 6.293a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414 0l-2.5-2.5a1 1 0 1 1 1.414-1.414L11 14.586l4.293-4.293a1 1 0 0 1 1.414 0z" />
    </svg>
  )
}
