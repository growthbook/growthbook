import {
  GRANULAR_PERMISSION_METADATA,
  POLICY_DISPLAY_GROUPS,
  POLICY_METADATA_MAP,
  POLICY_PERMISSION_MAP,
  Policy,
  RESERVED_ROLE_IDS,
} from "shared/permissions";
import { FormProvider, useForm } from "react-hook-form";
import { Permission, Role } from "shared/types/organization";
import router from "next/router";
import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiMinusBold, PiPlusBold } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import TempMessage from "@/components/TempMessage";
import Callout from "@/ui/Callout";

export default function RoleForm({
  role,
  action = "viewing",
}: {
  role: Role;
  action?: "creating" | "editing" | "viewing";
}) {
  const { apiCall } = useAuth();
  const [saveMsg, setSaveMsg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refreshOrganization } = useUser();
  const [status, setStatus] = useState<"editing" | "viewing" | "creating">(
    action,
  );

  const [expandedPolicies, setExpandedPolicies] = useState<Set<Policy>>(
    new Set(),
  );

  const validateInputs = (input: {
    id: string;
    description: string;
    policies: Policy[];
    permissions?: Permission[];
    displayName?: string;
  }): boolean => {
    if (!input.id.length) {
      setError("Name field is required");
      return false;
    }

    if (RESERVED_ROLE_IDS.includes(input.id)) {
      setError("That role id is reserved and cannot be used");
      return false;
    }

    if (input.id.startsWith("gbDefault_")) {
      setError(
        "Role id cannot start with 'gbDefault_' as this prefix is reserved for default roles",
      );
      return false;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(input.id)) {
      setError("Name can only contain letters, numbers, and underscores.");
      return false;
    }

    if (input.displayName && input.displayName.length > 64) {
      setError("Display name must be 64 characters or less.");
      return false;
    }

    return true;
  };

  const form = useForm<{
    id: string;
    description: string;
    policies: Policy[];
    permissions: Permission[];
    displayName?: string;
  }>({
    defaultValues: { ...role, permissions: role.permissions || [] },
  });

  const currentValue = {
    id: form.watch("id"),
    description: form.watch("description"),
    policies: form.watch("policies"),
    permissions: form.watch("permissions"),
    displayName: form.watch("displayName"),
  };

  const isReservedRole = RESERVED_ROLE_IDS.includes(role.id);
  const getFooterCTA = (): string => {
    if (status === "viewing") {
      return "Edit";
    }

    if (status === "editing") {
      return "Save";
    }

    return "Create & Save";
  };

  const hasChanges =
    JSON.stringify({
      id: role.id,
      description: role.description,
      policies: role.policies,
      permissions: role.permissions || [],
      displayName: role.displayName,
    }) !== JSON.stringify(currentValue);

  const saveSettings = form.handleSubmit(async (currentValue) => {
    setError(null);

    if (!validateInputs(currentValue)) return;

    try {
      if (status === "creating") {
        await apiCall("/custom-roles", {
          method: "POST",
          body: JSON.stringify(currentValue),
        });
      } else {
        // Using role.id to ensure we never allow someone to update a different role
        await apiCall(`/custom-roles/${role.id}`, {
          method: "PUT",
          body: JSON.stringify({
            description: currentValue.description,
            policies: currentValue.policies,
            permissions: currentValue.permissions,
            displayName: currentValue.displayName,
          }),
        });
      }
      await refreshOrganization();
      setSaveMsg(true);
      await router.push("/settings/team#roles");
    } catch (e) {
      setError(e.message);
    }
  });

  // A policy and its individual atoms are two ways to grant the same thing, so
  // only one is ever active: selecting the policy drops its atoms from
  // permissions[] (they render locked instead), and clearing the policy leaves
  // the atoms free to compose.
  const togglePolicy = (policy: Policy) => {
    const current = form.getValues("policies");
    const selecting = !current.includes(policy);
    form.setValue(
      "policies",
      selecting ? [...current, policy] : current.filter((p) => p !== policy),
    );
    if (selecting) {
      const covered = new Set<Permission>(POLICY_PERMISSION_MAP[policy] || []);
      const perms = form.getValues("permissions");
      const remaining = perms.filter((p) => !covered.has(p));
      if (remaining.length !== perms.length) {
        form.setValue("permissions", remaining);
      }
    }
  };

  const togglePermission = (permission: Permission) => {
    const current = form.getValues("permissions");
    form.setValue(
      "permissions",
      current.includes(permission)
        ? current.filter((p) => p !== permission)
        : [...current, permission],
    );
  };

  const toggleExpanded = (policy: Policy) => {
    setExpandedPolicies((prev) => {
      const next = new Set(prev);
      if (next.has(policy)) next.delete(policy);
      else next.add(policy);
      return next;
    });
  };

  // Atoms already in effect via a selected policy — shown checked and locked in
  // every drill-down that lists them, since they can't be removed individually.
  const grantedByPolicy = new Set<Permission>();
  currentValue.policies.forEach((policy) =>
    (POLICY_PERMISSION_MAP[policy] || []).forEach((permission) =>
      grantedByPolicy.add(permission),
    ),
  );

  return (
    <FormProvider {...form}>
      <Frame mt="2">
        <Field
          size="md"
          label="Name"
          required
          autoFocus
          disabled={status !== "creating"}
          maxLength={40}
          currentLength={currentValue.id.length}
          placeholder="Name your Custom Role"
          {...form.register("id")}
          helpText={
            status === "creating" ? (
              <>
                Only letters, numbers, and underscores allowed. No spaces.{" "}
                <strong>Cannot be changed later!</strong>
              </>
            ) : (
              <>Role names cannot be changed once created.</>
            )
          }
        />
        <Field
          size="md"
          label="Description"
          disabled={status === "viewing"}
          currentLength={currentValue.description.length}
          placeholder="Briefly describe what this role will permit users to do"
          maxLength={100}
          {...form.register("description")}
        />
        <Field
          size="md"
          label="Display Name"
          disabled={status === "viewing"}
          currentLength={currentValue.displayName?.length || 0}
          placeholder="Optional: User-friendly name to display in the UI (e.g., 'Project Admin')"
          maxLength={64}
          {...form.register("displayName")}
          helpText="Optional. If not provided, the role ID will be used for display."
        />
      </Frame>
      <Box pt="2">
        <Heading as="h2" size="medium" mb="3">
          Select Permissions
        </Heading>
        <Frame>
          {POLICY_DISPLAY_GROUPS.map((group) => {
            const policies = group.policies;

            if (!policies.length) return null;
            return (
              <Box key={group.name} mb="5">
                <Text
                  as="div"
                  size="small"
                  weight="semibold"
                  color="text-mid"
                  textTransform="uppercase"
                  mb="3"
                >
                  {group.name}
                </Text>
                <Flex direction="column" gap="3">
                  {policies.map((policy) => {
                    const policyData = POLICY_METADATA_MAP[policy];
                    const {
                      policies: currentPolicies,
                      permissions: currentPermissions,
                    } = currentValue;

                    const checked = currentPolicies.includes(policy);
                    // Fine-grained atoms this policy bundles that can be granted
                    // individually via the role's permissions[] (excludes readData).
                    const granularAtoms = (
                      POLICY_PERMISSION_MAP[policy] || []
                    ).filter((p) => GRANULAR_PERMISSION_METADATA[p]);
                    const composedCount = granularAtoms.filter((a) =>
                      currentPermissions.includes(a),
                    ).length;
                    // Indeterminate while composing atoms: the policy itself
                    // isn't granted (it also carries readData, which has no
                    // atom row), so it must not read as fully checked.
                    const policyValue: boolean | "indeterminate" = checked
                      ? true
                      : composedCount > 0
                        ? "indeterminate"
                        : false;
                    const expanded = expandedPolicies.has(policy);
                    return (
                      <Box key={policy}>
                        <Checkbox
                          id={`${policy}-checkbox`}
                          value={policyValue}
                          setValue={() => togglePolicy(policy)}
                          disabled={status === "viewing"}
                          weight="bold"
                          label={policyData.displayName}
                          description={policyData.description}
                        />
                        {policyData.warning ? (
                          // Informational, not a validation error — so it sits
                          // beside the checkbox rather than tinting it.
                          <Box ml="5" mt="1">
                            <HelperText status="warning" size="sm">
                              {policyData.warning}
                            </HelperText>
                          </Box>
                        ) : null}
                        {granularAtoms.length ? (
                          <Box ml="5" mt="1">
                            <Link onClick={() => toggleExpanded(policy)}>
                              <Flex align="center" gap="1">
                                {expanded ? <PiMinusBold /> : <PiPlusBold />}
                                {expanded
                                  ? "Hide individual permissions"
                                  : checked
                                    ? "View individual permissions"
                                    : "Choose individual permissions"}
                              </Flex>
                            </Link>
                            {expanded ? (
                              <Flex direction="column" gap="2" mt="2">
                                {granularAtoms.map((atom) => {
                                  const meta =
                                    GRANULAR_PERMISSION_METADATA[atom];
                                  if (!meta) return null;
                                  const locked = grantedByPolicy.has(atom);
                                  return (
                                    <Checkbox
                                      key={atom}
                                      id={`${policy}-${atom}-checkbox`}
                                      value={
                                        locked ||
                                        currentPermissions.includes(atom)
                                      }
                                      setValue={() => togglePermission(atom)}
                                      disabled={status === "viewing" || locked}
                                      label={meta.displayName}
                                      description={meta.description}
                                    />
                                  );
                                })}
                              </Flex>
                            ) : null}
                          </Box>
                        ) : null}
                      </Box>
                    );
                  })}
                </Flex>
              </Box>
            );
          })}
        </Frame>
      </Box>
      {!isReservedRole ? (
        <Box
          py="3"
          className="bg-main-color"
          style={{
            position: "sticky",
            bottom: 0,
            width: "100%",
            borderTop: "1px solid var(--slate-a5)",
          }}
        >
          <Flex className="container-fluid pagecontents" align="center" gap="3">
            {error ? (
              <Callout status="error">
                <strong>Error: {error}</strong>
              </Callout>
            ) : null}
            <Box flexGrow="1">
              {saveMsg && (
                <TempMessage
                  close={() => {
                    setSaveMsg(false);
                  }}
                >
                  Custom Role has been saved
                </TempMessage>
              )}
            </Box>
            <Button
              variant="ghost"
              onClick={() => router.push("/settings/team#roles")}
            >
              Cancel
            </Button>
            <Button
              disabled={status !== "viewing" && !hasChanges}
              setError={setError}
              onClick={async () => {
                if (status === "viewing") {
                  setStatus("editing");
                  return;
                }
                await saveSettings();
              }}
            >
              {getFooterCTA()}
            </Button>
          </Flex>
        </Box>
      ) : null}
    </FormProvider>
  );
}
