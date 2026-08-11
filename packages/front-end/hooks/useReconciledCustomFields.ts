import { useEffect, useMemo } from "react";
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

  const reconciledValue = useMemo(
    () => reconcileCustomFieldValues(availableFields, value),
    [availableFields, value],
  );

  useEffect(() => {
    if (!enabled) return;
    if (
      !customFieldValuesEqual(
        reconciledValue,
        normalizeCustomFieldValues(value),
      )
    ) {
      setValue(reconciledValue);
    }
  }, [enabled, reconciledValue, value, setValue]);

  return { availableFields, value: reconciledValue };
}
