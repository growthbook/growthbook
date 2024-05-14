import {
  POLICY_DISPLAY_GROUPS,
  POLICY_METADATA_MAP,
  Policy,
} from "shared/permissions";
import { FormProvider, useForm } from "react-hook-form";
import { Role } from "@back-end/types/organization";
import router from "next/router";
import { useState } from "react";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Button";

export default function RoleForm({ roleId }: { roleId?: string }) {
  //MKTODO: Is this the best way to do this?
  const { roles: orgRoles, refreshOrganization } = useUser();
  let existingRole: Role | undefined;
  const existingRoleIndex = orgRoles.findIndex(
    (orgRole) => orgRole.id === roleId
  );
  if (existingRoleIndex > -1) {
    existingRole = orgRoles[existingRoleIndex];
  }

  const { apiCall } = useAuth();
  const form = useForm<{
    id: string;
    description: string;
    policies: Policy[];
  }>({
    defaultValues: {
      id: existingRole?.id || "",
      description: existingRole?.description || "",
      policies: existingRole?.policies || [],
    },
  });

  // const value = {
  //   id: form.watch("id"),
  //   description: form.watch("description"),
  //   policies: form.watch("policies"),
  // };

  //MKTODO: Build this logic out
  // const ctaEnabled = hasChanges(value, originalValue);

  const saveSettings = form.handleSubmit(async (value) => {
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
      await router.push("/settings/team#roles");
    } catch (e) {
      //MKTODO: Handle error case
      console.log(e);
    }

    // show the user that the settings have saved:
    // setSaveMsg(true);
  });

  return (
    <FormProvider {...form}>
      <div className="container-fluid pagecontents">
        <h1 className="pb-3">{`${
          existingRole?.id ? "Edit " : "Create "
        }Custom Role`}</h1>
        <div className="bg-white p-4 mt-2">
          <Field
            label="Name"
            required
            autoFocus
            autoComplete="company"
            minLength={3}
            maxLength={40}
            placeholder="Name your Custom Role"
            labelClassName="font-weight-bold"
            {...form.register("id")}
            //MKTODO: Add some validation to only include only include letters, numbers, and underscores.
          />
          <Field
            label="Description"
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
          <div className="flex-grow-1 mr-4">
            {/* {saveMsg && (
              <TempMessage
                className="mb-0 py-2"
                close={() => {
                  setSaveMsg(false);
                }}
              >
                Settings saved
              </TempMessage>
            )} */}
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
              // disabled={!ctaEnabled}

              onClick={async () => {
                // if (!ctaEnabled) return;
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
