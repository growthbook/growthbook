import { FeatureMetaInfo } from "shared/types/feature";
import useApi from "@/hooks/useApi";

// The backend always returns archived features; filtering is client-side.
export function useFeatureMetaInfo({
  project,
  includeDefaultValue = false,
  customFields = [],
}: {
  project?: string;
  includeDefaultValue?: boolean;
  // Custom field keys whose values to include.
  customFields?: string[];
} = {}): {
  features: FeatureMetaInfo[];
  loading: boolean;
  error: Error | undefined;
  mutate: () => void;
  hasArchived: boolean;
} {
  const params = new URLSearchParams();
  if (project) params.set("project", project);
  if (includeDefaultValue) params.set("defaultValue", "1");
  if (customFields.length) params.set("customFields", customFields.join(","));
  const qs = params.toString();

  const { data, isLoading, error, mutate } = useApi<{
    features: FeatureMetaInfo[];
  }>(`/features/meta-info${qs ? `?${qs}` : ""}`);

  const features = data?.features ?? [];

  return {
    features,
    loading: isLoading,
    error,
    mutate,
    hasArchived: features.some((f) => f.archived),
  };
}
