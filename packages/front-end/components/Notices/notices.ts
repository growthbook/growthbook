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
