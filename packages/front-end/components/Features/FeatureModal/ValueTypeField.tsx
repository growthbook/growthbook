import { FC } from "react";
import { FeatureValueType } from "shared/types/feature";
import { useUser } from "@/services/UserContext";
import SelectField, { isSingleValue } from "@/components/Forms/SelectField";

// UI authoring type. "config" is a special, enterprise-gated class of JSON —
// stored as valueType "json" backed by a config, not a runtime value type.
export type FeatureAuthoringType = FeatureValueType | "config";

const ValueTypeField: FC<{
  onChange: (v: FeatureAuthoringType) => void;
  value: FeatureAuthoringType;
  // Offer the config-backed authoring type (only flows whose value editor
  // supports config backing should enable this).
  allowConfig?: boolean;
}> = ({ onChange, value, allowConfig = false }) => {
  const { hasCommercialFeature } = useUser();
  const canUseConfig = hasCommercialFeature("feature-configs");

  return (
    <SelectField
      label="Value Type"
      value={value}
      onChange={(v) => onChange(v as FeatureAuthoringType)}
      placeholder="Select Type..."
      options={[
        { label: "Boolean (true/false)", value: "boolean" },
        { label: "String", value: "string" },
        { label: "Number", value: "number" },
        { label: "JSON", value: "json" },
        ...(allowConfig
          ? [
              {
                label: canUseConfig
                  ? "Config (JSON backed by a config)"
                  : "Config (Enterprise)",
                value: "config",
              },
            ]
          : []),
      ]}
      isOptionDisabled={(o) =>
        isSingleValue(o) && o.value === "config" && !canUseConfig
      }
      required
      sort={false}
    />
  );
};

export default ValueTypeField;
