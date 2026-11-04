import { Flex } from "@radix-ui/themes";
import {
  envScopeLabels,
  envScopedPermissionsForRole,
  getRoleDisplayName,
} from "shared/permissions";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import EnvironmentScopeCell from "@/components/Settings/EnvironmentScopeCell";

function joinActions(actions: string[]): string {
  if (actions.length <= 1) return actions[0] ?? "";
  return `${actions.slice(0, -1).join(", ")} or ${actions[actions.length - 1]}`;
}

export default function EnvironmentCell({
  role,
  environments,
  limitAccessByEnvironment,
  onChange,
  disabled = false,
}: {
  role: string;
  environments: string[];
  limitAccessByEnvironment: boolean;
  onChange?: (next: {
    environments: string[];
    limitAccessByEnvironment: boolean;
  }) => void;
  disabled?: boolean;
}) {
  const { organization } = useUser();

  const editable = !disabled && !!onChange;
  const scopedPermissions = envScopedPermissionsForRole(role, organization);
  const blockedActions = joinActions(envScopeLabels(role, organization));

  if (!scopedPermissions.length) {
    return (
      <Flex align="center" minHeight={editable ? "32px" : undefined}>
        <Tooltip body="This role grants nothing that is environment-scoped, so limiting environments would have no effect.">
          <Text color="text-low">Not applicable</Text>
        </Tooltip>
      </Flex>
    );
  }

  return (
    <EnvironmentScopeCell
      environments={limitAccessByEnvironment ? environments : null}
      onChange={
        editable
          ? (next) =>
              onChange?.(
                next === null
                  ? { environments: [], limitAccessByEnvironment: false }
                  : { environments: next, limitAccessByEnvironment: true },
              )
          : undefined
      }
      noneLabel={
        <Tooltip
          body={`Cannot ${blockedActions} in any environment. Everything else ${getRoleDisplayName(role, organization)} grants is not environment-scoped and still applies.`}
        >
          <Badge color="amber" variant="soft" label="No environments" />
        </Tooltip>
      }
    />
  );
}
