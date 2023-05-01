export function getValidDate(
  dateStr: string | Date | null | number,
  fallback?: Date
): Date {
  fallback = fallback || new Date();

  if (!dateStr) return fallback;

  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    return fallback;
  }
  return d;
}
