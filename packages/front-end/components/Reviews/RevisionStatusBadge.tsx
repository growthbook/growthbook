import React from "react";
import {
  PiCheckBold,
  PiClockFill,
  PiLockSimpleFill,
  PiPencil,
  PiPlusMinusBold,
  PiSpinnerGap,
  PiXCircleFill,
} from "react-icons/pi";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Plural, useLingui } from "@lingui/react/macro";
import type { RevisionStatus, ActiveDraftStatus } from "shared/validators";
import type { EventUser } from "shared/types/events/event-types";
import Badge from "@/ui/Badge";
import { RadixColor } from "@/ui/HelperText";
import StatusDot from "@/components/Experiment/StatusDot";

// Entity-agnostic revision identity — enough to render status badges, labels,
// and icons without depending on FeatureRevisionInterface.
export interface RevisionLike {
  version: number;
  status: RevisionStatus;
  createdBy?: EventUser | null;
}

export function isRampGenerated(r: Pick<RevisionLike, "createdBy">): boolean {
  return (
    r.createdBy?.type === "system" && r.createdBy.subtype === "ramp-schedule"
  );
}

export interface Props {
  revision: RevisionLike | null | undefined;
  liveVersion: number;
}

export function revisionStatusColor(
  status: RevisionStatus | "live",
): RadixColor {
  switch (status) {
    case "live":
      return "green";
    case "draft":
      return "amber";

    case "pending-review":
      return "orange";
    case "approved":
      return "green";
    case "changes-requested":
      return "red";
    case "discarded":
      // Same gray as Locked; distinguished by the solid (inverted) badge
      // variant — see revisionStatusBadgeVariant.
      return "gray";
    case "published":
    default:
      return "gray";
  }
}

// Discarded renders as a solid (inverted) gray badge so it reads as muted
// but stays distinguishable from Locked's soft gray.
export function revisionStatusBadgeVariant(
  status: RevisionStatus | "live",
): "solid" | "soft" {
  if (status === "discarded" || status === "live") return "solid";
  return "soft";
}

export function revisionStatusIcon(
  status: RevisionStatus | "live",
): React.ReactNode {
  switch (status) {
    case "live":
      return null;
    case "approved":
      // Standalone bold glyph (matching the timeline's verdict icon) — the
      // surrounding chip/band provides the container.
      return <PiCheckBold />;
    case "pending-review":
      // Spinner glyph (not animated) — distinct from the scheduled-publish clock.
      return <PiSpinnerGap />;
    case "changes-requested":
      return <PiPlusMinusBold />;
    case "discarded":
      return <PiXCircleFill />;
    case "pending-parent":
      return <PiClockFill />;
    case "published":
      // Label is "Locked" — a previously-published, now-immutable revision
      return <PiLockSimpleFill />;
    case "draft":
    default:
      return <PiPencil />;
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

/** Builds a tooltip ReactNode from a counts map — one line per status. */
export function draftStatusTooltip(
  counts: Partial<Record<string, number>>,
): React.ReactNode {
  const ordered: Array<[ActiveDraftStatus, (n: number) => React.ReactNode]> = [
    [
      "changes-requested",
      (n) => (
        <Plural
          value={n}
          one="# revision with changes requested"
          other="# revisions with changes requested"
        />
      ),
    ],
    [
      "pending-review",
      (n) => (
        <Plural
          value={n}
          one="# revision pending approval"
          other="# revisions pending approval"
        />
      ),
    ],
    [
      "approved",
      (n) => (
        <Plural
          value={n}
          one="# approved revision"
          other="# approved revisions"
        />
      ),
    ],
    [
      "draft",
      (n) => (
        <Plural value={n} one="# draft revision" other="# draft revisions" />
      ),
    ],
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
          <StatusDot color={draftStatusDotColor(status)} />
          <span>{text}</span>
        </div>
      ))}
    </div>
  );
}

// Without `i18n` the label is English, for callers not translated yet.
export function revisionStatusLabel(
  status: RevisionStatus | "live" | "merged",
  i18n?: I18n,
): string {
  const label = (message: MessageDescriptor, english: string) =>
    i18n ? i18n._(message) : english;
  switch (status) {
    case "live":
      return label(msg`Live`, "Live");
    case "draft":
      return label(msg`Draft`, "Draft");
    case "pending-review":
      return label(msg`Pending review`, "Pending review");
    case "approved":
      return label(msg`Approved`, "Approved");
    case "changes-requested":
      return label(msg`Changes requested`, "Changes requested");
    case "discarded":
      return label(msg`Discarded`, "Discarded");
    // Waiting on its ramp schedule to publish it.
    case "pending-parent":
      return label(msg`Held`, "Held");
    case "merged":
      return label(msg`Locked`, "Locked");
    case "published":
      return label(msg`Locked`, "Locked");
    default:
      return status;
  }
}

export default function RevisionStatusBadge({ revision, liveVersion }: Props) {
  const { i18n } = useLingui();
  if (!revision) return null;
  const status = revision.version === liveVersion ? "live" : revision.status;
  return (
    <Badge
      label={revisionStatusLabel(status, i18n)}
      radius="full"
      color={revisionStatusColor(status)}
      variant={revisionStatusBadgeVariant(status)}
    />
  );
}
