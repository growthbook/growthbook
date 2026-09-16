import { ReactNode } from "react";
import { OrganizationInterface } from "shared/types/organization";
import {
  envScopedPermissionsForRole,
  getRoleDisplayName,
} from "shared/permissions";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
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
        <Text as="span" color="text-low">
          {" — "}
          {environments.length ? environments.join(", ") : "No environments"}
        </Text>
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

export type RuleRow = { key: string; node: ReactNode; heading?: boolean };

export function ruleRows(
  scope: Rule & { additionalRoles?: Rule[] },
  organization: Partial<OrganizationInterface>,
): RuleRow[] {
  return scopeRules(scope).map((rule, i) => ({
    key: `${i}`,
    node: <RoleRuleLabel {...rule} organization={organization} />,
  }));
}

/** A project's rules under its name, for a Project Roles table cell. */
export function projectRuleGroup(
  project: { id: string; name: string },
  rules: RuleRow[],
): RuleRow[] {
  return [
    {
      key: project.id,
      heading: true,
      node: (
        <Text as="div" weight="medium" color="text-high">
          {project.name}
        </Text>
      ),
    },
    ...rules.map((row) => ({ ...row, key: `${project.id}-${row.key}` })),
  ];
}

export function projectRuleRows(
  projectRoles: (Rule & { project: string; additionalRoles?: Rule[] })[],
  getProjectById: (id: string) => { id: string; name: string } | null,
  organization: Partial<OrganizationInterface>,
): RuleRow[] {
  return projectRoles.flatMap((scope) => {
    const project = getProjectById(scope.project);
    return project
      ? projectRuleGroup(project, ruleRows(scope, organization))
      : [];
  });
}

const MAX_RULE_ROWS = 4;

/**
 * Up to four rows, the rest behind a "+N more rules" chip. A heading never
 * ends the visible part; its rules move behind the chip with it.
 */
export function CollapsedRuleRows({ rows }: { rows: RuleRow[] }) {
  let cut = Math.min(rows.length, MAX_RULE_ROWS);
  if (cut < rows.length && rows[cut - 1].heading) cut -= 1;
  const shown = rows.slice(0, cut);
  const hidden = rows.slice(cut);
  const hiddenRules = hidden.filter((row) => !row.heading).length;

  return (
    <>
      {shown.map((row, i) => (
        <Box key={row.key} mt={row.heading && i > 0 ? "2" : undefined}>
          {row.node}
        </Box>
      ))}
      {hidden.length > 0 && (
        <Box mt="1">
          <Tooltip
            body={
              <Flex direction="column" gap="1" align="start">
                {hidden.map((row, i) => (
                  <Box
                    key={row.key}
                    mt={row.heading && i > 0 ? "1" : undefined}
                  >
                    {row.node}
                  </Box>
                ))}
              </Flex>
            }
          >
            <Badge
              color="gray"
              variant="soft"
              label={`+${hiddenRules} more rule${hiddenRules === 1 ? "" : "s"}`}
            />
          </Tooltip>
        </Box>
      )}
    </>
  );
}
