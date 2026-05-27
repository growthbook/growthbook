import React from "react";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { ActiveDraftStatus } from "shared/validators";
import Badge from "@/ui/Badge";
import { RadixColor } from "@/ui/HelperText";

export function isRampGenerated(
  r: Pick<MinimalFeatureRevisionInterface, "createdBy">,
): boolean {
  return (
    r.createdBy?.type === "system" && r.createdBy.subtype === "ramp-schedule"
  );
}

export interface Props {
  revision: MinimalFeatureRevisionInterface | null | undefined;
  liveVersion: number;
}

export function revisionStatusColor(
  status: MinimalFeatureRevisionInterface["status"] | "live",
): RadixColor {
  switch (status) {
    case "live":
      return "teal";
    case "draft":
      return "plum";

    case "pending-review":
      return "orange";
    case "approved":
      return "grass";
    case "changes-requested":
      return "amber";
    case "discarded":
      return "red";
    case "published":
    default:
      return "gray";
  }
}

export function draftStatusDotColor(status: string): string {
  switch (status) {
    case "approved":
      return "var(--green-9)";
    case "draft":
      return "var(--amber-9)";
    case "merged":
    case "discarded":
      return "var(--gray-9)";
    default:
      return "var(--red-9)"; // pending-review, changes-requested
  }
}

// Priority order for picking the dot color when multiple statuses exist.
// Higher index = shown first.
const DRAFT_STATUS_PRIORITY: ActiveDraftStatus[] = [
  "draft",
  "approved",
  "pending-review",
  "changes-requested",
];

/** Returns the highest-priority status present in the counts map. */
export function topDraftStatus(
  counts: Partial<Record<string, number>>,
): string | null {
  for (let i = DRAFT_STATUS_PRIORITY.length - 1; i >= 0; i--) {
    const s = DRAFT_STATUS_PRIORITY[i];
    if ((counts[s] ?? 0) > 0) return s;
  }
  return null;
}

/**
 * Returns the distinct visual dot colors to show in the column cell.
 * "pending-review" and "changes-requested" both map to red, so they
 * collapse into a single dot. Result is ordered: red, green, amber.
 */
export function draftStatusDots(
  counts: Partial<Record<string, number>>,
): string[] {
  const dots: string[] = [];
  if ((counts["changes-requested"] ?? 0) + (counts["pending-review"] ?? 0) > 0)
    dots.push("var(--red-9)");
  if ((counts["approved"] ?? 0) > 0) dots.push("var(--green-9)");
  if ((counts["draft"] ?? 0) > 0) dots.push("var(--amber-9)");
  return dots;
}

/** Builds a tooltip ReactNode from a counts map — one line per status. */
export function draftStatusTooltip(
  counts: Partial<Record<string, number>>,
): React.ReactNode {
  const ordered: Array<[ActiveDraftStatus, (n: number) => string]> = [
    [
      "changes-requested",
      (n) =>
        `${n} ${n === 1 ? "revision" : "revisions"} with changes requested`,
    ],
    [
      "pending-review",
      (n) => `${n} ${n === 1 ? "revision" : "revisions"} pending approval`,
    ],
    ["approved", (n) => `${n} approved ${n === 1 ? "revision" : "revisions"}`],
    ["draft", (n) => `${n} draft ${n === 1 ? "revision" : "revisions"}`],
  ];
  const lines = ordered.flatMap(([status, fmt]) => {
    const n = counts[status] ?? 0;
    if (!n) return [];
    return [{ status, text: fmt(n) }];
  });
  if (!lines.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {lines.map(({ status, text }) => (
        <div
          key={status}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <span
            style={{
              display: "block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              flexShrink: 0,
              background: draftStatusDotColor(status),
            }}
          />
          <span>{text}</span>
        </div>
      ))}
    </div>
  );
}

export function revisionStatusLabel(
  status: MinimalFeatureRevisionInterface["status"] | "live" | "merged",
): string {
  switch (status) {
    case "live":
      return "Live";
    case "draft":
      return "Draft";
    case "pending-review":
      return "Pending review";
    case "approved":
      return "Approved";
    case "changes-requested":
      return "Changes requested";
    case "discarded":
      return "Discarded";
    case "merged":
      return "Locked";
    case "published":
      return "Locked";
    default:
      return status;
  }
}

export default function RevisionStatusBadge({ revision, liveVersion }: Props) {
  if (!revision) return null;
  const status = revision.version === liveVersion ? "live" : revision.status;
  return (
    <Badge
      label={revisionStatusLabel(status)}
      radius="full"
      color={revisionStatusColor(status)}
    />
  );
}
