import { useEffect, useMemo, useRef } from "react";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { useCustomFields } from "@/hooks/useCustomFields";
import {
  customFieldValuesEqual,
  filterCustomFieldsForSectionAndProjects,
  normalizeCustomFieldValues,
  reconcileCustomFieldValues,
} from "@/services/customFields";
import { useUser } from "@/services/UserContext";

export function useReconciledCustomFields({
  section,
  project,
  projects,
  value,
  setValue,
}: {
  section: CustomFieldSection;
  project?: string | undefined;
  /** For entities scoped to several projects at once, such as attributes. */
  projects?: string[] | undefined;
  value: Record<string, unknown> | string | null | undefined;
  setValue: (value: Record<string, string>) => void;
}): { availableFields: CustomField[]; value: Record<string, string> } {
  const { hasCommercialFeature } = useUser();
  const enabled = hasCommercialFeature("custom-metadata");
  const allCustomFields = useCustomFields();

  // Depend on the joined string, not the array: callers pass a fresh array
  // (e.g. react-hook-form's watch) on every render.
  const projectsKey = (projects ?? (project === undefined ? [] : [project]))
    .slice()
    .sort()
    .join(",");

  const availableFields = useMemo(
    () =>
      enabled
        ? (filterCustomFieldsForSectionAndProjects(
            allCustomFields,
            section,
            projectsKey ? projectsKey.split(",") : [],
          ) ?? [])
        : [],
    [allCustomFields, section, projectsKey, enabled],
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
