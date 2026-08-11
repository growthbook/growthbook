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

/**
 * Owns custom-field reconciliation for a form. The form owner passes its
 * current custom-field value and a setter; the hook derives the fields that
 * apply for the section/project, reconciles the stored value against them
 * (seeding defaults, dropping stale keys), and syncs the reconciled value back
 * into the form when it differs.
 *
 * Custom fields are gated behind the "custom-metadata" commercial feature, so
 * the hook no-ops (no available fields, no form writes) when it isn't licensed.
 *
 * Reconciliation runs in an effect owned by the form component, so
 * react-hook-form is already initialized and no microtask deferral is needed.
 */
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
