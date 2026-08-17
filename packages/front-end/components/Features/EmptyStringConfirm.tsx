import { FeatureValueType } from "shared/types/feature";
import Checkbox from "@/ui/Checkbox";

export function isEmptyStringCandidate(
  valueType: FeatureValueType | undefined,
  value: string,
): boolean {
  return valueType === "string" && value === "";
}

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

export default function EmptyStringConfirm({
  id,
  valueType,
  value,
  setValue,
  checked,
  setChecked,
  error,
}: {
  id?: string;
  valueType: FeatureValueType | undefined;
  value: string;
  setValue: (value: string) => void;
  checked: boolean;
  setChecked: (checked: boolean) => void;
  error?: string;
}) {
  if (!isEmptyStringCandidate(valueType, value)) return null;

  return (
    <Checkbox
      id={id}
      mt="1"
      size="md"
      labelSize="sm"
      weight="regular"
      label="Confirm an empty string"
      value={checked}
      setValue={(next) => {
        setChecked(next);
        if (next) setValue("");
      }}
      error={error}
    />
  );
}
