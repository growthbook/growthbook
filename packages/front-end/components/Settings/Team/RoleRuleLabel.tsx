import { ReactNode } from "react";
import { OrganizationInterface } from "shared/types/organization";
import {
  envScopedPermissionsForRole,
  getRoleDisplayName,
  holdsGlobalAdmin,
  shadowedByAdmin,
} from "shared/permissions";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import { Popover } from "@/ui/Popover";
import Tooltip from "@/ui/Tooltip";

export default function RoleRuleLabel({
  role,
  limitAccessByEnvironment,
  environments,
  organization,
  sources,
  shadowed = [],
}: {
  role: string;
  limitAccessByEnvironment: boolean;
  environments: string[];
  organization: Partial<OrganizationInterface>;
  sources?: ReactNode;
  // Rules this Admin rule makes moot.
  shadowed?: RuleRow[];
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
        <Tooltip content={sources}>
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
      {shadowed.length > 0 && (
        <Box mt="1">
          <ShadowedRulesChip rows={shadowed} />
        </Box>
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
  shadowedProjects,
}: {
  scope: Rule & { additionalRoles?: Rule[] };
  organization: Partial<OrganizationInterface>;
  shadowedProjects?: RuleRow[];
}) {
  return (
    <>
      {ruleRows(scope, organization, { shadowedProjects }).map((row) => (
        <div key={row.key}>{row.node}</div>
      ))}
    </>
  );
}

export type RuleRow = { key: string; node: ReactNode; heading?: boolean };

/**
 * A scope's rules, one row each. Beside Admin the others have no effect, so
 * they sit behind its chip, along with any `shadowedProjects` rows.
 */
export function ruleRows(
  scope: Rule & { additionalRoles?: Rule[] },
  organization: Partial<OrganizationInterface>,
  { shadowedProjects = [] }: { shadowedProjects?: RuleRow[] } = {},
): RuleRow[] {
  const labelRows = (rules: ReturnType<typeof scopeRules>) =>
    rules.map((rule, i) => ({
      key: `${i}`,
      node: <RoleRuleLabel {...rule} organization={organization} />,
    }));
  const { applied, shadowed } = shadowedByAdmin(scopeRules(scope));
  if (applied[0]?.role !== "admin") return labelRows(applied);
  return [
    {
      key: "admin",
      node: (
        <RoleRuleLabel
          {...applied[0]}
          organization={organization}
          shadowed={[...labelRows(shadowed), ...shadowedProjects]}
        />
      ),
    },
  ];
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

/**
 * Role and Project Roles cells for a member, invite or team, or for one
 * `project`. A global Admin's project rules have no effect, so they sit behind
 * a chip: in the Project Roles cell, or Admin's own without a `projectColumn`.
 */
export function memberRuleRows(
  scope: Rule & {
    additionalRoles?: Rule[];
    projectRoles?: (Rule & { project: string; additionalRoles?: Rule[] })[];
  },
  getProjectById: (id: string) => { id: string; name: string } | null,
  organization: Partial<OrganizationInterface>,
  {
    project,
    projectColumn = !project,
  }: { project?: string; projectColumn?: boolean } = {},
): { roles: RuleRow[]; projectRoles: RuleRow[] } {
  const projectRoles = (scope.projectRoles ?? []).filter(
    (r) => !project || r.project === project,
  );
  const projectRows = projectRuleRows(
    projectRoles,
    getProjectById,
    organization,
  );
  if (holdsGlobalAdmin(scope, [])) {
    return projectColumn
      ? {
          roles: ruleRows(scope, organization),
          projectRoles: shadowedRulesCell(projectRows),
        }
      : {
          roles: ruleRows(scope, organization, {
            shadowedProjects: projectRows,
          }),
          projectRoles: [],
        };
  }
  return {
    roles: ruleRows((project && projectRoles[0]) || scope, organization),
    projectRoles: projectRows,
  };
}

const ruleCount = (rows: RuleRow[]) =>
  rows.filter((row) => !row.heading).length;

/** "N roles shadowed by Admin", listing them on hover. */
function ShadowedRulesChip({ rows }: { rows: RuleRow[] }) {
  const count = ruleCount(rows);
  return (
    <RuleRowsChip
      rows={rows}
      label={`${count} role${count === 1 ? "" : "s"} shadowed by Admin`}
    />
  );
}

/** A cell of rules Admin shadows: just the chip, or nothing. */
export function shadowedRulesCell(rows: RuleRow[]): RuleRow[] {
  return rows.length
    ? [{ key: "shadowed", node: <ShadowedRulesChip rows={rows} /> }]
    : [];
}

/** A gray chip that lists these rows on hover. */
function RuleRowsChip({ rows, label }: { rows: RuleRow[]; label: string }) {
  return (
    <Popover
      openOnHover
      side="bottom"
      align="start"
      content={
        <Flex direction="column" gap="1" align="start">
          {rows.map((row, i) => (
            <Box key={row.key} mt={row.heading && i > 0 ? "1" : undefined}>
              {row.node}
            </Box>
          ))}
        </Flex>
      }
      trigger={
        // Wraps rather than spilling out of a narrow table cell.
        <Badge
          color="gray"
          variant="soft"
          label={label}
          style={{ whiteSpace: "normal", maxWidth: "100%" }}
        />
      }
    />
  );
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
  const hiddenRules = ruleCount(hidden);

  return (
    <>
      {shown.map((row, i) => (
        <Box key={row.key} mt={row.heading && i > 0 ? "2" : undefined}>
          {row.node}
        </Box>
      ))}
      {hidden.length > 0 && (
        <Box mt="1">
          <RuleRowsChip
            rows={hidden}
            label={`+${hiddenRules} more rule${hiddenRules === 1 ? "" : "s"}`}
          />
        </Box>
      )}
    </>
  );
}
