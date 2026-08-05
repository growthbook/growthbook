import {
  POLICY_DISPLAY_GROUPS,
  POLICY_METADATA_MAP,
  POLICY_PARTS,
  Policy,
  RESERVED_ROLE_IDS,
  DEPRECATED_POLICIES,
} from "shared/permissions";
import { FormProvider, useForm } from "react-hook-form";
import { Role } from "shared/types/organization";
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

// Policies that appear as a part of another policy render inside their parent's
// drill-down, so they must not also render as a top-level row.
const PART_POLICIES = new Set<string>(Object.values(POLICY_PARTS).flat());

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

  // Open the drill-down for any policy the saved role composes atom-by-atom —
  // those selections are otherwise invisible behind a collapsed row. A policy
  // granted whole stays collapsed: its atoms are implied, not chosen.
  // Open any bundle whose parts are granted individually, so a composed role
  // doesn't look empty on load.
  const [expandedPolicies, setExpandedPolicies] = useState<Set<Policy>>(() => {
    const granted = new Set(role.policies || []);
    return new Set(
      (Object.keys(POLICY_PARTS) as Policy[]).filter(
        (policy) =>
          !granted.has(policy) &&
          (POLICY_PARTS[policy] || []).some((part) => granted.has(part)),
      ),
    );
  });

  // Retired policies the stored role still carries. They are absent from
  // POLICY_DISPLAY_GROUPS, so without this an admin sees a role that looks
  // reduced to Edit while hidden Publish/Delete/Bypass grants remain — and has
  // no way to remove them. Frozen on mount so a row doesn't disappear the
  // moment it is unchecked.
  const [legacyPolicies] = useState<Policy[]>(() =>
    DEPRECATED_POLICIES.filter((policy) =>
      (role.policies || []).includes(policy),
    ),
  );

  const validateInputs = (input: {
    id: string;
    description: string;
    policies: Policy[];
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
    displayName?: string;
  }>({
    defaultValues: { ...role },
  });

  const currentValue = {
    id: form.watch("id"),
    description: form.watch("description"),
    policies: form.watch("policies"),
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

  // A policy checkbox is a select-all over its individual permissions: checked
  // when the bundle itself is granted, indeterminate when only some parts are.
  // Clicking it selects the whole group, or clears it when the group is already
  // whole — so from indeterminate it fills in rather than discarding the picks
  // the user just made.
  const togglePolicy = (policy: Policy) => {
    const current = form.getValues("policies");
    const partList = (POLICY_PARTS[policy] || []) as Policy[];
    const parts = new Set<string>(partList);
    // Every part selected individually reads as whole too — how a role saved
    // before the bundle existed comes back.
    const whole =
      current.includes(policy) ||
      (partList.length > 0 && partList.every((p) => current.includes(p)));
    if (whole) {
      form.setValue(
        "policies",
        current.filter((p) => p !== policy && !parts.has(p)),
      );
      return;
    }
    // The bundle grants everything its parts do, so store it alone.
    form.setValue("policies", [
      ...current.filter((p) => !parts.has(p)),
      policy,
    ]);
  };

  // Toggling one permission ejects from the bundle: the whole-policy grant is
  // replaced by the individual parts it covered, minus (or plus) this one. Nothing
  // is disabled — a locked checkbox reads as broken, and the parent falls to
  // indeterminate on its own once the bundle is gone.
  const togglePolicyPart = (policy: Policy, part: Policy) => {
    const current = form.getValues("policies");
    const parts = (POLICY_PARTS[policy] || []) as Policy[];
    const bundled = current.includes(policy);
    const explicit = new Set<Policy>(
      bundled ? parts : parts.filter((p) => current.includes(p)),
    );
    if (explicit.has(part)) explicit.delete(part);
    else explicit.add(part);

    const rest = current.filter(
      (p) => p !== policy && !parts.includes(p as Policy),
    );
    // Back to every part? Collapse to the bundle rather than storing them all.
    form.setValue(
      "policies",
      explicit.size === parts.length
        ? [...rest, policy]
        : [...rest, ...Array.from(explicit)],
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
        <Heading as="h2" size="md" mb="3">
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
                  size="md"
                  weight="semibold"
                  color="text-mid"
                  textTransform="uppercase"
                  mb="3"
                >
                  {group.name}
                </Text>
                <Flex direction="column" gap="3">
                  {policies
                    .filter((policy) => !PART_POLICIES.has(policy))
                    .map((policy) => {
                      const policyData = POLICY_METADATA_MAP[policy];
                      const { policies: currentPolicies } = currentValue;

                      const checked = currentPolicies.includes(policy);
                      const parts = POLICY_PARTS[policy] || [];
                      const selectedParts = parts.filter((part) =>
                        currentPolicies.includes(part),
                      ).length;
                      // Indeterminate while only some parts are granted: the
                      // bundle itself isn't, so it must not read as fully checked.
                      const policyValue: boolean | "indeterminate" = checked
                        ? true
                        : selectedParts > 0
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
                            // These are privilege-escalation notices ("can create
                            // admin users"), so they take the attention tier rather
                            // than the least-prominent warning one. Still beside the
                            // checkbox rather than tinting it — not a validation
                            // error.
                            <Box ml="5" mt="1">
                              <HelperText status="attention" size="sm">
                                {policyData.warning}
                              </HelperText>
                            </Box>
                          ) : null}
                          {parts.length ? (
                            <Box ml="5" mt="1">
                              <Link
                                aria-expanded={expanded}
                                onClick={() => toggleExpanded(policy)}
                              >
                                <Flex align="center" gap="1">
                                  {expanded ? <PiMinusBold /> : <PiPlusBold />}
                                  {expanded
                                    ? "Hide individual permissions"
                                    : "Select individual permissions"}
                                </Flex>
                              </Link>
                              {expanded ? (
                                <Flex direction="column" gap="2" mt="2">
                                  {parts.map((part) => {
                                    const meta = POLICY_METADATA_MAP[part];
                                    if (!meta) return null;
                                    return (
                                      <Checkbox
                                        key={part}
                                        id={`${policy}-${part}-checkbox`}
                                        // Checked either because the bundle grants
                                        // it or because it was picked directly.
                                        value={
                                          checked ||
                                          currentPolicies.includes(part)
                                        }
                                        setValue={() =>
                                          togglePolicyPart(policy, part)
                                        }
                                        disabled={status === "viewing"}
                                        // Lighter than the policy above it, so the
                                        // parent/child tiers read apart inside the
                                        // disclosure.
                                        weight="regular"
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
          {legacyPolicies.length ? (
            <Box mb="5">
              <Text
                as="div"
                size="md"
                weight="semibold"
                color="text-mid"
                textTransform="uppercase"
                mb="3"
              >
                Legacy grants
              </Text>
              <Box mb="3">
                <HelperText status="attention" size="sm">
                  This role still grants access through retired policies. They
                  keep working, but they are not offered for new roles — uncheck
                  one to drop the access it carries.
                </HelperText>
              </Box>
              <Flex direction="column" gap="3">
                {legacyPolicies.map((policy) => {
                  const meta = POLICY_METADATA_MAP[policy];
                  return (
                    <Checkbox
                      key={policy}
                      id={`legacy-${policy}-checkbox`}
                      value={currentValue.policies.includes(policy)}
                      setValue={() => togglePolicy(policy)}
                      disabled={status === "viewing"}
                      weight="bold"
                      label={meta?.displayName ?? policy}
                      description={meta?.description}
                    />
                  );
                })}
              </Flex>
            </Box>
          ) : null}
        </Frame>
      </Box>
      {!isReservedRole ? (
        <Box
          py="3"
          className="bg-main-color"
          position="sticky"
          bottom="0"
          width="100%"
          style={{ borderTop: "1px solid var(--border-color-200)" }}
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
