import { ReactNode } from "react";
import { MemberRole, MemberRoleInfo } from "back-end/types/organization";
import { useUser } from "../../../services/UserContext";
import { useEnvironments } from "../../../services/features";
import MultiSelectField from "../../Forms/MultiSelectField";
import Toggle from "../../Forms/Toggle";
import SelectField from "../../Forms/SelectField";
import { roleSupportsEnvLimit } from "../../../services/auth";

export default function SingleRoleSelector({
  value,
  setValue,
  label,
  includeAdminRole = false,
}: {
  value: MemberRoleInfo;
  setValue: (value: MemberRoleInfo) => void;
  label: ReactNode;
  includeAdminRole?: boolean;
}) {
  const { roles } = useUser();

  const availableEnvs = useEnvironments();

  const { hasCommercialFeature } = useUser();

  const canUseAdvancedPermissions = hasCommercialFeature(
    "advanced-permissions"
  );

  return (
    <div>
      <SelectField
        label={label}
        value={value.role}
        onChange={(role: MemberRole) => {
          setValue({
            ...value,
            role,
          });
        }}
        options={roles
          .filter((r) => includeAdminRole || r.id !== "admin")
          .map((r) => ({
            label: r.id,
            value: r.id,
          }))}
        sort={false}
        formatOptionLabel={(value) => {
          const r = roles.find((r) => r.id === value.label);
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

      {roleSupportsEnvLimit(value.role) &&
        availableEnvs.length > 1 &&
        canUseAdvancedPermissions && (
          <div>
            <div className="form-group">
              <Toggle
                disabled={!canUseAdvancedPermissions}
                id={"role-modal"}
                value={value.limitAccessByEnvironment}
                setValue={(limitAccessByEnvironment) => {
                  setValue({
                    ...value,
                    limitAccessByEnvironment,
                  });
                }}
                disabledMessage="Upgrade to limit access by environment"
              />{" "}
              Restrict Access to Specific Environments
            </div>
            {value.limitAccessByEnvironment && (
              <MultiSelectField
                label="Environments"
                helpText="Select all environments you want the person to have permissions for"
                value={value.environments}
                onChange={(environments) => {
                  setValue({
                    ...value,
                    environments,
                  });
                }}
                options={availableEnvs.map((env) => ({
                  label: env.id,
                  value: env.id,
                  tooltip: env.description,
                }))}
              />
            )}
          </div>
        )}
    </div>
  );
}
