import { useState } from "react";
import { useForm } from "react-hook-form";
import { RESERVED_ROLE_IDS, getDefaultRole } from "shared/permissions";
import Button from "@/components/Button";
import SelectField, { GroupedValue } from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";

export default function UpdateDefaultRoleForm() {
  const { refreshOrganization, organization, roles } = useUser();
  const [defaultRoleError, setDefaultRoleError] = useState<string | null>(null);
  const deactivatedRoles = organization.deactivatedRoles || [];

  const { apiCall } = useAuth();
  let roleOptions = [...roles];

  // if the org has custom-roles feature and has deactivated roles, remove those from the roleOptions
  if (deactivatedRoles.length) {
    roleOptions = roleOptions.filter((r) => !deactivatedRoles.includes(r.id));
  }

  const standardOptions: { label: string; value: string }[] = [];
  const customOptions: { label: string; value: string }[] = [];

  roleOptions.forEach((r) => {
    if (RESERVED_ROLE_IDS.includes(r.id)) {
      standardOptions.push({ label: r.id, value: r.id });
    } else {
      customOptions.push({ label: r.id, value: r.id });
    }
  });

  const groupedOptions: GroupedValue[] = [];

  if (standardOptions.length) {
    groupedOptions.push({ label: "Standard", options: standardOptions });
  }

  if (customOptions.length) {
    groupedOptions.push({ label: "Custom", options: customOptions });
  }

  const form = useForm({
    defaultValues: {
      defaultRole: getDefaultRole(organization).role,
    },
  });

  const disableSaveButton =
    form.watch("defaultRole") === getDefaultRole(organization).role;

  const saveSettings = form.handleSubmit(async (data) => {
    setDefaultRoleError(null);
    try {
      await apiCall<{
        status: number;
        message?: string;
      }>("/organization/default-role", {
        method: "PUT",
        body: JSON.stringify(data),
      });
      refreshOrganization();
    } catch (e) {
      setDefaultRoleError(e.message);
    }
  });

  const formatGroupLabel = (data) => {
    // if we don't have both Standard & Custom options, don't return anything
    if (groupedOptions.length < 2) {
      return;
    }

    return (
      <div className={data.label === "Custom" ? "border-top my-1" : ""}></div>
    );
  };

  return (
    <div className="bg-white p-3 border mt-5 mb-5">
      <div className="row">
        <div className="col-sm-3">
          <h4>Team Settings</h4>
        </div>
        <div className="col-sm-9">
          <SelectField
            label={"Default User Role"}
            helpText="This is the default role that will be assigned to new users if you have auto-join or SCIM enabled. This will not affect any existing users."
            value={form.watch("defaultRole")}
            onChange={async (role: string) => {
              form.setValue("defaultRole", role);
            }}
            options={groupedOptions}
            sort={false}
            formatGroupLabel={formatGroupLabel}
            formatOptionLabel={(value) => {
              const r = roles.find((r) => r.id === value.label);
              if (!r) return <strong>{value.label}</strong>;
              return (
                <div>
                  <strong className="pr-2">{r.id}.</strong>
                  {r.description}
                </div>
              );
            }}
          />
          {defaultRoleError ? (
            <div>
              <small className="text-danger">{defaultRoleError}</small>
            </div>
          ) : null}
          <div className="d-flex justify-content-end">
            <Button
              color={"primary"}
              disabled={disableSaveButton}
              onClick={async () => {
                if (disableSaveButton) return;
                await saveSettings();
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
