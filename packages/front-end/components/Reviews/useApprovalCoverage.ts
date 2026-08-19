import { useMemo } from "react";
import {
  assessApprovalCoverage,
  assessRequiredApproverTeams,
} from "shared/permissions";
import type { ReviewAuthorityFootprint } from "shared/util";
import type { RevisionModel } from "shared/permissions";
import type { OrganizationInterface } from "shared/types/organization";
import type { TeamInterface } from "shared/types/team";
import { useUser } from "@/services/UserContext";

type Reviewer = { id: string; status: "approved" | "changes-requested" };

const NO_RULES: { requiredApproverTeams?: string[] | null }[] = [];

export interface ApprovalCoverage {
  uncoveredApprovers: Set<string>;
  uncoveredApproverReasons: Map<string, string>;
  uncoveredFootprintEnvs: string[];
  approvalsCoverFootprint: boolean;
  // Approved but short of the footprint — the "approved, but not enough" state.
  hasUncoveredApproval: boolean;
  // Separate from coverage: a draft can be approved and still miss a team.
  requiredTeams: {
    satisfied: boolean;
    unmet: { id: string; name: string }[][];
  };
}

// Uses the same functions the server uses, so the panel and the refusal agree.
export function useApprovalCoverage({
  reviewers,
  footprint,
  envIds,
  model,
  projects,
  reviewRules = NO_RULES,
}: {
  reviewers: Reviewer[];
  footprint: ReviewAuthorityFootprint;
  envIds: string[];
  // The rules that demanded review — where required teams are declared.
  reviewRules?: { requiredApproverTeams?: string[] | null }[];
  model: RevisionModel;
  projects: string[];
}): ApprovalCoverage {
  const { users, teams, organization } = useUser();

  const uncoveredApprovers = useMemo(() => {
    const approved = reviewers.filter((r) => r.status === "approved");
    if (!approved.length) return new Set<string>();
    return new Set(
      assessApprovalCoverage({
        org: organization as OrganizationInterface,
        teams: (teams ?? []) as TeamInterface[],
        model,
        projects,
        footprint,
        approvers: approved.map((r) => ({
          id: r.id,
          roleInfo: users.get(r.id) ?? null,
        })),
      }).uncoveredApprovers,
    );
  }, [reviewers, organization, teams, model, projects, footprint, users]);

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

  const requiredTeams = useMemo(
    () =>
      assessRequiredApproverTeams({
        rules: reviewRules,
        // Only covering approvals can satisfy a team requirement.
        coveringApproverIds: reviewers
          .filter(
            (r) => r.status === "approved" && !uncoveredApprovers.has(r.id),
          )
          .map((r) => r.id),
        org: organization as OrganizationInterface,
        teams: (teams ?? []) as TeamInterface[],
      }),
    [reviewRules, reviewers, uncoveredApprovers, organization, teams],
  );

  return {
    uncoveredApprovers,
    uncoveredApproverReasons,
    uncoveredFootprintEnvs,
    approvalsCoverFootprint,
    hasUncoveredApproval:
      !approvalsCoverFootprint && uncoveredApprovers.size > 0,
    requiredTeams,
  };
}
