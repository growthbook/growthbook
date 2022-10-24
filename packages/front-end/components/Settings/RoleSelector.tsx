import { FC } from "react";
import { MemberRole } from "back-end/types/organization";
import { useUser } from "../../services/UserContext";
import { useEnvironments } from "../../services/features";
import MultiSelectField from "../Forms/MultiSelectField";
import { isCloud } from "../../services/env";
import Toggle from "../Forms/Toggle";
import SelectField from "../Forms/SelectField";
import RoleDisplay from "./RoleDisplay";

const RoleSelector: FC<{
  role: MemberRole;
  setRole: (role: MemberRole) => void;
  environments: string[];
  setEnvironments: (envs: string[]) => void;
  limitAccessByEnvironment: boolean;
  setLimitAccessByEnvironment: (limitAccess: boolean) => void;
  showUpgradeModal: () => void;
}> = ({
  role,
  setRole,
  environments,
  limitAccessByEnvironment,
  setEnvironments,
  setLimitAccessByEnvironment,
  showUpgradeModal,
}) => {
  const { roles } = useUser();

  const availableEnvs = useEnvironments();

  const { hasCommercialFeature } = useUser();

  const roleSupportsEnvLimit = ["engineer", "experimenter"].includes(role);

  const canLimitEnvAccess = hasCommercialFeature("env-permissions");

  const limitEnvAccess = canLimitEnvAccess && limitAccessByEnvironment;

  return (
    <div>
      <SelectField
        label="Role"
        value={role}
        onChange={setRole}
        options={roles.map((r) => ({
          label: r.id,
          value: r.id,
        }))}
        sort={false}
        formatOptionLabel={(value) => {
          const r = roles.find((r) => r.id === value.label);
          return (
            <div>
              <RoleDisplay
                role={r.id}
                environments={[]}
                limitAccessByEnvironment={false}
              />
              <small className="ml-2">
                <em>{r.description}</em>
              </small>
            </div>
          );
        }}
      />

      {roleSupportsEnvLimit && (
        <div className="appbox bg-light px-3 pt-3">
          <div className="form-group">
            <Toggle
              disabled={!hasCommercialFeature("env-permissions")}
              id={"role-modal"}
              value={limitEnvAccess}
              setValue={setLimitAccessByEnvironment}
            />{" "}
            Restrict Access to Specific Environments
          </div>
          {canLimitEnvAccess ? (
            <>
              {limitEnvAccess && (
                <MultiSelectField
                  label="Environments"
                  helpText="Select all environments you want the person to have permissions for"
                  value={environments}
                  onChange={setEnvironments}
                  options={availableEnvs.map((env) => ({
                    label: env.id,
                    value: env.id,
                    tooltip: env.description,
                  }))}
                />
              )}
            </>
          ) : (
            <div className="alert alert-info">
              {isCloud() ? (
                <>
                  You need to upgrade your plan to enable advanced,
                  per-environment permissioning.{" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      showUpgradeModal();
                    }}
                  >
                    Learn More
                  </a>
                </>
              ) : (
                <>
                  You need a commercial license key to enable this feature.
                  Contact{" "}
                  <a href="mailto:sales@growthbook.io">sales@growthbook.io</a>{" "}
                  for more info.
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RoleSelector;
