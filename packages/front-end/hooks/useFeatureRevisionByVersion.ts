import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import useApi from "@/hooks/useApi";

// One full feature revision by version: from the page's lazy cache when it
// holds it, otherwise fetched on its own. `undefined` version fetches nothing.
export function useFeatureRevisionByVersion(
  featureId: string,
  version: number | undefined,
  cached: FeatureRevisionInterface[],
): FeatureRevisionInterface | undefined {
  const fromCache =
    version === undefined
      ? undefined
      : cached.find((r) => r.version === version);
  const { data } = useApi<{
    status: 200;
    revisions: FeatureRevisionInterface[];
  }>(`/feature/${featureId}/revisions?versions=${version}`, {
    shouldRun: () => version !== undefined && !fromCache,
  });
  return fromCache ?? data?.revisions?.find((r) => r.version === version);
}
