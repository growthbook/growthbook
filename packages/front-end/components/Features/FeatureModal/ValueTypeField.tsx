import { FC } from "react";
import { FeatureValueType } from "back-end/types/feature";
import SelectField from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";

const ValueTypeField: FC<{
  onChange: (v: FeatureValueType) => void;
  value: FeatureValueType;
}> = ({ onChange, value }) => {
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
    { label: customLabel, value: "custom", disabled: hasJsonValidator },
  ];
  return (
    <SelectField
      label="Value Type"
      value={value}
      onChange={onChange}
      placeholder="Select Type..."
      options={options}
      required
      sort={false}
    />
  );
};

export default ValueTypeField;
