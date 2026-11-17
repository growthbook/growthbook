import { Flex } from "@radix-ui/themes";
import { MemberRoleWithProjects } from "shared/types/organization";
import Frame from "@/ui/Frame";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { CollapsedRuleRows, memberRuleRows } from "./RoleRuleLabel";

export function RoleRulesSummary({ value }: { value: MemberRoleWithProjects }) {
  const { organization } = useUser();
  const { getProjectById } = useDefinitions();

  const { roles, projectRoles } = memberRuleRows(
    value,
    getProjectById,
    organization,
    { projectColumn: false },
  );
  return <CollapsedRuleRows rows={[...roles, ...projectRoles]} />;
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
          <Heading as="h5" size="sm" weight="medium" mb="0">
            {label}
          </Heading>
          <Text as="div" color="text-mid">
            <RoleRulesSummary value={value} />
          </Text>
        </Flex>
        <Button variant="ghost" disabled={disabled} onClick={onEdit}>
          Edit
        </Button>
      </Flex>
    </Frame>
  );
}
