import { FC } from "react";
import { FEATURE_KEY_PATTERN } from "shared/constants";
import { UseFormRegisterReturn } from "react-hook-form";
import { Trans, useLingui } from "@lingui/react/macro";
import Field from "@/components/Forms/Field";
import useOrgSettings from "@/hooks/useOrgSettings";

const FeatureKeyField: FC<{
  keyField: UseFormRegisterReturn;
}> = ({ keyField }) => {
  const { t } = useLingui();
  const { featureKeyExample } = useOrgSettings();
  return (
    <Field
      size="legacy"
      label={t`Feature Key`}
      {...keyField}
      pattern={FEATURE_KEY_PATTERN}
      placeholder={featureKeyExample || "my-feature"}
      required
      title={t`Only letters, numbers, and the characters '_-.:|' allowed. No spaces.`}
      helpText={
        <Trans>
          Only letters, numbers, and the characters <code>_</code>,{" "}
          <code>-</code>, <code>.</code>, <code>:</code>, and <code>|</code>{" "}
          allowed. No spaces. <strong>Cannot be changed later!</strong>
        </Trans>
      }
    />
  );
};

export default FeatureKeyField;
