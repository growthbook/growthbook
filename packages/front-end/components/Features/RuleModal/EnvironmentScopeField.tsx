import { Box } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Environment } from "shared/types/organization";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import MultiSelectField from "@/ui/MultiSelectField";

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
  const allEnvsDisabled =
    environments.length > 0 &&
    disabledEnvironmentIds.length === environments.length;
  const affectedEnvIds = allEnvironments
    ? disabledEnvironmentIds
    : selectedEnvironments.filter((e) => disabledSet.has(e));
  const showPartialDisabledWarning =
    !allEnvsDisabled &&
    affectedEnvIds.length > 0 &&
    disabledEnvironmentIds.length < environments.length;

  const disabledWarning = allEnvsDisabled ? (
    <Callout status="warning" size="sm" mt="2">
      This feature is not enabled in any environment. This rule will have no
      effect until at least one environment is enabled.
    </Callout>
  ) : showPartialDisabledWarning ? (
    <Callout status="warning" size="sm" mt="2">
      {affectedEnvIds.length === 1 ? (
        <>
          <strong>{affectedEnvIds[0]}</strong> is not enabled for this feature.
          This rule will have no effect there until the feature is enabled in
          that environment.
        </>
      ) : (
        <>
          <strong>{affectedEnvIds.join(", ")}</strong> are not enabled for this
          feature. This rule will have no effect there until the feature is
          enabled in those environments.
        </>
      )}
    </Callout>
  ) : null;

  return (
    <Box {...marginProps}>
      {label ? (
        <Box mb="3">
          <label className="mb-0" style={{ fontWeight: 600 }}>
            {label}
          </label>
        </Box>
      ) : null}
      <RadioGroup
        value={allEnvironments ? "all" : "specific"}
        setValue={(v) => {
          setAllEnvironments(v === "all");
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
            size="legacy"
            value={selectedEnvironments}
            onChange={(vals) => setSelectedEnvironments(vals)}
            options={options}
            placeholder="No environments selected"
            sort={false}
            showCopyButton={false}
            containerClassName="w-full"
          />
          {selectedEnvironments.length === 0 && !disabledWarning && (
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
