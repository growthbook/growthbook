import { useState } from "react";
import { useForm } from "react-hook-form";
import Button from "@/components/Button";
import SelectField from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";

export default function UpdateDefaultRoleForm() {
  const { refreshOrganization, organization, roles } = useUser();
  const [defaultRoleError, setDefaultRoleError] = useState<string | null>(null);

  const { apiCall } = useAuth();

  const form = useForm({
    defaultValues: {
      defaultRole: organization.settings?.defaultRole?.role || "collaborator",
    },
  });

  const disableSaveButton =
    form.watch("defaultRole") ===
    (organization.settings?.defaultRole?.role || "collaborator");

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
            options={roles.map((r) => ({
              label: r.id,
              value: r.id,
            }))}
            sort={false}
            formatOptionLabel={(value) => {
              const r = roles.find((r) => r.id === value.value);
              if (!r) return value.label;
              return (
                <div className="d-flex align-items-center">
                  <strong style={{ width: 110 }}>{r.id}</strong>
                  <small className="ml-2">
                    <em>{r.description}</em>
                  </small>
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
