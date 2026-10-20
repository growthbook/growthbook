import { FC } from "react";
import { FEATURE_KEY_PATTERN } from "shared/constants";
import { UseFormRegisterReturn } from "react-hook-form";
import Field from "@/components/Forms/Field";
import useOrgSettings from "@/hooks/useOrgSettings";

const FeatureKeyField: FC<{
  keyField: UseFormRegisterReturn;
}> = ({ keyField }) => (
  <Field
    size="legacy"
    label="Feature Key"
    {...keyField}
    pattern={FEATURE_KEY_PATTERN}
    placeholder={useOrgSettings().featureKeyExample || "my-feature"}
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
