import { Flex } from "@radix-ui/themes";
import { FeatureRule } from "back-end/types/feature";
import { Environment } from "back-end/types/organization";
import Badge from "@/components/Radix/Badge";
import SelectField from "@/components/Forms/SelectField";

export default function EnvironmentDropdown({
  label,
  env,
  setEnv,
  environments,
  rulesByEnv,
}: {
  label?: string;
  env?: string;
  setEnv: (env: string) => void;
  environments: Environment[];
  rulesByEnv: Record<string, FeatureRule[]>;
}) {
  return (
    <SelectField
      label={label}
      value={env || ""}
      onChange={setEnv}
      options={environments.map((e) => ({
        label: e.id,
        value: e.id,
      }))}
      formatOptionLabel={({ value }) => (
        <Flex justify="between" align="center">
          <span>{value}</span>
          <Badge
            label={`${rulesByEnv[value].length} Rule${
              rulesByEnv[value].length > 1 ? "s" : ""
            } applied`}
          />
        </Flex>
      )}
    />
  );
}
