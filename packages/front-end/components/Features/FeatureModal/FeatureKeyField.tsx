import { FC } from "react";
import { UseFormRegisterReturn } from "react-hook-form";
import Field from "@/components/Forms/Field";

const FeatureKeyField: FC<{ keyField: UseFormRegisterReturn }> = ({
  keyField,
}) => (
  <Field
    label="Feature Key"
    {...keyField}
    pattern="^[a-zA-Z0-9_.:|-]+$"
    placeholder="my-feature"
    required
    title="Only letters, numbers, and the characters '_-.:|' allowed. No spaces."
    helpText={
      <>
        Only letters, numbers, and the characters <code>_</code>, <code>-</code>
        , <code>.</code>, <code>:</code>, and <code>|</code> allowed. No spaces.{" "}
        <strong>Cannot be changed later!</strong>
      </>
    }
  />
);

export default FeatureKeyField;
