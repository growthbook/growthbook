import { FC } from "react";
import { FeatureValueType } from "back-end/types/feature";
import SelectField from "@/components/Forms/SelectField";

const ValueTypeField: FC<{
  onChange: (v: FeatureValueType) => void;
  value: FeatureValueType;
}> = ({ onChange, value }) => {
  return (
    <SelectField
      label="数值类型"
      value={value}
      onChange={onChange}
      placeholder="选择类型..."
      options={[
        {
          label: "布尔值Boolean (true/false)",
          value: "boolean",
        },
        { label: "字符串String", value: "string" },
        { label: "数值Number", value: "number" },
        { label: "JSON", value: "json" },
      ]}
      required
      sort={false}
    />
  );
};

export default ValueTypeField;
