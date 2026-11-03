import { useCallback, useMemo } from "react";
import {
  approvalApprovers,
  approvalRoleIds,
  assessGoverningApprovalCoverage,
  assessRequiredApproverTeamsByProject,
  getRolePermissions,
  revisionActionPermission,
  teamsForMember,
  userHasPermission,
} from "shared/permissions";
import type { ReviewAuthorityFootprint } from "shared/util";
import type { RevisionModel } from "shared/permissions";
import type {
  MemberRoleWithProjects,
  OrganizationInterface,
} from "shared/types/organization";
import type { TeamInterface } from "shared/types/team";
import type { EventUser } from "shared/validators";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";

type Reviewer = {
  id: string;
  status: "approved" | "changes-requested";
  user?: EventUser;
};

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
  // from one of their reviewers. `name` is null for a project the viewer
  // cannot read.
  requiredProjects: {
    satisfied: boolean;
    unmet: { id: string; name: string | null }[];
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

  // Keys' roles come from the server, so the panel judges key approvals the
  // way publishing does.
  const approvals = useMemo(
    () =>
      reviewers
        .filter((r) => r.status === "approved")
        .map((r) => ({ userId: r.id, user: r.user })),
    [reviewers],
  );
  const keyIds = approvalRoleIds(approvals).filter((id) => !users.has(id));
  const { data: keyRoleData } = useApi<{
    roles: Record<string, MemberRoleWithProjects | null>;
  }>(`/keys/approver-roles?ids=${keyIds.map(encodeURIComponent).join(",")}`, {
    shouldRun: () => keyIds.length > 0,
  });
  const roleFor = useCallback(
    (id: string): MemberRoleWithProjects | null =>
      users.get(id) ?? keyRoleData?.roles[id] ?? null,
    [users, keyRoleData],
  );
  const approvers = useMemo(
    () => approvalApprovers(approvals, roleFor),
    [approvals, roleFor],
  );

  const coverage = useMemo(
    () =>
      assessGoverningApprovalCoverage({
        org: organization as OrganizationInterface,
        teams: (teams ?? []) as TeamInterface[],
        model,
        projects,
        approverProjects,
        footprint,
        approvers,
      }),
    [
      approvers,
      organization,
      teams,
      model,
      projects,
      approverProjects,
      footprint,
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
        name: getProjectById(id)?.name ?? null,
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
      const approver = approvers.find((a) => a.id === approverId);
      const roles = approver
        ? approver.assumingKeyRole === undefined
          ? [approver.roleInfo]
          : [approver.roleInfo, approver.assumingKeyRole]
        : [];
      // The approver may be a member or an org key; an assuming key is a key.
      const isMember = !!organization.members?.some((m) => m.id === approverId);
      const perms = roles.map(
        (roleInfo, i) =>
          roleInfo &&
          getRolePermissions(
            roleInfo,
            organization as OrganizationInterface,
            (teams ?? []) as TeamInterface[],
            undefined,
            { member: i === 0 && isMember },
          ),
      );
      const held = envIds.filter(
        (env) =>
          perms.length > 0 &&
          perms.every(
            (p) =>
              !!p &&
              userHasPermission(
                p,
                reviewPermission,
                projects.length ? projects : undefined,
                [env],
              ),
          ),
      );
      cache.set(approverId, held);
      return held;
    };
  }, [approvers, organization, teams, envIds, model, projects]);

  const uncoveredApproverReasons = useMemo(() => {
    const reason = (approverId: string): string => {
      const member = users.get(approverId);
      const who = member?.name || member?.email || "this reviewer";
      const approver = approvers.find((a) => a.id === approverId);
      const user = reviewers.find((r) => r.id === approverId)?.user;
      if (!approver?.roleInfo) {
        return user?.type === "api_key" && user.apiKey === approverId
          ? "this API key is disabled, expired or removed"
          : `${who} is no longer a member of this organization`;
      }
      if (approver.assumingKeyRole === null) {
        return "the API key it came through is disabled, expired or removed";
      }
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
  }, [uncoveredApprovers, users, approvers, reviewers, footprint, heldEnvsFor]);

  const uncoveredFootprintEnvs = useMemo(() => {
    if (footprint.scope !== "environments") return [];
    const covered = new Set<string>();
    reviewers
      .filter((r) => r.status === "approved")
      .forEach((r) => heldEnvsFor(r.id).forEach((e) => covered.add(e)));
    return footprint.environments.filter((e) => !covered.has(e));
  }, [footprint, reviewers, heldEnvsFor]);

  // Only the primary project's coverage sanctions the change; a targeting
  // reviewer contributes without covering.
  const approvalsCoverFootprint = coverage.hasCoveringApproval;

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
      !approvalsCoverFootprint &&
      reviewers.some((r) => r.status === "approved"),
    requiredTeams,
    requiredProjects,
  };
}
