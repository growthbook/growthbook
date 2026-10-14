// Gives a timezone-less string (older UIs send UTC wall-clock like "2026-01-15T08:12") an explicit UTC suffix.
export function assumeUtc(value: string | Date): string | Date {
  if (typeof value !== "string" || /(Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    return value;
  }
  return `${value}:00Z`;
}
