import { useMemo } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { getRoleDisplayName } from "shared/permissions";
import { PiTrash, PiInfo, PiPlus, PiPlusBold } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Button from "@/ui/Button";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import EnvironmentCell from "./EnvironmentCell";
import useRoleOptions from "./useRoleOptions";
import {
  ALL_PROJECTS,
  RoleRule,
  RoleRulesValue,
  TeamRuleSource,
  fromRules,
  inertRules,
  newRule,
  toRules,
} from "./roleRules";

// Columns: plus, role, environments, applies, from, badges, remove.
const columnWidths = (showFrom: boolean, showApplies: boolean) => {
  if (showApplies) {
    return showFrom
      ? ["4%", "20%", "24%", "18%", "14%", "15%", "5%"]
      : ["4%", "24%", "28%", "22%", "0%", "17%", "5%"];
  }
  return showFrom
    ? ["4%", "24%", "30%", "0%", "16%", "21%", "5%"]
    : ["4%", "28%", "38%", "0%", "0%", "25%", "5%"];
};

const APPLIES_OPTIONS = [
  { value: "always", label: "Always" },
  { value: "requester", label: "If the requester has it" },
];

const PLUS = (
  <Text color="text-low">
    <PiPlusBold size={11} />
  </Text>
);

export default function RoleRulesTable({
  value,
  setValue,
  teams = [],
  showAppliesColumn = false,
}: {
  value: RoleRulesValue;
  setValue: (value: RoleRulesValue) => void;
  teams?: TeamRuleSource[];
  // API keys only: choose per rule whether it always applies or only as far as
  // the member named in X-Requested-By has it.
  showAppliesColumn?: boolean;
}) {
  const { organization, hasCommercialFeature } = useUser();
  const hasAdvancedPermissions = hasCommercialFeature("advanced-permissions");
  const { projects } = useDefinitions();

  const rules = useMemo(() => toRules(value, teams), [value, teams]);
  const inert = useMemo(
    () => inertRules(rules, organization),
    [rules, organization],
  );

  // Rules in a group add together; a project group replaces the All Projects one.
  const groups = useMemo(() => {
    const scopes = [...new Set(rules.map((r) => r.project))].sort((a, b) =>
      a === ALL_PROJECTS ? -1 : b === ALL_PROJECTS ? 1 : 0,
    );
    return scopes.map((scope) => ({
      scope,
      rules: [
        ...rules.filter((r) => r.project === scope && r.source === "direct"),
        ...rules.filter((r) => r.project === scope && r.source === "team"),
      ],
    }));
  }, [rules]);

  // Nothing inherited means the column would say "This member" on every row.
  const showFrom = rules.some((r) => r.source === "team");
  const WIDTHS = columnWidths(showFrom, showAppliesColumn);
  const columnCount = 5 + (showFrom ? 1 : 0) + (showAppliesColumn ? 1 : 0);

  const commit = (next: RoleRule[]) => setValue(fromRules(next, value));
  const patch = (key: string, changes: Partial<RoleRule>) =>
    commit(rules.map((r) => (r.key === key ? { ...r, ...changes } : r)));

  const globalRoleOptions = useRoleOptions({ includeAdminRole: true });
  const projectRoleOptions = useRoleOptions({ includeProjectAdminRole: true });

  const projectLabel = (id: string) =>
    projects.find((p) => p.id === id)?.name ?? id;

  const usedScopes = new Set(groups.map((g) => g.scope));
  const unusedProjects = projects.filter((p) => !usedScopes.has(p.id));

  const addRule = (scope: string) =>
    commit([...rules, { ...newRule(), project: scope }]);

  const retargetGroup = (from: string, to: string) =>
    commit(
      rules.map((r) =>
        r.project === from && r.source === "direct" ? { ...r, project: to } : r,
      ),
    );

  const inertReason = (
    rule: RoleRule,
    reason?: "empty" | "rules" | "teams",
  ) => {
    const role = getRoleDisplayName(rule.role, organization);
    if (reason === "empty") {
      return `${role} grants no permissions at all. It does not take away anything the other rules grant.`;
    }
    const source =
      reason === "teams"
        ? "one of this member's teams"
        : "another rule in this group";
    const removable = rule.source === "direct" && !rule.isPrimary;
    return `Rules in a group add together, and everything ${role} grants is already granted by ${source}.${removable ? " Removing it would change nothing." : ""}`;
  };

  const renderRow = (rule: RoleRule, i: number) => {
    const fromTeam = rule.source === "team";

    return (
      <TableRow key={rule.key} style={{ verticalAlign: "middle" }}>
        <TableCell width={WIDTHS[0]}>{i > 0 && PLUS}</TableCell>
        <TableCell width={WIDTHS[1]}>
          {fromTeam ? (
            <Text>{getRoleDisplayName(rule.role, organization)}</Text>
          ) : (
            <SelectField
              value={rule.role}
              options={
                rule.project === ALL_PROJECTS
                  ? globalRoleOptions
                  : projectRoleOptions
              }
              onChange={(role) => patch(rule.key, { role })}
              sort={false}
              containerClassName="mb-0"
            />
          )}
        </TableCell>
        <TableCell width={WIDTHS[2]}>
          <EnvironmentCell
            role={rule.role}
            environments={rule.environments}
            limitAccessByEnvironment={rule.limitAccessByEnvironment}
            // Server-gated premium feature; read-only here when unlicensed.
            disabled={fromTeam || !hasAdvancedPermissions}
            onChange={(next) => patch(rule.key, next)}
          />
        </TableCell>
        {showAppliesColumn && (
          <TableCell width={WIDTHS[3]}>
            {fromTeam ? (
              <Text color="text-low">Always</Text>
            ) : (
              <SelectField
                value={rule.requesterOnly ? "requester" : "always"}
                options={APPLIES_OPTIONS}
                onChange={(applies) =>
                  patch(rule.key, { requesterOnly: applies === "requester" })
                }
                sort={false}
                containerClassName="mb-0"
              />
            )}
          </TableCell>
        )}
        {showFrom && (
          <TableCell width={WIDTHS[4]}>
            {fromTeam ? (
              <Tooltip
                body={`Inherited from the ${rule.teamName} team. Change it there.`}
              >
                <Link href="/settings/team#teams">{rule.teamName}</Link>
              </Tooltip>
            ) : (
              <Text color="text-low">This member</Text>
            )}
          </TableCell>
        )}
        <TableCell width={WIDTHS[5]}>
          <Flex align="center" gap="1" justify="end" wrap="wrap">
            {inert.has(rule.key) && (
              <Tooltip body={inertReason(rule, inert.get(rule.key))}>
                <Badge
                  color="gray"
                  variant="soft"
                  label={
                    <Flex align="center" gap="1">
                      <PiInfo />{" "}
                      {inert.get(rule.key) === "empty"
                        ? "Grants nothing"
                        : "Already covered"}
                    </Flex>
                  }
                />
              </Tooltip>
            )}
          </Flex>
        </TableCell>
        <TableCell width={WIDTHS[6]}>
          <Flex align="center" justify="end">
            {!fromTeam && !rule.isPrimary && (
              <Tooltip body="Remove rule">
                <IconButton
                  variant="ghost"
                  color="red"
                  radius="full"
                  size="3"
                  style={{ margin: 0 }}
                  aria-label="Remove rule"
                  onClick={() =>
                    commit(rules.filter((r) => r.key !== rule.key))
                  }
                >
                  <PiTrash size={16} />
                </IconButton>
              </Tooltip>
            )}
          </Flex>
        </TableCell>
      </TableRow>
    );
  };

  const renderGroup = ({
    scope,
    rules: scopedRules,
  }: {
    scope: string;
    rules: RoleRule[];
  }) => {
    const isAllProjects = scope === ALL_PROJECTS;
    const editable = scopedRules.some((r) => r.source === "direct");

    return (
      <Box key={scope} mb="5">
        <Flex align="center" gap="2" mb="2" minHeight="32px">
          {isAllProjects || !editable ? (
            <Text weight="medium">
              {isAllProjects ? "All Projects" : projectLabel(scope)}
            </Text>
          ) : (
            <Box width="200px">
              <SelectField
                value={scope}
                options={[
                  { value: scope, label: projectLabel(scope) },
                  ...unusedProjects.map((p) => ({
                    value: p.id,
                    label: p.name,
                  })),
                ]}
                onChange={(next) => retargetGroup(scope, next)}
                sort={false}
                containerClassName="mb-0"
              />
            </Box>
          )}
          {!isAllProjects && (
            <Text size="sm" color="text-low">
              replaces the All Projects rules inside it
            </Text>
          )}
        </Flex>

        <Table variant="surface" layout="fixed">
          <TableHeader>
            <TableRow>
              <TableColumnHeader width={WIDTHS[0]} />
              <TableColumnHeader width={WIDTHS[1]}>Role</TableColumnHeader>
              <TableColumnHeader width={WIDTHS[2]}>
                Environments
              </TableColumnHeader>
              {showAppliesColumn && (
                <TableColumnHeader width={WIDTHS[3]}>Applies</TableColumnHeader>
              )}
              {showFrom && (
                <TableColumnHeader width={WIDTHS[4]}>From</TableColumnHeader>
              )}
              <TableColumnHeader width={WIDTHS[5]} />
              <TableColumnHeader width={WIDTHS[6]} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {scopedRules.map(renderRow)}
            <TableRow style={{ verticalAlign: "middle" }}>
              <TableCell width={WIDTHS[0]}>{PLUS}</TableCell>
              <TableCell colSpan={columnCount - 1}>
                <Link weight="medium" onClick={() => addRule(scope)}>
                  Add role
                </Link>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Box>
    );
  };

  return (
    <Box>
      {groups.map(renderGroup)}
      {unusedProjects.length > 0 && hasAdvancedPermissions && (
        <Button variant="soft" onClick={() => addRule(unusedProjects[0].id)}>
          <PiPlus /> Add project override
        </Button>
      )}
    </Box>
  );
}
