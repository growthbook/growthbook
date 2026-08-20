import { ReactNode } from "react";
import { OrganizationInterface } from "shared/types/organization";
import {
  envScopedPermissionsForRole,
  getRoleDisplayName,
} from "shared/permissions";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function RoleRuleLabel({
  role,
  limitAccessByEnvironment,
  environments,
  organization,
  sources,
}: {
  role: string;
  limitAccessByEnvironment: boolean;
  environments: string[];
  organization: Partial<OrganizationInterface>;
  sources?: ReactNode;
}) {
  // A restriction on a role that grants nothing env-scoped has no effect, so
  // showing one would imply a limit that isn't there.
  const limited =
    limitAccessByEnvironment &&
    !!envScopedPermissionsForRole(role, organization).length;
  const name = getRoleDisplayName(role, organization);

  return (
    <>
      {sources ? (
        <Tooltip body={sources}>
          <span style={{ textDecoration: "underline dotted" }}>{name}</span>
        </Tooltip>
      ) : (
        name
      )}
      {limited && (
        <span className="text-muted">
          {" — "}
          {environments.length ? environments.join(", ") : "no environments"}
        </span>
      )}
    </>
  );
}

type Rule = {
  role: string;
  limitAccessByEnvironment?: boolean;
  environments?: string[];
};

/** Every rule a scope grants: its base role plus any additional rules. */
export function scopeRules(scope: Rule & { additionalRoles?: Rule[] }) {
  return [scope, ...(scope.additionalRoles ?? [])].map((rule) => ({
    role: rule.role,
    limitAccessByEnvironment: !!rule.limitAccessByEnvironment,
    environments: rule.environments ?? [],
  }));
}

/** One line per rule, the standard way to show what a scope grants. */
export function RoleRuleLines({
  scope,
  organization,
}: {
  scope: Rule & { additionalRoles?: Rule[] };
  organization: Partial<OrganizationInterface>;
}) {
  return (
    <>
      {scopeRules(scope).map((rule, i) => (
        <div key={i}>
          <RoleRuleLabel {...rule} organization={organization} />
        </div>
      ))}
    </>
  );
}
