import { useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPencilSimple } from "react-icons/pi";
import {
  envScopedPermissionsForRole,
  getRoleDisplayName,
} from "shared/permissions";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";
import MultiSelectField from "@/ui/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";

const ACTION_LABELS: Record<string, string> = {
  createFeatures: "create",
  createConfigs: "create",
  createConstants: "create",
  deleteFeatures: "delete",
  deleteConfigs: "delete",
  deleteConstants: "delete",
  publishFeatures: "publish",
  publishConfigs: "publish",
  publishConstants: "publish",
  revertFeatures: "revert",
  revertConfigs: "revert",
  revertConstants: "revert",
  manageEnvironments: "manage environments",
  manageSDKConnections: "manage SDK connections",
  manageSDKWebhooks: "manage SDK webhooks",
  runExperiments: "run experiments",
};

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
  onChange: (next: {
    environments: string[];
    limitAccessByEnvironment: boolean;
  }) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const { organization } = useUser();
  const envOptions = useEnvironments().map((e) => ({
    label: e.id,
    value: e.id,
  }));

  const scopedPermissions = envScopedPermissionsForRole(role, organization);
  const blockedActions = joinActions([
    ...new Set(scopedPermissions.map((p) => ACTION_LABELS[p] ?? p)),
  ]);

  if (!scopedPermissions.length) {
    return (
      <Tooltip body="This role grants nothing that is environment-scoped, so limiting environments would have no effect.">
        <Text color="text-low">Not applicable</Text>
      </Tooltip>
    );
  }

  if (!editing) {
    const label = !limitAccessByEnvironment ? (
      <Text>All environments</Text>
    ) : environments.length ? (
      <Text>{environments.join(", ")}</Text>
    ) : (
      <Tooltip
        body={`Cannot ${blockedActions} in any environment. Everything else ${getRoleDisplayName(role, organization)} grants is not environment-scoped and still applies.`}
      >
        <Badge color="amber" variant="soft" label="No environments" />
      </Tooltip>
    );

    return (
      <Flex align="center" gap="2" minHeight="32px">
        {label}
        {!disabled && (
          <IconButton
            variant="ghost"
            radius="full"
            size="1"
            onClick={() => {
              setEditing(true);
              onChange({ environments, limitAccessByEnvironment: true });
            }}
            aria-label="Edit environments"
          >
            <PiPencilSimple />
          </IconButton>
        )}
      </Flex>
    );
  }

  return (
    <Flex align="center" gap="2" minHeight="32px">
      <Box flexGrow="1">
        <MultiSelectField
          containerClassName="mb-0"
          showCopyButton={false}
          value={environments}
          options={envOptions}
          onChange={(next) =>
            onChange({ environments: next, limitAccessByEnvironment: true })
          }
          placeholder="No environments"
          autoFocus
        />
      </Box>
      <Tooltip body="Apply this role in every environment, with no restriction.">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange({ environments: [], limitAccessByEnvironment: false });
            setEditing(false);
          }}
        >
          All
        </Button>
      </Tooltip>
    </Flex>
  );
}
