import { useState } from "react";
import { useForm } from "react-hook-form";
import { RESERVED_ROLE_IDS, getDefaultRole } from "shared/permissions";
import Button from "@/components/Button";
import { GroupedValue } from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import RoleSelector from "./RoleSelector";

export default function UpdateDefaultRoleForm() {
  const [isDirty, setIsDirty] = useState(false);
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
      defaultRole: getDefaultRole(organization),
    },
  });

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
    setIsDirty(false);
  });

  return (
    <div className="appbox p-3 border mt-5 mb-5">
      <div className="row">
        <div className="col-sm-3">
          <h3>Team Settings</h3>
        </div>
        <div className="col-sm-9">
          <h4>Default User Role</h4>
          <p>
            This is the default role that will be assigned to new users if you
            have auto-join or SCIM enabled. This will not affect any existing
            users.
          </p>
          <RoleSelector
            value={form.watch("defaultRole")}
            setValue={(value) => {
              setIsDirty(true);
              form.setValue("defaultRole", value);
            }}
          />
          {defaultRoleError ? (
            <div>
              <small className="text-danger">{defaultRoleError}</small>
            </div>
          ) : null}
          <div className="d-flex justify-content-end pt-3">
            <Button
              color={"primary"}
              disabled={!isDirty}
              onClick={async () => {
                if (!isDirty) return;
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
