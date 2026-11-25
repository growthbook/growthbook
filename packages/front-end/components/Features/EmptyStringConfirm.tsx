import { ReactNode } from "react";
import { FeatureValueType } from "shared/types/feature";
import { Trans, useLingui } from "@lingui/react/macro";
import Checkbox from "@/ui/Checkbox";

export function isUnsetFeatureValue({
  valueType,
  value,
  emptyStringConfirmed,
}: {
  valueType: FeatureValueType | undefined;
  value: string;
  emptyStringConfirmed: boolean;
}): boolean {
  if (valueType === "string") {
    return value === "" && !emptyStringConfirmed;
  }
  return value.trim() === "";
}

export function unsetFeatureValueMessage(
  valueType: FeatureValueType | undefined,
): ReactNode {
  return valueType === "string" ? (
    <Trans>Set a value, or confirm you want an empty string</Trans>
  ) : (
    <Trans>Set a value for this variation</Trans>
  );
}

export default function EmptyStringConfirm({
  id,
  valueType,
  value,
  checked,
  setChecked,
}: {
  id?: string;
  valueType: FeatureValueType | undefined;
  value: string;
  checked: boolean;
  setChecked: (checked: boolean) => void;
}) {
  const { t } = useLingui();
  if (valueType !== "string" || value !== "") return null;

  return (
    <Checkbox
      id={id}
      mt="1"
      size="md"
      labelSize="sm"
      weight="regular"
      label={t`Confirm an empty string`}
      value={checked}
      setValue={setChecked}
    />
  );
}
