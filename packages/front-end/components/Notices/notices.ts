import type { ReactNode } from "react";
import type { CommercialFeature } from "shared/enterprise";

type NoticeSeverity = "error" | "warning";

export type AppNotice = {
  id: string;
  severity: NoticeSeverity;
  // Breaks ties within a severity; higher comes first.
  priority?: number;
  title: string;
  details?: ReactNode;
  href?: string;
  // For notices a better plan resolves: opens the upgrade flow.
  upgrade?: { source: string; commercialFeature: CommercialFeature | null };
  // PROTOTYPE (set in review): set on the license slot's trial notice, so
  // the header shows it as its own banner (NoticeBanner.tsx), not a
  // warning.
  trial?: { plan: string; daysLeft: number };
  // PROTOTYPE (set in review): which of the license slot's notices this is,
  // where the banner's precedence (headerNotices.ts) tells them apart.
  kind?: "license-message" | "seat-quota";
};

const SEVERITY_RANK: Record<NoticeSeverity, number> = { error: 0, warning: 1 };

// Most severe first, then by priority, otherwise in the order given.
export function rankNotices(notices: AppNotice[]): AppNotice[] {
  return [...notices].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (b.priority ?? 0) - (a.priority ?? 0),
  );
}
