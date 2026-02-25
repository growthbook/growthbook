import { FeatureMetaInfo } from "shared/types/feature";
import { useMemo } from "react";
import useApi from "@/hooks/useApi";

export interface UseFeatureMetaInfoOptions {
  project?: string;
  includeDefaultValue?: boolean;
}

export function useFeatureMetaInfo({
  project,
  includeDefaultValue = false,
}: UseFeatureMetaInfoOptions = {}) {
  const params = new URLSearchParams();
  if (project) params.set("project", project);
  if (includeDefaultValue) params.set("defaultValue", "1");

  const query = params.toString();
  const url = query ? `/features/meta-info?${query}` : "/features/meta-info";

  const { data, error, mutate } = useApi<{ features: FeatureMetaInfo[] }>(url);

  const features = useMemo(() => data?.features ?? [], [data]);

  // Archived features are always included; filter client-side as needed.
  const hasArchived = useMemo(
    () => features.some((f) => f.archived),
    [features],
  );

  return {
    features,
    hasArchived,
    loading: !data && !error,
    error,
    mutate,
  };
}
