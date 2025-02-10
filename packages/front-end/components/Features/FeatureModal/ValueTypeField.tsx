import { FC } from "react";
import { FeatureValueType } from "back-end/types/feature";
import SelectField from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";

const ValueTypeField: FC<{
  onChange: (v: FeatureValueType) => void;
  value: FeatureValueType;
  useCustom?: boolean;
}> = ({ onChange, value, useCustom }) => {
  const { hasCommercialFeature } = useUser();
  const hasJsonValidator = hasCommercialFeature("json-validation");

  const customLabel = hasJsonValidator
    ? "Custom"
    : "Custom (Requires Enterprise plan)";

  const options = [
    {
      label: "Boolean (true/false)",
      value: "boolean",
    },
    { label: "String", value: "string" },
    { label: "Number", value: "number" },
    { label: "JSON", value: "json" },
  ];
  if (useCustom) {
    options.push({
      label: customLabel,
      value: "custom",
    });
  }
  return (
    <SelectField
      label="Value Type"
      value={value}
      onChange={onChange}
      placeholder="Select Type..."
      options={options}
      isOptionDisabled={(o: { label: string; value: string }) => {
        if (o?.value === "custom") {
          return !hasJsonValidator;
        }
        return false;
      }}
      required
      sort={false}
    />
  );
};

export default ValueTypeField;
