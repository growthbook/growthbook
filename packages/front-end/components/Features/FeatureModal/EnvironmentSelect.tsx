import { FC } from "react";
import { Environment } from "back-end/types/organization";
import { FeatureEnvironment } from "back-end/types/feature";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import Toggle from "@/components/Forms/Toggle";
import usePermissions from "@/hooks/usePermissions";

const EnvironmentSelect: FC<{
  environmentSettings: Record<string, FeatureEnvironment>;
  setValue: (env: Environment, enabled: boolean) => void;
}> = ({ environmentSettings, setValue }) => {
  const environments = useEnvironments();
  const permissions = usePermissions();
  const { project } = useDefinitions();
  return (
    <div className="form-group">
      <label>Enabled Environments</label>
      <div className="row">
        {environments.map((env) => (
          <div className="col-auto" key={env.id}>
            <div className="form-group mb-0">
              <label htmlFor={`${env.id}_toggle_create`} className="mr-2 ml-3">
                {env.id}:
              </label>
              <Toggle
                id={`${env.id}_toggle_create`}
                label={env.id}
                disabledMessage="You don't have permission to create features in this environment."
                disabled={
                  !permissions.check("publishFeatures", project, [env.id])
                }
                value={environmentSettings[env.id].enabled}
                setValue={(enabled) => setValue(env, enabled)}
                type="environment"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EnvironmentSelect;
