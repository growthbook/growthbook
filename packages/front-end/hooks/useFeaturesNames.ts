import { FeatureMetaInfo } from "shared/types/feature";
import { useMemo } from "react";
import useApi from "@/hooks/useApi";

// Lightweight hook for feature metadata (more efficient than useFeaturesList)
export function useFeaturesNames({
  includeDefaultValue = false,
}: { includeDefaultValue?: boolean } = {}) {
  const url = includeDefaultValue
    ? "/features/names?defaultValue=1"
    : "/features/names";
  const { data, error, mutate } = useApi<{ features: FeatureMetaInfo[] }>(url);

  const features = useMemo(() => {
    return data?.features || [];
  }, [data]);

  return {
    features,
    loading: !data && !error,
    error,
    mutate,
  };
}
