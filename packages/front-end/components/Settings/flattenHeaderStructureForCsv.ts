export type HeaderStructure = {
  row1: { label: string; colSpan?: number; rowSpan?: number }[];
  row2Labels: string[];
};

/**
 * Produces one flat header string per leaf column from a two-row table header.
 * Walk order matches `row1` cells and consumes `row2Labels` left-to-right for
 * cells that are not `rowSpan: 2`.
 *
 * Invariant: when the structure matches the rendered `<thead>`, the result
 * length equals the number of data columns (`orderedColumnKeys.length`).
 * Callers must verify length matches before using as CSV headers.
 */
export function flattenHeaderStructureForCsv(
  headerStructure: HeaderStructure,
): string[] {
  const out: string[] = [];
  let row2Idx = 0;
  const { row1, row2Labels } = headerStructure;

  for (const cell of row1) {
    if (cell.rowSpan === 2) {
      out.push(cell.label);
      continue;
    }
    const span = cell.colSpan ?? 1;
    Array.from({ length: span }, () => {
      const sub = row2Labels[row2Idx++] ?? "";
      out.push(sub ? `${cell.label} — ${sub}` : cell.label);
    });
  }

  return out;
}
