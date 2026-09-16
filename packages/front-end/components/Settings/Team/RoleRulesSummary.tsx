import { Box, Flex } from "@radix-ui/themes";
import { MemberRoleWithProjects } from "shared/types/organization";
import Frame from "@/ui/Frame";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Badge from "@/ui/Badge";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import RoleRuleLabel, { scopeRules } from "./RoleRuleLabel";

const MAX_RULES_SHOWN = 3;

export function RoleRulesSummary({
  value,
  size = "sm",
}: {
  value: MemberRoleWithProjects;
  size?: "sm" | "md";
}) {
  const { organization } = useUser();
  const { getProjectById } = useDefinitions();

  // Global rules first, then one line per project rule.
  const rules = [
    ...scopeRules(value).map((rule) => ({ ...rule, project: "" })),
    ...(value.projectRoles ?? []).flatMap((projectRule) =>
      scopeRules(projectRule).map((rule) => ({
        ...rule,
        project:
          getProjectById(projectRule.project)?.name ?? projectRule.project,
      })),
    ),
  ];
  const shown = rules.slice(0, MAX_RULES_SHOWN);
  const hidden = rules.length - shown.length;

  return (
    <Flex direction="column" gap="1">
      {shown.map(({ project, ...rule }, i) => (
        <Text key={i} as="div" size={size}>
          <RoleRuleLabel {...rule} organization={organization} />
          {project && (
            <Text as="span" color="text-low">
              {" · "}
              {project}
            </Text>
          )}
        </Text>
      ))}
      {hidden > 0 && (
        <Box>
          <Badge
            color="gray"
            variant="soft"
            label={`+${hidden} more rule${hidden > 1 ? "s" : ""}`}
          />
        </Box>
      )}
    </Flex>
  );
}

/** Collapsed form of the rules table: what it resolves to, plus a way in. */
export default function RoleRulesSummaryRow({
  label,
  value,
  onEdit,
  disabled = false,
}: {
  label: string;
  value: MemberRoleWithProjects;
  onEdit: () => void;
  disabled?: boolean;
}) {
  return (
    <Frame px="3" py="2" mb="4">
      <Flex align="start" justify="between" gap="3">
        <Flex direction="column" gap="1">
          <Heading as="h5" size="sm" mb="0">
            {label}
          </Heading>
          <RoleRulesSummary value={value} size="md" />
        </Flex>
        <Button variant="ghost" disabled={disabled} onClick={onEdit}>
          Edit
        </Button>
      </Flex>
    </Frame>
  );
}
