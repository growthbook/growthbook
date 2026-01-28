import {
  POLICY_DISPLAY_GROUPS,
  POLICY_METADATA_MAP,
  Policy,
  RESERVED_ROLE_IDS,
} from "shared/permissions";
import { FormProvider, useForm } from "react-hook-form";
import { Role } from "shared/types/organization";
import router from "next/router";
import { useState } from "react";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Button";
import TempMessage from "@/components/TempMessage";

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
      setError("Display name must be 100 characters or less.");
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
    defaultValues: role,
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

  const hasChanges = JSON.stringify(role) !== JSON.stringify(currentValue);

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

  return (
    <FormProvider {...form}>
      <div className="bg-white p-4 mt-2">
        <Field
          label="Name"
          required
          autoFocus
          disabled={status !== "creating"}
          maxLength={40}
          currentLength={currentValue.id.length}
          placeholder="Name your Custom Role"
          labelClassName="font-weight-bold"
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
          label="Description"
          disabled={status === "viewing"}
          currentLength={currentValue.description.length}
          placeholder="Briefly describe what this role will permit users to do"
          maxLength={100}
          labelClassName="font-weight-bold"
          {...form.register("description")}
        />
        <Field
          label="Display Name"
          disabled={status === "viewing"}
          currentLength={currentValue.displayName?.length || 0}
          placeholder="Optional: User-friendly name to display in the UI (e.g., 'Project Admin')"
          maxLength={64}
          labelClassName="font-weight-bold"
          {...form.register("displayName")}
          helpText="Optional. If not provided, the role ID will be used for display."
        />
      </div>
      <div className="pt-4">
        <h2 className="py-2">Select Permissions</h2>
        <div className="bg-white p-5">
          {POLICY_DISPLAY_GROUPS.map((group) => {
            const policies = group.policies;

            if (!policies.length) return null;
            return (
              <div key={group.name} className="pb-4">
                <>
                  <p className="text-secondary font-weight-bold">
                    {group.name.toUpperCase()}
                  </p>
                  {policies.map((policy) => {
                    const policyData = POLICY_METADATA_MAP[policy];
                    const currentPolicies = form.watch("policies");

                    const checked = currentPolicies.includes(policy);
                    return (
                      <div key={policyData.displayName}>
                        <div className="d-flex align-items-baseline pb-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={status === "viewing"}
                            id={`${policy}-checkbox`}
                            onChange={() => {
                              if (!checked) {
                                currentPolicies.push(policy);
                              } else {
                                const indexToRemove =
                                  currentPolicies.indexOf(policy);
                                currentPolicies.splice(indexToRemove, 1);
                              }
                              form.setValue("policies", currentPolicies);
                            }}
                          />
                          <div className="ml-2">
                            <p className="m-0 font-weight-bold">
                              {policyData.displayName}
                            </p>
                            <span>{policyData.description}</span>
                            {policyData.warning ? (
                              <div className="text-danger">
                                <strong>Warning: </strong>
                                {policyData.warning}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              </div>
            );
          })}
        </div>
      </div>
      {!isReservedRole ? (
        <div
          className="bg-main-color position-sticky w-100 py-3 border-top"
          style={{ bottom: 0, height: 70 }}
        >
          <div className="container-fluid pagecontents d-flex">
            {error ? (
              <div className="alert alert-danger">
                <strong>Error: {error}</strong>
              </div>
            ) : null}
            <div className="flex-grow-1 mr-4">
              {saveMsg && (
                <TempMessage
                  className="mb-0 py-2"
                  close={() => {
                    setSaveMsg(false);
                  }}
                >
                  Custom Role has been saved
                </TempMessage>
              )}
            </div>
            <div>
              <button
                className="btn btn-link mr-2"
                onClick={async () => await router.push("/settings/team#roles")}
              >
                Cancel
              </button>
              <Button
                style={{ marginRight: "4rem" }}
                color={"primary"}
                loadingCta="Saving"
                disabled={status !== "viewing" && !hasChanges}
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
            </div>
          </div>
        </div>
      ) : null}
    </FormProvider>
  );
}
