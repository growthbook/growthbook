import { FC } from "react";
import { UseFormRegisterReturn } from "react-hook-form";
import Field from "@/components/Forms/Field";
import useOrgSettings from "@/hooks/useOrgSettings";

const FeatureKeyField: FC<{
  keyField: UseFormRegisterReturn;
}> = ({ keyField }) => (
  <Field
    label="Feature Key"
    {...keyField}
    pattern="^[a-zA-Z0-9_.:|-]+$"
    placeholder={useOrgSettings().featureKeyExample || "我的feature"}
    required
    title="只允许使用字母、数字以及字符'_-.:|'。不允许有空格。"
    helpText={
      <>
        只允许使用字母、数字以及字符 <code>_</code>、<code>-</code>、<code>.</code>、<code>:</code> 和 <code>|</code>。不允许有空格。{" "}
        <strong>之后无法更改！</strong>
      </>
    }
  />
);

export default FeatureKeyField;
