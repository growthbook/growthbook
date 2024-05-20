import { FC } from "react";
import { Environment } from "back-end/types/organization";
import { FeatureEnvironment } from "back-end/types/feature";
import { useDefinitions } from "@/services/DefinitionsContext";
import Toggle from "@/components/Forms/Toggle";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const EnvironmentSelect: FC<{
  environmentSettings: Record<string, FeatureEnvironment>;
  environments: Environment[];
  setValue: (env: Environment, enabled: boolean) => void;
}> = ({ environmentSettings, environments, setValue }) => {
  const permissionsUtil = usePermissionsUtil();
  const { project } = useDefinitions();
  return (
    <div className="form-group">
      <label>Enabled Environments</label>
      <div className="appbox px-3 pt-3 pb-2 bg-light">
        <div className="row">
          {environments.map((env) => (
            <div className="col-auto" key={env.id}>
              <div className="form-group mb-0">
                <label htmlFor={`${env.id}_toggle_create`} className="mr-2">
                  {env.id}:
                </label>
                <Toggle
                  id={`${env.id}_toggle_create`}
                  label={env.id}
                  disabledMessage="You don't have permission to create features in this environment."
                  disabled={
                    !permissionsUtil.canPublishFeature({ project }, [env.id])
                  }
                  className="mr-3"
                  value={environmentSettings[env.id].enabled}
                  setValue={(enabled) => setValue(env, enabled)}
                  type="environment"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default EnvironmentSelect;
