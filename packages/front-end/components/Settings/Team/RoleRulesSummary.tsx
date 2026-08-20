import { Flex } from "@radix-ui/themes";
import { MemberRoleWithProjects } from "shared/types/organization";
import { getRoleDisplayName } from "shared/permissions";
import Frame from "@/ui/Frame";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import { useUser } from "@/services/UserContext";

export function RoleRulesSummary({ value }: { value: MemberRoleWithProjects }) {
  const { organization } = useUser();

  const extraRules =
    (value.additionalRoles?.length || 0) + (value.projectRoles?.length || 0);

  const environments = !value.limitAccessByEnvironment
    ? "all environments"
    : value.environments?.length
      ? value.environments.join(", ")
      : "no environments";

  return (
    <Flex align="center" gap="2" wrap="wrap">
      <Text size="sm" weight="medium">
        {getRoleDisplayName(value.role, organization)} in {environments}
      </Text>
      {extraRules > 0 && (
        <Badge
          color="gray"
          variant="soft"
          label={`+${extraRules} more rule${extraRules > 1 ? "s" : ""}`}
        />
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
      <Flex align="center" justify="between" gap="3">
        <Flex align="center" gap="2" wrap="wrap">
          <Text size="sm" color="text-low">
            {label}
          </Text>
          <RoleRulesSummary value={value} />
        </Flex>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onEdit}>
          Edit
        </Button>
      </Flex>
    </Frame>
  );
}
