import { useMemo } from "react";
import {
  assessGoverningApprovalCoverage,
  assessRequiredApproverTeamsByProject,
  getRolePermissions,
  revisionActionPermission,
  teamsForMember,
  userHasPermission,
} from "shared/permissions";
import type { ReviewAuthorityFootprint } from "shared/util";
import type { RevisionModel } from "shared/permissions";
import type { OrganizationInterface } from "shared/types/organization";
import type { TeamInterface } from "shared/types/team";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";

type Reviewer = { id: string; status: "approved" | "changes-requested" };

const NO_RULES: { requiredApproverTeams?: string[] }[] = [];
const NO_PROJECTS: string[] = [];
type GoverningRule = {
  project: string;
  rule: { requiredApproverTeams?: string[] };
};

export interface ApprovalCoverage {
  uncoveredApprovers: Set<string>;
  uncoveredApproverReasons: Map<string, string>;
  // Approvals that cannot sanction the publish: short of the footprint, or in
  // none of the required teams. The verdict icon outlines these.
  insufficientApprovers: Set<string>;
  insufficientApproverReasons: Map<string, string>;
  uncoveredFootprintEnvs: string[];
  approvalsCoverFootprint: boolean;
  // Approved but short of the footprint — the "approved, but not enough" state.
  hasUncoveredApproval: boolean;
  // Separate from coverage: a draft can be approved and still miss a team.
  requiredTeams: {
    satisfied: boolean;
    unmet: { id: string; name: string }[][];
    enforcedTeamIds: string[][];
  };
  // Targeting projects whose own review rule fired and still lack an approval
  // from one of their reviewers.
  requiredProjects: {
    satisfied: boolean;
    unmet: { id: string; name: string }[];
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
  approverProjects = NO_PROJECTS,
  governingRules,
}: {
  reviewers: Reviewer[];
  footprint: ReviewAuthorityFootprint;
  envIds: string[];
  // The rules that demanded review — where required teams are declared.
  reviewRules?: { requiredApproverTeams?: string[] }[];
  model: RevisionModel;
  projects: string[];
  // Feature Flags only: targeting projects that each need one of their own
  // reviewers to approve.
  approverProjects?: string[];
  // Feature Flags only: which project imposed each rule, so its required teams
  // are judged against that project's approvals. Falls back to `reviewRules`
  // as the primary project's.
  governingRules?: GoverningRule[];
}): ApprovalCoverage {
  const { users, teams, organization } = useUser();
  const { getProjectById } = useDefinitions();

  const coverage = useMemo(
    () =>
      assessGoverningApprovalCoverage({
        org: organization as OrganizationInterface,
        teams: (teams ?? []) as TeamInterface[],
        model,
        projects,
        approverProjects,
        footprint,
        approvers: reviewers
          .filter((r) => r.status === "approved")
          .map((r) => ({ id: r.id, roleInfo: users.get(r.id) ?? null })),
      }),
    [
      reviewers,
      organization,
      teams,
      model,
      projects,
      approverProjects,
      footprint,
      users,
    ],
  );
  const uncoveredApprovers = useMemo(
    () => new Set(coverage.uncoveredApprovers),
    [coverage],
  );
  const requiredProjects = useMemo(
    () => ({
      satisfied: coverage.requiredProjects.satisfied,
      unmet: coverage.requiredProjects.unmet.map((id) => ({
        id,
        name: getProjectById(id)?.name ?? id,
      })),
    }),
    [coverage, getProjectById],
  );

  // Resolved like the coverage decision — teams, project roles and additional
  // rules included — so the explanation cannot contradict the decision.
  const heldEnvsFor = useMemo(() => {
    const reviewPermission = revisionActionPermission(
      model,
      "review",
    ).permission;
    const cache = new Map<string, string[]>();
    return (approverId: string): string[] => {
      const hit = cache.get(approverId);
      if (hit) return hit;
      const roleInfo = users.get(approverId);
      if (!roleInfo) return [];
      const perms = getRolePermissions(
        roleInfo,
        organization as OrganizationInterface,
        (teams ?? []) as TeamInterface[],
      );
      const held = envIds.filter((env) =>
        userHasPermission(
          perms,
          reviewPermission,
          projects.length ? projects : undefined,
          [env],
        ),
      );
      cache.set(approverId, held);
      return held;
    };
  }, [users, organization, teams, envIds, model, projects]);

  const uncoveredApproverReasons = useMemo(() => {
    const reason = (approverId: string): string => {
      const roleInfo = users.get(approverId);
      const who = roleInfo?.name || roleInfo?.email || "this reviewer";
      if (!roleInfo) return `${who} is no longer a member of this organization`;
      if (footprint.scope !== "environments") {
        return `needs review access with no environment limit`;
      }
      const held = heldEnvsFor(approverId);
      const missing = footprint.environments.filter((e) => !held.includes(e));
      return missing.length
        ? `cannot approve changes in ${missing.join(", ")}`
        : `cannot approve this change`;
    };
    return new Map(
      [...uncoveredApprovers].map((id) => [id, reason(id)] as const),
    );
  }, [uncoveredApprovers, users, footprint, heldEnvsFor]);

  const uncoveredFootprintEnvs = useMemo(() => {
    if (footprint.scope !== "environments") return [];
    const covered = new Set<string>();
    reviewers
      .filter((r) => r.status === "approved")
      .forEach((r) => heldEnvsFor(r.id).forEach((e) => covered.add(e)));
    return footprint.environments.filter((e) => !covered.has(e));
  }, [footprint, reviewers, heldEnvsFor]);

  const approvalsCoverFootprint = reviewers.some(
    (r) => r.status === "approved" && !uncoveredApprovers.has(r.id),
  );

  const primaryProject = projects[0] ?? "";
  const requiredTeams = useMemo(
    () =>
      assessRequiredApproverTeamsByProject({
        governing:
          governingRules ??
          reviewRules.map((rule) => ({ project: primaryProject, rule })),
        primaryProject,
        coverage,
        org: organization as OrganizationInterface,
        teams: (teams ?? []) as TeamInterface[],
      }),
    [
      governingRules,
      reviewRules,
      primaryProject,
      coverage,
      organization,
      teams,
    ],
  );

  // Required-team rules are summative — different rules can be satisfied by
  // different approvers — so only an approval satisfying none is insufficient.
  const nonContributingApprovers = useMemo(() => {
    // The enforced sets, not the raw rules: a rule implied by a stricter one is
    // never enforced, so satisfying only that rule contributes nothing.
    const ruleTeams = requiredTeams.enforcedTeamIds.map((ids) => new Set(ids));
    if (requiredTeams.satisfied || !ruleTeams.length) return new Set<string>();
    const out = new Set<string>();
    reviewers
      .filter((r) => r.status === "approved")
      .forEach((r) => {
        const mine = teamsForMember(
          r.id,
          organization as OrganizationInterface,
          (teams ?? []) as TeamInterface[],
        ).map((t) => t.id);
        if (!ruleTeams.some((ids) => mine.some((id) => ids.has(id)))) {
          out.add(r.id);
        }
      });
    return out;
  }, [requiredTeams, reviewers, organization, teams]);

  const insufficientApprovers = useMemo(
    () => new Set([...uncoveredApprovers, ...nonContributingApprovers]),
    [uncoveredApprovers, nonContributingApprovers],
  );

  const insufficientApproverReasons = useMemo(() => {
    const merged = new Map(uncoveredApproverReasons);
    nonContributingApprovers.forEach((id) => {
      if (!merged.has(id)) {
        merged.set(id, "the reviewer is not in a required approver team");
      }
    });
    return merged;
  }, [uncoveredApproverReasons, nonContributingApprovers]);

  return {
    uncoveredApprovers,
    uncoveredApproverReasons,
    insufficientApprovers,
    insufficientApproverReasons,
    uncoveredFootprintEnvs,
    approvalsCoverFootprint,
    hasUncoveredApproval:
      !approvalsCoverFootprint && uncoveredApprovers.size > 0,
    requiredTeams,
    requiredProjects,
  };
}
