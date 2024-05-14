import {
  POLICY_DISPLAY_GROUPS,
  POLICY_METADATA_MAP,
  Policy,
  RESERVED_ROLE_IDS,
} from "shared/permissions";
import { FormProvider, useForm } from "react-hook-form";
import { Role } from "@back-end/types/organization";
import router from "next/router";
import { useState } from "react";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Button";
import TempMessage from "@/components/TempMessage";

export default function RoleForm({ roleId }: { roleId?: string }) {
  const { apiCall } = useAuth();
  const [saveMsg, setSaveMsg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { roles: orgRoles, refreshOrganization } = useUser();
  let existingRole: Role | undefined;
  const existingRoleIndex = orgRoles.findIndex(
    (orgRole) => orgRole.id === roleId
  );
  if (existingRoleIndex > -1) {
    existingRole = orgRoles[existingRoleIndex];
  }
  const originalValue = {
    id: existingRole?.id || "",
    description: existingRole?.description || "",
    policies: existingRole?.policies || [],
  };

  const form = useForm<{
    id: string;
    description: string;
    policies: Policy[];
  }>({
    defaultValues: originalValue,
  });

  const value = {
    id: form.watch("id"),
    description: form.watch("description"),
    policies: form.watch("policies"),
  };

  const isReservedRole = existingRole?.id
    ? RESERVED_ROLE_IDS.includes(existingRole?.id)
    : false;
  const ctaEnabled = JSON.stringify(originalValue) !== JSON.stringify(value);

  const saveSettings = form.handleSubmit(async (value) => {
    setError(null);
    try {
      await apiCall(
        existingRole?.id ? `/custom-roles/${existingRole.id}` : `/custom-roles`,
        {
          method: existingRole?.id ? "PUT" : "POST",
          body: JSON.stringify(
            existingRole?.id
              ? { description: value.description, policies: value.policies }
              : value
          ),
        }
      );
      await refreshOrganization();
      setSaveMsg(true);
      await router.push("/settings/team#roles");
    } catch (e) {
      setError(e.message);
    }
  });

  function getHeadline(): string {
    if (!existingRole?.id) {
      return "Create Custom Role";
    }

    if (isReservedRole) {
      return existingRole.id;
    }

    return `Edit ${existingRole.id}`;
  }

  return (
    <FormProvider {...form}>
      <div className="container-fluid pagecontents">
        {/* MKTODO: Update this logic if viewing a reserved role, just show the
        role.id if viewing a custom role, show edit [role name] if there is no
        role, show Create Custom Role */}
        <h1 className="pb-3">{getHeadline()}</h1>
        <div className="bg-white p-4 mt-2">
          <Field
            label="Name"
            required
            autoFocus
            disabled={isReservedRole}
            autoComplete="company"
            maxLength={40}
            placeholder="Name your Custom Role"
            labelClassName="font-weight-bold"
            {...form.register("id")}
          />
          <Field
            label="Description"
            disabled={isReservedRole}
            placeholder="Briefly describe what this role will permit users to do"
            maxLength={56}
            labelClassName="font-weight-bold"
            {...form.register("description")}
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
                              disabled={isReservedRole}
                              id={`${policy}-checkbox`}
                              onChange={() => {
                                if (!checked) {
                                  currentPolicies.push(policy);
                                } else {
                                  const indexToRemove = currentPolicies.indexOf(
                                    policy
                                  );
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
      </div>
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
              disabled={!ctaEnabled}
              onClick={async () => {
                await saveSettings();
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </FormProvider>
  );
}
