import { ReactNode } from "react";
import { MemberRole, MemberRoleInfo } from "back-end/types/organization";
import { useEnvironments } from "@/services/features";
import { roleSupportsEnvLimit } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Toggle from "@/components/Forms/Toggle";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";

export default function SingleRoleSelector({
  value,
  setValue,
  label,
  includeAdminRole = false,
  disabled = false,
}: {
  value: MemberRoleInfo;
  setValue: (value: MemberRoleInfo) => void;
  label: ReactNode;
  includeAdminRole?: boolean;
  disabled?: boolean;
}) {
  const { roles, hasCommercialFeature } = useUser();
  const hasFeature = hasCommercialFeature("advanced-permissions");

  const availableEnvs = useEnvironments();

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
        disabled={disabled}
      />

      {roleSupportsEnvLimit(value.role) && availableEnvs.length > 1 && (
        <div>
          <div className="form-group">
            <label htmlFor="role-modal">
              <PremiumTooltip commercialFeature="advanced-permissions">
                Restrict Access to Specific Environments
              </PremiumTooltip>
            </label>
            <div>
              <Toggle
                disabled={!hasFeature}
                id={"role-modal"}
                value={value.limitAccessByEnvironment}
                setValue={(limitAccessByEnvironment) => {
                  setValue({
                    ...value,
                    limitAccessByEnvironment,
                  });
                }}
              />
            </div>
          </div>
          {value.limitAccessByEnvironment && (
            <MultiSelectField
              label="Environments"
              className="mb-4"
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
