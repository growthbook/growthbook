import { useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPencilSimple } from "react-icons/pi";
import {
  envScopedPermissionsForRole,
  getRoleDisplayName,
} from "shared/permissions";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";
import MultiSelectField from "@/ui/MultiSelectField";
import Tooltip from "@/components/Tooltip/Tooltip";

const ALL_ENVIRONMENTS = "__all_environments__";

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
      <Text>All Environments</Text>
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
            onClick={() => setEditing(true)}
            aria-label="Edit environments"
          >
            <PiPencilSimple />
          </IconButton>
        )}
      </Flex>
    );
  }

  return (
    <Box>
      <MultiSelectField
        containerClassName="mb-0"
        showCopyButton={false}
        value={limitAccessByEnvironment ? environments : [ALL_ENVIRONMENTS]}
        options={[
          { label: "All Environments", value: ALL_ENVIRONMENTS },
          ...envOptions,
        ]}
        onChange={(next) => {
          const pickedAll =
            next.includes(ALL_ENVIRONMENTS) && limitAccessByEnvironment;
          onChange(
            pickedAll
              ? { environments: [], limitAccessByEnvironment: false }
              : {
                  environments: next.filter((e) => e !== ALL_ENVIRONMENTS),
                  limitAccessByEnvironment: true,
                },
          );
        }}
        sort={false}
        formatOptionLabel={(option) =>
          option.value === ALL_ENVIRONMENTS ? (
            <em>{option.label}</em>
          ) : (
            option.label
          )
        }
        placeholder="No environments"
        autoFocus
      />
    </Box>
  );
}
