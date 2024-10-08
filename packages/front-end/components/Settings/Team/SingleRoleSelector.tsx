import { ReactNode, useMemo } from "react";
import { MemberRoleInfo } from "back-end/types/organization";
import uniqid from "uniqid";
import { RESERVED_ROLE_IDS, roleSupportsEnvLimit } from "shared/permissions";
import { useUser } from "@/services/UserContext";
import { useEnvironments } from "@/services/features";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Toggle from "@/components/Forms/Toggle";
import SelectField, { GroupedValue } from "@/components/Forms/SelectField";
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
  const { roles, hasCommercialFeature, organization } = useUser();
  const hasFeature = hasCommercialFeature("advanced-permissions");
  const hasCustomRolesFeature = hasCommercialFeature("custom-roles");
  const deactivatedRoles = organization.deactivatedRoles || [];

  const isNoAccessRoleEnabled = hasCommercialFeature("no-access-role");

  let roleOptions = [...roles];

  if (!isNoAccessRoleEnabled) {
    roleOptions = roles.filter((r) => r.id !== "noaccess");
  }

  if (!includeAdminRole) {
    roleOptions = roleOptions.filter((r) => r.id !== "admin");
  }

  // if the org has custom-roles feature and has deactivated roles, remove those from the roleOptions
  if (hasCustomRolesFeature && deactivatedRoles.length) {
    roleOptions = roleOptions.filter((r) => !deactivatedRoles.includes(r.id));
  }

  const standardOptions: { label: string; value: string }[] = [];
  const customOptions: { label: string; value: string }[] = [];

  roleOptions.forEach((r) => {
    if (RESERVED_ROLE_IDS.includes(r.id)) {
      standardOptions.push({ label: r.id, value: r.id });
    } else {
      if (hasCustomRolesFeature) {
        customOptions.push({ label: r.id, value: r.id });
      }
    }
  });

  const groupedOptions: GroupedValue[] = [];

  if (standardOptions.length) {
    groupedOptions.push({ label: "Standard", options: standardOptions });
  }

  if (customOptions.length) {
    groupedOptions.push({ label: "Custom", options: customOptions });
  }

  const availableEnvs = useEnvironments();

  const id = useMemo(() => uniqid(), []);

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
    <div>
      <SelectField
        label={label}
        value={value.role}
        onChange={(role) => {
          setValue({
            ...value,
            role,
          });
        }}
        options={groupedOptions}
        sort={false}
        formatGroupLabel={formatGroupLabel}
        formatOptionLabel={(value) => {
          const r = roles.find((r) => r.id === value.label);
          if (!r) return <span>{value.label}</span>;
          return (
            <div className="d-flex">
              <span className="pr-2">{r.id}</span>
              <span className="ml-auto text-muted">{r.description}</span>
            </div>
          );
        }}
        disabled={disabled}
      />

      {roleSupportsEnvLimit(value.role, organization) &&
        availableEnvs.length > 1 && (
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
