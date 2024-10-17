import { FC } from "react";
import { Environment } from "back-end/types/organization";
import { FeatureEnvironment } from "back-end/types/feature";
import {
  CheckboxGroup,
  Container,
  Text,
  Checkbox as RadixCheckbox,
  Flex,
} from "@radix-ui/themes";
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
  return (
    <div className="form-group">
      <Container p="5" style={{ background: "#FAF8FF" }}>
        <Text as="label" weight="bold">
          Enabled Environments
        </Text>
        <CheckboxGroup.Root name="enabled-environments" mt="3">
          <Text
            as="label"
            className={"rt-CheckboxItem"}
            size="2"
            onClick={() => {
              environments.forEach((env) => {
                setValue(env, true);
              });
            }}
          >
            <Flex gap="2" mb="2">
              <RadixCheckbox checked={"indeterminate"} color={"violet"} />
              <Flex direction="column" gap="1">
                <Text weight="bold" className="main-text">
                  Select All
                </Text>
              </Flex>
            </Flex>
          </Text>
          {environments.map((env) => (
            <Checkbox
              disabled={
                !permissionsUtil.canPublishFeature({ project }, [env.id])
              }
              disabledMessage="You don't have permission to create features in this environment."
              value={environmentSettings[env.id].enabled}
              setValue={(enabled) => setValue(env, enabled)}
              label={env.id}
              key={env.id}
              weight="regular"
            />
          ))}
        </CheckboxGroup.Root>
      </Container>
    </div>
  );
};

export default EnvironmentSelect;
