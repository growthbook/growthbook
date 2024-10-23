import { FC } from "react";
import { Environment } from "back-end/types/organization";
import { FeatureEnvironment } from "back-end/types/feature";
import { Container, Flex, Text } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Checkbox from "@/components/Radix/Checkbox";

const EnvironmentSelect: FC<{
  environmentSettings: Record<string, FeatureEnvironment>;
  environments: Environment[];
  setValue: (env: Environment, enabled: boolean) => void;
}> = ({ environmentSettings, environments, setValue }) => {
  const permissionsUtil = usePermissionsUtil();
  const { project } = useDefinitions();
  const selectAllChecked = Object.values(environmentSettings).every(
    (env) => env.enabled
  );
  const selectAllIndeterminate = Object.values(environmentSettings).some(
    (env) => env.enabled
  );

  return (
    <div className="form-group">
      <Container
        p="5"
        style={{
          background: "var(--color-background)",
          borderRadius: "var(--radius-2)",
        }}
      >
        <Text as="label" weight="bold" mb="4">
          Enabled Environments
        </Text>
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
              environments.forEach((env) => {
                setValue(env, v === true);
              })
            }
            label="Select All"
            weight="bold"
            mb="5"
          />
        </div>
        <Flex
          direction="column"
          wrap="wrap"
          style={{ maxHeight: "168px" }}
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
              mb="4"
            />
          ))}
        </Flex>
      </Container>
    </div>
  );
};

export default EnvironmentSelect;
