import { FeatureMetaInfo } from "shared/types/feature";
import useApi from "@/hooks/useApi";

interface FeaturesNamesResponse {
  status: 200;
  features: FeatureMetaInfo[];
}

/**
 * Lightweight hook to fetch feature metadata for dropdowns.
 * Much more efficient than useFeaturesList as it only returns minimal data.
 * Use this for prerequisite selection dropdowns instead of full feature objects.
 */
export function useFeaturesNames() {
  const { data, error, mutate } =
    useApi<FeaturesNamesResponse>("/features/names");

  return {
    features: data?.features || [],
    loading: !data && !error,
    error,
    mutate,
  };
}
