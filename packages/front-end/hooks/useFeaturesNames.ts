import useApi from "@/hooks/useApi";

export interface FeatureName {
  id: string;
  project: string;
  valueType: string;
}

interface FeaturesNamesResponse {
  status: 200;
  features: FeatureName[];
}

/**
 * Lightweight hook to fetch feature names for dropdowns.
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
