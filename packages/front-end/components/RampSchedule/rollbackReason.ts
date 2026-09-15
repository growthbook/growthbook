export function formatRollbackReason(reason?: string | null): string | null {
  const trimmed = reason?.trim();
  if (!trimmed) return null;

  if (trimmed === "Manual") return "Manually rolled back";
  if (trimmed.startsWith("Manual:")) {
    const detail = trimmed.slice("Manual:".length).trim();
    if (!detail) return "Manually rolled back";
    if (/^manually\b/i.test(detail)) {
      return detail[0].toUpperCase() + detail.slice(1);
    }
    if (/^rolled back\b/i.test(detail)) {
      return `Manually ${detail}`;
    }
    return `Manually rolled back: ${detail}`;
  }

  return trimmed;
}
