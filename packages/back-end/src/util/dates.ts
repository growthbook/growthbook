// Gives a timezone-less string (older UIs send a UTC date and time like "2026-01-15T08:12") an explicit UTC suffix.
export function assumeUtc(value: string | Date): string | Date {
  if (typeof value !== "string" || /(Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    return value;
  }
  // Date-only (YYYY-MM-DD): append full time + Z
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00Z`;
  }
  // Has seconds (HH:MM:SS or HH:MM:SS.fff): append Z only
  if (/T\d{2}:\d{2}:\d{2}/.test(value)) {
    return `${value}Z`;
  }
  // Minute precision (HH:MM): append :00Z
  return `${value}:00Z`;
}
