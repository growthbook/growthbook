import { useEffect, useMemo, useRef } from "react";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import {
  customFieldValuesEqual,
  filterCustomFieldsForSectionAndProject,
  normalizeCustomFieldValues,
  reconcileCustomFieldValues,
  useCustomFields,
} from "@/hooks/useCustomFields";
import { useUser } from "@/services/UserContext";

export function useReconciledCustomFields({
  section,
  project,
  value,
  setValue,
}: {
  section: CustomFieldSection;
  project: string | undefined;
  value: Record<string, unknown> | string | null | undefined;
  setValue: (value: Record<string, string>) => void;
}): { availableFields: CustomField[]; value: Record<string, string> } {
  const { hasCommercialFeature } = useUser();
  const enabled = hasCommercialFeature("custom-metadata");
  const allCustomFields = useCustomFields();

  const availableFields = useMemo(
    () =>
      enabled
        ? (filterCustomFieldsForSectionAndProject(
            allCustomFields,
            section,
            project,
          ) ?? [])
        : [],
    [allCustomFields, section, project, enabled],
  );

  const normalizedValue = useMemo(
    () => normalizeCustomFieldValues(value),
    [value],
  );

  const reconciledValue = useMemo(
    () => reconcileCustomFieldValues(availableFields, normalizedValue),
    [availableFields, normalizedValue],
  );

  // `setValue` is an inline closure at every call site; depending on it would
  // re-run the sync effect on every render of the forms using this hook.
  const setValueRef = useRef(setValue);
  useEffect(() => {
    setValueRef.current = setValue;
  });

  useEffect(() => {
    // Skipped when unlicensed so a downgrade can't wipe already-saved values.
    if (!enabled) return;
    if (!customFieldValuesEqual(reconciledValue, normalizedValue)) {
      setValueRef.current(reconciledValue);
    }
  }, [enabled, reconciledValue, normalizedValue]);

  return { availableFields, value: reconciledValue };
}
