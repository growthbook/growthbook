import { Box } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { Environment } from "shared/types/organization";
import { Trans, useLingui } from "@lingui/react/macro";
import RadioGroup from "@/ui/RadioGroup";
import HelperText from "@/ui/HelperText";
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
  disabled?: boolean;
} & MarginProps;

export default function RuleEnvironmentScopeField({
  environments,
  allEnvironments,
  setAllEnvironments,
  selectedEnvironments,
  setSelectedEnvironments,
  disabledEnvironmentIds = [],
  disabled = false,
  label: labelProp,
  ...marginProps
}: EnvScopeProps) {
  const { t } = useLingui();
  const label = labelProp === undefined ? t`Rule Environments` : labelProp;
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
  const firstAffectedEnvId = affectedEnvIds[0];
  const affectedEnvIdList = affectedEnvIds.join(", ");

  const disabledWarning = allEnvsDisabled ? (
    <HelperText status="warning" size="sm" mt="2">
      <Trans>
        This feature is not enabled in any environment. This rule will have no
        effect until at least one environment is enabled.
      </Trans>
    </HelperText>
  ) : showPartialDisabledWarning ? (
    <HelperText status="warning" size="sm" mt="2">
      {affectedEnvIds.length === 1 ? (
        <Trans>
          <strong>{firstAffectedEnvId}</strong> is not enabled for this feature.
          This rule will have no effect there until the feature is enabled in
          that environment.
        </Trans>
      ) : (
        <Trans>
          <strong>{affectedEnvIdList}</strong> are not enabled for this feature.
          This rule will have no effect there until the feature is enabled in
          those environments.
        </Trans>
      )}
    </HelperText>
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
          // A list starts from the "all" it replaces, not from nothing.
          if (v === "specific" && !selectedEnvironments.length) {
            setSelectedEnvironments(environments.map((e) => e.id));
          }
        }}
        gap="0"
        disabled={disabled}
        options={[
          { value: "all", label: t`All Environments` },
          { value: "specific", label: t`Specific Environments` },
        ]}
      />
      {allEnvironments && disabledWarning}
      {!allEnvironments && (
        <Box pl="5">
          <MultiSelectField
            legacyHeight
            disabled={disabled}
            value={selectedEnvironments}
            onChange={(vals) => setSelectedEnvironments(vals)}
            options={options}
            placeholder={t`No environments selected`}
            sort={false}
            showCopyButton={false}
            containerClassName="w-full"
          />
          {selectedEnvironments.length === 0 && !disabledWarning && (
            <HelperText status="warning" size="sm" mt="2">
              <Trans>
                This rule will not apply in any environment until at least one
                is selected.
              </Trans>
            </HelperText>
          )}
          {disabledWarning}
        </Box>
      )}
    </Box>
  );
}
