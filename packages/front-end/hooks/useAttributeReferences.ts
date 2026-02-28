import useSWR from "swr";
import { useAuth } from "@/services/auth";

export type AttributeFeatureRef = {
  id: string;
  name: string;
  project?: string;
};
export type AttributeExperimentRef = {
  id: string;
  name: string;
  project?: string;
  projects?: string[];
};
export type AttributeSavedGroupRef = {
  id: string;
  groupName: string;
  projects?: string[];
};

export type AttributeRefEntry = {
  features: AttributeFeatureRef[];
  experiments: AttributeExperimentRef[];
  savedGroups: AttributeSavedGroupRef[];
};

// Fetches features, experiments, and condition groups that reference each attribute key.
// Pass all attribute keys at once; the result is a map keyed by attribute property name.
export function useAttributeReferences(attributeKeys: string[]): {
  references: Record<string, AttributeRefEntry> | null;
  loading: boolean;
} {
  const { apiCall, orgId } = useAuth();

  const sortedKeys = [...attributeKeys].sort();
  const idsParam = sortedKeys.join(",");
  const path = idsParam
    ? `/attribute/references?ids=${encodeURIComponent(idsParam)}`
    : null;
  const key = path && orgId ? `${orgId}::${path}` : null;

  const { data, isLoading } = useSWR<
    { references: Record<string, AttributeRefEntry> },
    Error
  >(key, () => apiCall(path!, { method: "GET" }), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  return {
    references: data?.references ?? null,
    loading: isLoading,
  };
}
