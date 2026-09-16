import { Flex } from "@radix-ui/themes";
import { MemberRoleWithProjects } from "shared/types/organization";
import Frame from "@/ui/Frame";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { CollapsedRuleRows, projectRuleRows, ruleRows } from "./RoleRuleLabel";

export function RoleRulesSummary({ value }: { value: MemberRoleWithProjects }) {
  const { organization } = useUser();
  const { getProjectById } = useDefinitions();

  const rows = [
    ...ruleRows(value, organization),
    ...projectRuleRows(
      value.projectRoles ?? [],
      (id) => getProjectById(id)?.name ?? id,
      organization,
    ),
  ];
  return <CollapsedRuleRows rows={rows} />;
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
          <RoleRulesSummary value={value} />
        </Flex>
        <Button variant="ghost" disabled={disabled} onClick={onEdit}>
          Edit
        </Button>
      </Flex>
    </Frame>
  );
}
