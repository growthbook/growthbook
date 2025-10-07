import { ScopedSettings } from "shared/settings";
import SelectField from "@/components/Forms/SelectField";
import { capitalizeFirstLetter } from "@/services/utils";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBSequential } from "@/components/Icons";

export default function SequentialTestingSettingsOverrideSelector({
  value,
  onChange,
  parentSettings,
  disabled,
}: {
  value: "parent" | "disabled" | "standard" | "hybrid";
  onChange: (v: "parent" | "disabled" | "standard" | "hybrid") => void;
  parentSettings?: ScopedSettings;
  disabled?: boolean;
}) {
  const parentScopeId = parentSettings?.sequentialTestingSettings?.meta?.scopeApplied;

  const parentType = parentSettings?.sequentialTestingSettings?.value?.type ?? "disabled";

  const overrideLabel = `${capitalizeFirstLetter(parentScopeId ?? "Organization")} default (${parentType})`;
  const options = [
    {
      label: overrideLabel,
      value: "parent",
    },
    {
      label: "Disabled",
      value: "disabled",
    },
    {
      label: "Standard",
      value: "standard",
    },
    {
      label: "Hybrid",
      value: "hybrid",
    },
  ];


  // const parentTuningParameter = parentSettings?.sequentialTestingSettings.value.type === "standard" ? parentSettings.sequentialTestingSettings.value.tuningParameter : DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
  // const parentAlphaProportion = parentSettings?.sequentialTestingSettings.value.type === "hybrid" ? parentSettings.sequentialTestingSettings.value.reservedAlphaProportion : undefined;
  
  return <SelectField
        label={<PremiumTooltip commercialFeature="sequential-testing">
          <GBSequential /> Sequential Testing
      </PremiumTooltip>}
        value={value}
        onChange={onChange}
        options={options}
        formatOptionLabel={({ value, label }) => {
          if (value === "parent") {
            return <em className="text-muted">{label}</em>;
          }
          return label;
        }}
        disabled={disabled}
        sort={false}
        style={{ width: 300 }}
        // !hasSequentialTestingFeature ||
        // usingSequentialTestingDefault
        // }
      />;
    // todo: add org default helper text customization
}
