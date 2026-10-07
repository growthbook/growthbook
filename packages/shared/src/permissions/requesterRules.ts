import type { MemberRoleWithProjects } from "shared/types/organization";

type Rule = {
  role: string;
  limitAccessByEnvironment?: boolean;
  environments?: string[];
  requesterOnly?: boolean;
};

// An org API key's role rules, any of which can apply only as far as the
// member named in `X-Requested-By` has the same permissions.
export type RequesterRules = Rule & {
  additionalRoles?: Rule[];
  projectRoles?: (Rule & { project: string; additionalRoles?: Rule[] })[];
};

const NOTHING = { role: "noaccess", limitAccessByEnvironment: false };

export function hasRequesterOnlyRules(
  rules: Pick<
    RequesterRules,
    "requesterOnly" | "additionalRoles" | "projectRoles"
  >,
): boolean {
  return (
    !!rules.requesterOnly ||
    !!rules.additionalRoles?.some((r) => r.requesterOnly) ||
    !!rules.projectRoles?.some(
      (pr) =>
        pr.requesterOnly || pr.additionalRoles?.some((r) => r.requesterOnly),
    )
  );
}

export type RequesterExtension = "none" | "all" | "specific";

// How a key extends a request with the member it names: not at all, with all
// of that member's permissions, or through requester-only rules.
export function requesterExtension(
  key: Pick<
    RequesterRules,
    "requesterOnly" | "additionalRoles" | "projectRoles"
  > & { extendWithRequester?: boolean },
): RequesterExtension {
  if (key.extendWithRequester) return "all";
  return hasRequesterOnlyRules(key) ? "specific" : "none";
}

// Splits the rules into those every request gets and those that only reach a
// request through its named member. A project group still replaces the All
// Projects rules inside it on both sides.
export function splitRequesterOnlyRules(rules: RequesterRules): {
  always: MemberRoleWithProjects;
  requesterOnly: MemberRoleWithProjects;
} {
  const side = (requesterOnly: boolean): MemberRoleWithProjects => {
    const keep = (rule: Rule) => !!rule.requesterOnly === requesterOnly;
    const plain = (rule: Rule) =>
      keep(rule)
        ? {
            role: rule.role,
            limitAccessByEnvironment: !!rule.limitAccessByEnvironment,
            environments: rule.environments ?? [],
          }
        : { ...NOTHING, environments: [] };
    const additional = (list: Rule[] | undefined) =>
      (list ?? []).filter(keep).map(plain);
    return {
      ...plain(rules),
      additionalRoles: additional(rules.additionalRoles),
      projectRoles: (rules.projectRoles ?? []).map((pr) => ({
        project: pr.project,
        ...plain(pr),
        additionalRoles: additional(pr.additionalRoles),
      })),
    };
  };
  return { always: side(false), requesterOnly: side(true) };
}
