/**
 * Detect columns whose value never varies across a set of evidence rows.
 *
 * A column that prints the same string on every row is not evidence, it is a heading. On the
 * 77-denial fact that was `403` seventy-seven times and the same path seventy-seven times,
 * while the path itself got truncated for want of width — redundant and unreadable at once.
 *
 * Shared deliberately: the evidence drawer and the incident timeline render the same kind of
 * table, and having one of them hoist invariants while the other did not was worse than
 * neither doing it.
 */
export interface InvariantSplit {
  /** label -> the single value every row shares */
  constant: { label: string; value: string }[]
  /** keys whose value differs across rows, so they still earn a column */
  varies: Set<string>
}

export function splitInvariants<T>(
  rows: readonly T[],
  columns: { key: string; label: string; get: (r: T) => string }[],
  /** below this many rows, repetition is not a problem worth solving */
  minRows = 3,
): InvariantSplit {
  const constant: { label: string; value: string }[] = []
  const varies = new Set<string>()

  for (const col of columns) {
    if (rows.length < minRows) {
      varies.add(col.key)
      continue
    }
    const first = col.get(rows[0])
    if (rows.every((r) => col.get(r) === first) && first.trim() !== '') {
      constant.push({ label: col.label, value: first })
    } else {
      varies.add(col.key)
    }
  }
  return { constant, varies }
}
