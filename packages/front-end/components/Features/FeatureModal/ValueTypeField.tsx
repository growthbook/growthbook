import { FC } from "react";
import { FeatureValueType } from "shared/types/feature";
import SelectField from "@/components/Forms/SelectField";

const ValueTypeField: FC<{
  onChange: (v: FeatureValueType) => void;
  value: FeatureValueType;
}> = ({ onChange, value }) => {
  return (
    <SelectField
      label="Value Type"
      value={value}
      onChange={onChange}
      placeholder="Select Type..."
      options={[
        {
          label: "Boolean (true/false)",
          value: "boolean",
        },
        { label: "String", value: "string" },
        { label: "Number", value: "number" },
        { label: "JSON", value: "json" },
      ]}
      required
      sort={false}
    />
  );
};

export default ValueTypeField;
