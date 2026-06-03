import { Box } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Environment } from "shared/types/organization";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
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
  disabledEnvironmentIds?: string[];
  label?: string;
} & MarginProps;

export default function RuleEnvironmentScopeField({
  environments,
  allEnvironments,
  setAllEnvironments,
  selectedEnvironments,
  setSelectedEnvironments,
  disabledEnvironmentIds = [],
  label = "Rule Environments",
  ...marginProps
}: EnvScopeProps) {
  const options = environments.map((e) => ({ label: e.id, value: e.id }));

  const disabledSet = new Set(disabledEnvironmentIds);
  const affectedEnvIds = allEnvironments
    ? disabledEnvironmentIds
    : selectedEnvironments.filter((e) => disabledSet.has(e));
  // Only warn when *some but not all* feature environments are disabled — if
  // every environment is off the feature is entirely inactive and there's
  // nothing specific to single out.
  const showDisabledWarning =
    affectedEnvIds.length > 0 &&
    disabledEnvironmentIds.length < environments.length;

  const disabledWarning = showDisabledWarning ? (
    <Callout status="warning" size="sm" mt="2">
      {affectedEnvIds.length === 1 ? (
        <>
          <strong>{affectedEnvIds[0]}</strong> is not enabled for this feature.
          This rule will have no effect there until the feature is enabled in
          that environment.
        </>
      ) : (
        <>
          <strong>
            {affectedEnvIds.slice(0, -1).join(", ")} and{" "}
            {affectedEnvIds[affectedEnvIds.length - 1]}
          </strong>{" "}
          are not enabled for this feature. This rule will have no effect there
          until the feature is enabled in those environments.
        </>
      )}
    </Callout>
  ) : null;

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
      {allEnvironments && disabledWarning}
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
          {selectedEnvironments.length === 0 && (
            <Callout status="warning" size="sm" mt="2">
              This rule will not apply in any environment until at least one is
              selected.
            </Callout>
          )}
          {disabledWarning}
        </Box>
      )}
    </Box>
  );
}
