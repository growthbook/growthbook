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
