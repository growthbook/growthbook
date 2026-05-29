import { Box } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Environment } from "shared/types/organization";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import MultiSelectField from "@/ui/MultiSelectField";
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
  label?: string;
} & MarginProps;

export default function RuleEnvironmentScopeField({
  environments,
  allEnvironments,
  setAllEnvironments,
  selectedEnvironments,
  setSelectedEnvironments,
  label = "Rule Environments",
  ...marginProps
}: EnvScopeProps) {
  const options = environments.map((e) => ({ label: e.id, value: e.id }));

  return (
    <Box {...marginProps}>
      {label ? (
        <Text as="div" weight="semibold" mb="3">
          {label}
        </Text>
      ) : null}
      <RadioGroup
        value={allEnvironments ? "all" : "specific"}
        setValue={(v) => {
          const next = v === "all";
          setAllEnvironments(next);
          if (next) setSelectedEnvironments([]);
        }}
        gap="0"
        options={[
          { value: "all", label: "All Environments" },
          { value: "specific", label: "Specific Environments" },
        ]}
      />
      {!allEnvironments && (
        <Box pl="5">
          <MultiSelectField
            size="legacy"
            value={selectedEnvironments}
            onChange={(vals) => setSelectedEnvironments(vals)}
            options={options}
            placeholder="No environments selected"
            sort={false}
            showCopyButton={false}
            containerClassName="w-full"
          />
          {selectedEnvironments.length === 0 && (
            <Callout status="warning" size="sm" mt="2">
              This rule will not apply in any environment until at least one is
              selected.
            </Callout>
          )}
        </Box>
      )}
    </Box>
  );
}
