import { FC, useMemo } from "react";
import { Environment } from "back-end/types/organization";
import { FeatureEnvironment } from "back-end/types/feature";
import { Box, Grid, Text } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Checkbox from "@/ui/Checkbox";

const EnvironmentSelect: FC<{
  environmentSettings: Record<string, Pick<FeatureEnvironment, "enabled">>;
  environments: Environment[];
  setValue: (env: Environment, enabled: boolean) => void;
  label?: string;
}> = ({ environmentSettings, environments, setValue, label }) => {
  const permissionsUtil = usePermissionsUtil();
  const { project } = useDefinitions();
  const environmentsUserCanAccess = useMemo(() => {
    return environments.filter((env) => {
      return permissionsUtil.canPublishFeature({ project }, [env.id]);
    });
  }, [environments, permissionsUtil, project]);

  const selectAllChecked = environmentsUserCanAccess.every(
    (env) => environmentSettings[env.id]?.enabled,
  );
  const selectAllIndeterminate = environmentsUserCanAccess.some(
    (env) => environmentSettings[env.id]?.enabled,
  );

  return (
    <div className="form-group">
      <Text as="label" weight="bold" mb="2">
        {label || "Enabled Environments"}
      </Text>
      <Box
        className="box"
        p="4"
        style={{
          borderRadius: "var(--radius-2)",
        }}
      >
        <div>
          <Checkbox
            value={
              selectAllChecked
                ? true
                : selectAllIndeterminate
                  ? "indeterminate"
                  : false
            }
            setValue={(v) =>
              environmentsUserCanAccess.forEach((env) => {
                setValue(env, v === true);
              })
            }
            label="Select All"
            weight="bold"
            mb="5"
          />
        </div>
        <Grid
          columns={{ initial: "2", md: "4" }}
          flow="row"
          style={{ maxHeight: "168px", wordBreak: "break-all" }}
          overflowY="auto"
        >
          {environments.map((env) => (
            <Checkbox
              disabled={
                !permissionsUtil.canPublishFeature({ project }, [env.id])
              }
              disabledMessage="You don't have permission to create features in this environment."
              value={environmentSettings[env.id].enabled}
              setValue={(enabled) => setValue(env, enabled === true)}
              label={env.id}
              key={env.id}
              weight="regular"
              mb="1"
              mr="2"
            />
          ))}
        </Grid>
      </Box>
    </div>
  );
};

export default EnvironmentSelect;
