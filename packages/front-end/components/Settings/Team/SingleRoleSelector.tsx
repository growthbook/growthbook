import { ReactNode, useMemo } from "react";
import { MemberRole, MemberRoleInfo } from "back-end/types/organization";
import uniqid from "uniqid";
import { roleSupportsEnvLimit } from "shared/permissions";
import { useUser } from "@front-end/services/UserContext";
import { useEnvironments } from "@front-end/services/features";
import MultiSelectField from "@front-end/components/Forms/MultiSelectField";
import Toggle from "@front-end/components/Forms/Toggle";
import SelectField from "@front-end/components/Forms/SelectField";
import PremiumTooltip from "@front-end/components/Marketing/PremiumTooltip";

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

  const isNoAccessRoleEnabled = hasCommercialFeature("no-access-role");

  let roleOptions = [...roles];

  if (!isNoAccessRoleEnabled) {
    roleOptions = roles.filter((r) => r.id !== "noaccess");
  }

  const availableEnvs = useEnvironments();

  const id = useMemo(() => uniqid(), []);

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
        options={roleOptions
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
              {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
              <strong style={{ width: 110 }}>{r.id}</strong>
              <small className="ml-2">
                {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
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
            <label htmlFor={`role-modal--${id}`}>
              <PremiumTooltip commercialFeature="advanced-permissions">
                Restrict Access to Specific Environments
              </PremiumTooltip>
            </label>
            <div>
              <Toggle
                disabled={!hasFeature}
                id={`role-modal--${id}`}
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
