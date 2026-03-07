import { FeatureMetaInfo } from "shared/types/feature";
import useApi from "@/hooks/useApi";

// Fetches defaultValue for a specific set of feature IDs.
export function useFeatureDefaultValues(featureIds: string[]): {
  defaultValues: Record<string, string>;
  isLoading: boolean;
} {
  const sortedIds = [...featureIds].sort();
  const idsParam = sortedIds.join(",");
  const endpoint = `/features/meta-info?ids=${encodeURIComponent(idsParam)}&defaultValue=1`;

  const { data, isLoading } = useApi<{ features: FeatureMetaInfo[] }>(
    endpoint,
    {
      shouldRun: () => idsParam.length > 0,
    },
  );

  const defaultValues: Record<string, string> = {};
  if (data?.features) {
    for (const f of data.features) {
      if (f.defaultValue !== undefined) {
        defaultValues[f.id] = f.defaultValue;
      }
    }
  }

  return { defaultValues, isLoading };
}
