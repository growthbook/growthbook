import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

// The stored reason is English: "Manual", "Manual: <detail>", or a reason the
// back-end wrote. Only the wording added here is translated; a detail or a
// back-end reason shows as written.
export function formatRollbackReason(
  reason: string | null | undefined,
  i18n: I18n,
): string | null {
  const trimmed = reason?.trim();
  if (!trimmed) return null;

  if (trimmed === "Manual") return i18n._(msg`Manually rolled back`);
  if (trimmed.startsWith("Manual:")) {
    const detail = trimmed.slice("Manual:".length).trim();
    if (!detail) return i18n._(msg`Manually rolled back`);
    if (/^manually\b/i.test(detail)) {
      return detail[0].toUpperCase() + detail.slice(1);
    }
    if (/^rolled back\b/i.test(detail)) {
      return i18n._(msg`Manually ${detail}`);
    }
    return i18n._(msg`Manually rolled back: ${detail}`);
  }

  return trimmed;
}
