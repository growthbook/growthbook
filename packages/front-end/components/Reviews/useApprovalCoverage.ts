import { useMemo } from "react";
import { assessApprovalCoverage } from "shared/permissions";
import type { ReviewAuthorityFootprint } from "shared/util";
import type { OrganizationInterface } from "shared/types/organization";
import type { TeamInterface } from "shared/types/team";
import { useUser } from "@/services/UserContext";

type Reviewer = { id: string; status: "approved" | "changes-requested" };

export interface ApprovalCoverage {
  // Approvers whose current rights no longer span what the draft changes.
  uncoveredApprovers: Set<string>;
  // Per-approver phrasing for the avatar tooltip and timeline row.
  uncoveredApproverReasons: Map<string, string>;
  // Footprint environments no standing approver covers — what it waits on.
  uncoveredFootprintEnvs: string[];
  // At least one standing approval spans the whole footprint.
  approvalsCoverFootprint: boolean;
  // An approval stands but doesn't reach everything the draft changes — the
  // only case the "approved, but not enough" callout should speak to.
  hasUncoveredApproval: boolean;
}

/**
 * Resolves standing approvals against what a draft actually changes, using the
 * same function the server uses, so the panel and the refusal cannot disagree.
 */
export function useApprovalCoverage({
  reviewers,
  footprint,
  envIds,
  project,
}: {
  reviewers: Reviewer[];
  footprint: ReviewAuthorityFootprint;
  envIds: string[];
  project?: string;
}): ApprovalCoverage {
  const { users, teams, organization } = useUser();

  const uncoveredApprovers = useMemo(() => {
    const approved = reviewers.filter((r) => r.status === "approved");
    if (!approved.length) return new Set<string>();
    return new Set(
      assessApprovalCoverage({
        org: organization as OrganizationInterface,
        teams: (teams ?? []) as TeamInterface[],
        feature: { project: project ?? "" },
        footprint,
        approvers: approved.map((r) => ({
          id: r.id,
          roleInfo: users.get(r.id) ?? null,
        })),
      }).uncoveredApprovers,
    );
  }, [reviewers, organization, teams, project, footprint, users]);

  const uncoveredApproverReasons = useMemo(() => {
    const reason = (approverId: string): string => {
      const roleInfo = users.get(approverId);
      const who = roleInfo?.name || roleInfo?.email || "this reviewer";
      if (!roleInfo) return `${who} is no longer a member of this organization`;
      const held = roleInfo.limitAccessByEnvironment
        ? (roleInfo.environments ?? [])
        : envIds;
      const missing =
        footprint.scope === "environments"
          ? footprint.environments.filter((e) => !held.includes(e))
          : envIds.filter((e) => !held.includes(e));
      return missing.length
        ? `cannot approve changes in ${missing.join(", ")}`
        : `cannot approve this change`;
    };
    return new Map(
      [...uncoveredApprovers].map((id) => [id, reason(id)] as const),
    );
  }, [uncoveredApprovers, users, footprint, envIds]);

  const uncoveredFootprintEnvs = useMemo(() => {
    if (footprint.scope !== "environments") return [];
    const covered = new Set<string>();
    reviewers
      .filter((r) => r.status === "approved")
      .forEach((r) => {
        const roleInfo = users.get(r.id);
        if (!roleInfo) return;
        (roleInfo.limitAccessByEnvironment
          ? (roleInfo.environments ?? [])
          : envIds
        ).forEach((e) => covered.add(e));
      });
    return footprint.environments.filter((e) => !covered.has(e));
  }, [footprint, reviewers, users, envIds]);

  const approvalsCoverFootprint = reviewers.some(
    (r) => r.status === "approved" && !uncoveredApprovers.has(r.id),
  );

  return {
    uncoveredApprovers,
    uncoveredApproverReasons,
    uncoveredFootprintEnvs,
    approvalsCoverFootprint,
    hasUncoveredApproval:
      !approvalsCoverFootprint && uncoveredApprovers.size > 0,
  };
}
