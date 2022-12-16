import { ChangeEvent, FC } from "react";
import { FeatureValueType } from "back-end/types/feature";
import Field from "@/components/Forms/Field";

const ValueTypeField: FC<{
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  value: FeatureValueType;
}> = ({ onChange, value }) => {
  return (
    <Field
      label="Value Type"
      value={value}
      onChange={onChange}
      options={[
        {
          display: "boolean (on/off)",
          value: "boolean",
        },
        "number",
        "string",
        "json",
      ]}
    />
  );
};

export default ValueTypeField;
