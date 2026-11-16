import React from "react";
import { Revision, RevisionStatus } from "shared/enterprise";
import Badge from "@/ui/Badge";
import {
  revisionStatusColor,
  revisionStatusLabel,
  revisionStatusBadgeVariant,
} from "@/components/Reviews/RevisionStatusBadge";

export type RevisionBadgeStatus = RevisionStatus | "live";

// Render a revision status badge. Delegates color/label/variant to the feature
// status helpers (`components/Reviews/RevisionStatusBadge`) so features, saved
// groups, and constants all share one source of truth for draft-state styling.
export function getStatusBadge(
  status: RevisionBadgeStatus,
  requiresApproval: boolean = true,
) {
  // If approvals are not required, show pending-review as Draft.
  const effective: RevisionBadgeStatus =
    status === "pending-review" && !requiresApproval ? "draft" : status;
  // The feature helpers key off the feature revision status, which uses
  // "published" where the generic revision model uses "merged" (both = Locked).
  const featureStatus = (
    effective === "merged" ? "published" : effective
  ) as Parameters<typeof revisionStatusColor>[0];
  return (
    <Badge
      label={revisionStatusLabel(effective)}
      color={revisionStatusColor(featureStatus)}
      variant={revisionStatusBadgeVariant(featureStatus)}
      radius="full"
    />
  );
}

// Builds the saved-group revision deep-link using `?v=<n>`. Falls back to the
// base URL only when the revision has no version populated.
export function buildSavedGroupRevisionUrl(
  savedGroupId: string,
  revision?: Pick<Revision, "version"> | null,
): string {
  const base = `/saved-groups/${savedGroupId}`;
  if (revision && revision.version !== undefined)
    return `${base}?v=${revision.version}`;
  return base;
}

// Builds the constant revision deep-link using `?v=<n>` (mirrors saved groups).
// The detail page is addressed by the constant's `key`, not its internal id.
export function buildConstantRevisionUrl(
  constantKey: string,
  revision?: Pick<Revision, "version"> | null,
): string {
  const base = `/constants/${constantKey}`;
  if (revision && revision.version !== undefined)
    return `${base}?v=${revision.version}`;
  return base;
}

// Config revision deep-link. Configs are `config`-type constants but live on the
// dedicated `/configs` route.
export function buildConfigRevisionUrl(
  configKey: string,
  revision?: Pick<Revision, "version"> | null,
): string {
  const base = `/configs/${configKey}`;
  if (revision && revision.version !== undefined)
    return `${base}?v=${revision.version}`;
  return base;
}
