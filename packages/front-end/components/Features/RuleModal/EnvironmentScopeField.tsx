import { Box } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Environment } from "shared/types/organization";
import RadioGroup from "@/ui/RadioGroup";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Text from "@/ui/Text";

// Rule-level environment scope editor. Sits under the Description field in
// every rule-type modal. `selectedEnvironments: []` with `allEnvironments: false`
// is a valid "pending" state (e.g. ramp seed).
export type EnvScopeProps = {
  environments: Environment[];
  allEnvironments: boolean;
  setAllEnvironments: (v: boolean) => void;
  selectedEnvironments: string[];
  setSelectedEnvironments: (v: string[]) => void;
} & MarginProps;

export default function RuleEnvironmentScopeField({
  environments,
  allEnvironments,
  setAllEnvironments,
  selectedEnvironments,
  setSelectedEnvironments,
  ...marginProps
}: EnvScopeProps) {
  const options = environments.map((e) => ({ label: e.id, value: e.id }));

  return (
    <Box {...marginProps}>
      <Text as="div" weight="semibold" mb="3">
        Rule Environments
      </Text>
      <RadioGroup
        value={allEnvironments ? "all" : "specific"}
        setValue={(v) => {
          const next = v === "all";
          setAllEnvironments(next);
          if (next) setSelectedEnvironments([]);
        }}
        gap="0"
        options={[
          { value: "all", label: "All environments" },
          { value: "specific", label: "Specific environments" },
        ]}
      />
      {!allEnvironments && (
        <Box pl="5">
          <MultiSelectField
            value={selectedEnvironments}
            onChange={(vals) => setSelectedEnvironments(vals)}
            options={options}
            placeholder="No environments selected"
            sort={false}
            showCopyButton={false}
            containerClassName="w-full"
          />
        </Box>
      )}
    </Box>
  );
}
