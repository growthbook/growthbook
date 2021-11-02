export function getValidDate(dateStr: string | Date | null, fallback?: Date) {
  fallback = fallback || new Date();

  if (!dateStr) return fallback;

  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    return fallback;
  }
  return d;
}
