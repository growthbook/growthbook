import { ReactNode, useMemo } from "react";
import { MemberRoleInfo } from "back-end/types/organization";
import uniqid from "uniqid";
import { roleSupportsEnvLimit } from "shared/permissions";
import { useUser } from "@/services/UserContext";
import { useEnvironments } from "@/services/features";
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
  const { roles, hasCommercialFeature, organization } = useUser();
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
        onChange={(role) => {
          setValue({
            ...value,
            role,
          });
        }}
        options={roleOptions
          //MKTODO: Add logic to not include deactivated roles
          .filter((r) => includeAdminRole || r.id !== "admin")
          .map((r) => ({
            label: r.id,
            value: r.id,
          }))}
        sort={false}
        formatOptionLabel={(value) => {
          const r = roles.find((r) => r.id === value.label);
          if (!r) {
            return;
          }
          return (
            //MKTODO: Update this logic to handle includeAdminRole being false, and/or then Experimenter being deactivated.
            //MKTODO: The bottom border needs to be added after the last reserved role id
            <div className={r.id === "admin" ? "border-bottom pb-3" : ""}>
              <strong className="pr-2">{r.id}.</strong>
              {r.description}
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
