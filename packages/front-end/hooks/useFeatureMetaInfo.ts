import { FeatureMetaInfo } from "shared/types/feature";
import useApi from "@/hooks/useApi";

// The backend always returns archived features; filtering is client-side.
export function useFeatureMetaInfo({
  project,
  includeDefaultValue = false,
}: {
  project?: string;
  includeDefaultValue?: boolean;
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
