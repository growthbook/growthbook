import { FeatureValueType } from "shared/types/feature";
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
): string {
  return valueType === "string"
    ? "Set a value, or confirm you want an empty string"
    : "Set a value for this variation";
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
  if (valueType !== "string" || value !== "") return null;

  return (
    <Checkbox
      id={id}
      mt="1"
      size="md"
      labelSize="sm"
      weight="regular"
      label="Confirm an empty string"
      value={checked}
      setValue={setChecked}
    />
  );
}
