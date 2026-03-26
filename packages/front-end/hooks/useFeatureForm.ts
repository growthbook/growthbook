import { useMemo } from "react";
import { DefaultValues, useForm } from "react-hook-form";
import { FeatureEnvironment } from "shared/types/feature";
import { CustomField } from "shared/types/custom-fields";
import { Environment } from "shared/types/organization";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import { useWatching } from "@/services/WatchProvider";
import {
  filterCustomFieldsForSectionAndProject,
  useCustomFields,
} from "@/hooks/useCustomFields";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";

type FeatureFormDefaultValues = {
  environmentSettings: Record<string, FeatureEnvironment>;
  customFields: Record<string, string>;
  project?: string;
};

type FeatureFormInitialValues<T extends FeatureFormDefaultValues> = Omit<
  T,
  "environmentSettings" | "customFields"
> & {
  customFields?: Record<string, unknown>;
};

type UseFeatureFormOptions<T extends FeatureFormDefaultValues> = {
  initialValues: FeatureFormInitialValues<T>;
  environments?: Environment[];
  baseEnvironmentSettings?: Record<string, FeatureEnvironment>;
};

/** Shape of `defaultValues` after spreading `initialValues` and adding env/custom-field defaults. */
type MergedFeatureFormDefaults<T extends FeatureFormDefaultValues> = Omit<
  FeatureFormInitialValues<T>,
  "customFields"
> & {
  environmentSettings: Record<string, FeatureEnvironment>;
  customFields: Record<string, string>;
  project?: string;
};

function getFeatureCustomFields(
  allCustomFields: CustomField[] | undefined,
  project: string | undefined,
): CustomField[] | undefined {
  return filterCustomFieldsForSectionAndProject(
    allCustomFields,
    "feature",
    project,
  );
}

function getEnvironmentSettings({
  environments,
  canPublishFeature,
  project,
  baseEnvironmentSettings,
}: {
  environments: Environment[];
  canPublishFeature: ReturnType<typeof usePermissionsUtil>["canPublishFeature"];
  project: string | undefined;
  baseEnvironmentSettings?: Record<string, FeatureEnvironment>;
}): Record<string, FeatureEnvironment> {
  const envSettings: Record<string, FeatureEnvironment> = {};

  environments.forEach((e) => {
    const canPublish = canPublishFeature({ project }, [e.id]);
    const defaultEnabled = canPublish ? (e.defaultState ?? true) : false;
    const enabled = canPublish
      ? (baseEnvironmentSettings?.[e.id]?.enabled ?? defaultEnabled)
      : false;
    const rules = baseEnvironmentSettings?.[e.id]?.rules ?? [];

    envSettings[e.id] = { enabled, rules };
  });

  return envSettings;
}

function getCustomFieldValues(
  customFields: CustomField[] | undefined,
  existingValues?: Record<string, unknown>,
): Record<string, string> {
  if (!customFields) return {};
  return Object.fromEntries(
    customFields.map((field) => [
      field.id,
      getCustomFieldFormValue(
        field,
        existingValues?.[field.id] ?? field.defaultValue,
      ),
    ]),
  );
}

function getCustomFieldFormValue(field: CustomField, value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (field.type === "multiselect") {
    return Array.isArray(value) ? JSON.stringify(value) : String(value);
  }

  if (field.type === "boolean") {
    return typeof value === "string"
      ? String(value).trim().toLowerCase() === "true"
        ? "true"
        : "false"
      : String(Boolean(value));
  }

  return String(value);
}

function serializeCustomFieldValues(
  customFields: CustomField[] | undefined,
  currentValues: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!customFields || !currentValues) return undefined;
  const allowedIds = new Set(customFields.map((f) => f.id));
  return Object.fromEntries(
    Object.entries(currentValues).filter(([key]) => allowedIds.has(key)),
  ) as Record<string, string>;
}

export function useFeatureForm<T extends FeatureFormDefaultValues>({
  initialValues,
  environments,
  baseEnvironmentSettings,
}: UseFeatureFormOptions<T>) {
  const { project: currentProject, refreshTags } = useDefinitions();
  const allEnvironments = useEnvironments();
  const permissionsUtil = usePermissionsUtil();
  const { refreshWatching } = useWatching();
  const { hasCommercialFeature } = useUser();
  const { apiCall } = useAuth();
  const allCustomFields = useCustomFields();

  const resolvedProject = initialValues.project ?? currentProject;
  const resolvedEnvironments = environments ?? allEnvironments;

  const availableCustomFields = useMemo(() => {
    return hasCommercialFeature("custom-metadata")
      ? getFeatureCustomFields(allCustomFields, resolvedProject)
      : undefined;
  }, [allCustomFields, hasCommercialFeature, resolvedProject]);

  const {
    customFields: initialCustomFields,
    ...initialValuesWithoutCustomFields
  } = initialValues;

  const defaultValues = useMemo((): MergedFeatureFormDefaults<T> => {
    return {
      ...initialValuesWithoutCustomFields,
      environmentSettings: getEnvironmentSettings({
        environments: resolvedEnvironments,
        canPublishFeature: permissionsUtil.canPublishFeature,
        project: resolvedProject,
        baseEnvironmentSettings,
      }),
      customFields: getCustomFieldValues(
        availableCustomFields,
        initialCustomFields,
      ),
      project: resolvedProject,
    };
  }, [
    availableCustomFields,
    baseEnvironmentSettings,
    initialCustomFields,
    initialValuesWithoutCustomFields,
    permissionsUtil,
    resolvedEnvironments,
    resolvedProject,
  ]);

  const form = useForm<T>({
    defaultValues: defaultValues as DefaultValues<T>,
  });

  const getEnvironmentSettingsForProject = (project?: string) => {
    return getEnvironmentSettings({
      environments: resolvedEnvironments,
      canPublishFeature: permissionsUtil.canPublishFeature,
      project,
      baseEnvironmentSettings,
    });
  };

  const serializeCustomFields = (
    fieldProject: string | undefined,
    values: Record<string, unknown> | undefined,
  ) => {
    const fields = hasCommercialFeature("custom-metadata")
      ? getFeatureCustomFields(allCustomFields, fieldProject)
      : undefined;
    return serializeCustomFieldValues(fields, values);
  };

  const canManageDrafts = (project?: string) =>
    permissionsUtil.canManageFeatureDrafts({ project });

  return {
    form,
    environments: resolvedEnvironments,
    allEnvironments,
    currentProject,
    permissionsUtil,
    apiCall,
    hasCommercialFeature,
    allCustomFields,
    refreshTags,
    refreshWatching,
    serializeCustomFields,
    canManageDrafts,
    getEnvironmentSettingsForProject,
  };
}
