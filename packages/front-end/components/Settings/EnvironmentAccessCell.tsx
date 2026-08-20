import { Fragment } from "react";
import { Environment, OrganizationInterface } from "shared/types/organization";
import {
  EnvAccessSource,
  envScopeLabels,
  getRoleDisplayName,
  memberEnvAccess,
} from "shared/permissions";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";

type Principal = Parameters<typeof memberEnvAccess>[0];
type Teams = NonNullable<Parameters<typeof memberEnvAccess>[4]>;

const NO_ACCESS = {
  no: "no access",
  "N/A": "not applicable",
} as const;

export default function EnvironmentAccessCell({
  principal,
  environments,
  organization,
  project,
  teams = [],
}: {
  principal: Principal;
  environments: Environment[];
  organization: Partial<OrganizationInterface>;
  project: string;
  teams?: Teams;
}) {
  const access = environments.map((env) => ({
    id: env.id,
    ...memberEnvAccess(principal, env, organization, project, teams),
  }));

  const applicable = access.filter((e) => e.access !== "N/A");
  const allowed = applicable.filter((e) => e.access === "yes");

  if (!applicable.length) return <Text color="text-low">N/A</Text>;

  const label = !allowed.length ? (
    <Text color="text-low">None</Text>
  ) : allowed.length === applicable.length ? (
    <Text>All</Text>
  ) : (
    <Text>{allowed.map((e) => e.id).join(", ")}</Text>
  );

  // What the rule lets you do here, which matters more than where it came from.
  const grant = (s: EnvAccessSource) => {
    const scopes = envScopeLabels(s.role, organization);
    const role = getRoleDisplayName(s.role, organization);
    return scopes.length ? `${scopes.join(", ")} · ${role}` : role;
  };

  return (
    <Tooltip
      body={
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto auto",
            columnGap: 16,
            rowGap: 8,
          }}
        >
          {access.map((e) => (
            <Fragment key={e.id}>
              <div style={{ whiteSpace: "nowrap", fontWeight: 500 }}>
                {e.id}
              </div>
              <div>
                {e.access === "yes" ? (
                  e.sources
                    .filter((s) => s.access === "yes")
                    .map((s) => (
                      <div key={s.sourceType + s.sourceName + s.role}>
                        {grant(s)}
                        {s.sourceType === "team" && (
                          <div className="text-muted">Team: {s.sourceName}</div>
                        )}
                      </div>
                    ))
                ) : (
                  <span className="text-muted">
                    {NO_ACCESS[e.access]}
                    {e.outsideProject && " — not in this project"}
                  </span>
                )}
              </div>
            </Fragment>
          ))}
        </div>
      }
    >
      <span style={{ textDecoration: "underline dotted" }}>{label}</span>
    </Tooltip>
  );
}
