import { FC } from "react";
import { FeatureValueType } from "back-end/types/feature";
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
      options={[
        {
          label: "boolean (on/off)",
          value: "boolean",
        },
        { label: "number", value: "number" },
        { label: "string", value: "string" },
        { label: "json", value: "json" },
      ]}
    />
  );
};

export default ValueTypeField;
