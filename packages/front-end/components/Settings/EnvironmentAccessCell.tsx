import { Environment, OrganizationInterface } from "shared/types/organization";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import { memberEnvAccess } from "@/services/auth";

type Principal = Parameters<typeof memberEnvAccess>[0];

export default function EnvironmentAccessCell({
  principal,
  environments,
  organization,
  project,
}: {
  principal: Principal;
  environments: Environment[];
  organization: Partial<OrganizationInterface>;
  project: string;
}) {
  const access = environments.map((env) => ({
    id: env.id,
    access: memberEnvAccess(principal, env, organization, project),
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

  return (
    <Tooltip
      body={
        <>
          {access.map((e) => (
            <div key={e.id}>
              {e.id} —{" "}
              {e.access === "yes"
                ? "allowed"
                : e.access === "no"
                  ? "not allowed"
                  : "not applicable"}
            </div>
          ))}
        </>
      }
    >
      <span style={{ textDecoration: "underline dotted" }}>{label}</span>
    </Tooltip>
  );
}
