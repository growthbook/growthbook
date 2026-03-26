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

type FeatureFormBaseValues = {
  environmentSettings: Record<string, FeatureEnvironment>;
  customFields: Record<string, string>;
  project?: string;
};

type UseFeatureFormOptions<T extends FeatureFormBaseValues> = {
  project?: string;
  environments?: Environment[];
  existingEnvironmentSettings?: Record<string, FeatureEnvironment>;
  existingCustomFieldValues?: Record<string, unknown>;
  getDefaultValues: (base: FeatureFormBaseValues) => T;
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
  existingEnvironmentSettings,
}: {
  environments: Environment[];
  canPublishFeature: ReturnType<typeof usePermissionsUtil>["canPublishFeature"];
  project: string | undefined;
  existingEnvironmentSettings?: Record<string, FeatureEnvironment>;
}): Record<string, FeatureEnvironment> {
  const envSettings: Record<string, FeatureEnvironment> = {};

  environments.forEach((e) => {
    const canPublish = canPublishFeature({ project }, [e.id]);
    const defaultEnabled = canPublish ? (e.defaultState ?? true) : false;
    const enabled = canPublish
      ? (existingEnvironmentSettings?.[e.id]?.enabled ?? defaultEnabled)
      : false;
    const rules = existingEnvironmentSettings?.[e.id]?.rules ?? [];

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
      (existingValues?.[field.id] as string) ?? field.defaultValue ?? "",
    ]),
  );
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

export function useFeatureForm<T extends FeatureFormBaseValues>({
  project,
  environments,
  existingEnvironmentSettings,
  existingCustomFieldValues,
  getDefaultValues,
}: UseFeatureFormOptions<T>) {
  const { project: currentProject, refreshTags } = useDefinitions();
  const allEnvironments = useEnvironments();
  const permissionsUtil = usePermissionsUtil();
  const { refreshWatching } = useWatching();
  const { hasCommercialFeature } = useUser();
  const { apiCall } = useAuth();
  const allCustomFields = useCustomFields();

  const resolvedProject = project ?? currentProject;
  const resolvedEnvironments = environments ?? allEnvironments;

  const customFields = useMemo(() => {
    return hasCommercialFeature("custom-metadata")
      ? getFeatureCustomFields(allCustomFields, resolvedProject)
      : undefined;
  }, [allCustomFields, hasCommercialFeature, resolvedProject]);

  const baseDefaults = useMemo<FeatureFormBaseValues>(() => {
    return {
      environmentSettings: getEnvironmentSettings({
        environments: resolvedEnvironments,
        canPublishFeature: permissionsUtil.canPublishFeature,
        project: resolvedProject,
        existingEnvironmentSettings,
      }),
      customFields: getCustomFieldValues(
        customFields,
        existingCustomFieldValues,
      ),
      project: resolvedProject,
    };
  }, [
    customFields,
    existingCustomFieldValues,
    existingEnvironmentSettings,
    permissionsUtil,
    resolvedEnvironments,
    resolvedProject,
  ]);

  const form = useForm<T>({
    defaultValues: getDefaultValues(baseDefaults) as DefaultValues<T>,
  });

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
  };
}
