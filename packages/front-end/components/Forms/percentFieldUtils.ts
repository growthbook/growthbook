const formatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  useGrouping: false,
});

export function proportionToPercentInputValue(
  value: number | undefined,
): number | undefined {
  if (value === undefined) return value;
  if (!Number.isFinite(value)) return 0;
  return Number(formatter.format(value * 100));
}
