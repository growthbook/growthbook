import { FeatureMetaInfo } from "shared/types/feature";
import useApi from "@/hooks/useApi";

export function useFeatureMetaInfo({
  project,
  includeArchived = false,
}: {
  project?: string;
  includeArchived?: boolean;
} = {}): {
  features: FeatureMetaInfo[];
  loading: boolean;
} {
  const params = new URLSearchParams();
  if (project) params.set("project", project);
  if (includeArchived) params.set("includeArchived", "1");
  const qs = params.toString();

  const { data, loading } = useApi<{ features: FeatureMetaInfo[] }>(
    `/features/meta-info${qs ? `?${qs}` : ""}`,
  );

  return { features: data?.features ?? [], loading };
}
