import useSWR from "swr";
import { useAuth } from "@/services/auth";

export type SavedGroupRef = { id: string; name: string; project?: string };
export type ExperimentRef = {
  id: string;
  name: string;
  project?: string;
  projects?: string[];
};
export type SavedGroupGroupRef = {
  id: string;
  groupName: string;
  projects?: string[];
};

export type SavedGroupReferences = {
  features: SavedGroupRef[];
  experiments: ExperimentRef[];
  savedGroups: SavedGroupGroupRef[];
};

// Features, experiments, and saved groups that directly reference a given saved group
// (plus one level of saved-group chaining). Cached for 5 minutes to avoid duplicate
// fetches when the delete modal mounts shortly after the detail page.
export function useSavedGroupReferences(
  savedGroupId: string | null | undefined,
): {
  references: SavedGroupReferences | null;
  loading: boolean;
} {
  const { apiCall, orgId } = useAuth();
  const path = savedGroupId ? `/saved-groups/${savedGroupId}/references` : null;
  const key = path && orgId ? `${orgId}::${path}` : null;

  const { data, isLoading } = useSWR<
    SavedGroupReferences & { status: 200 },
    Error
  >(key, () => apiCall(path!, { method: "GET" }), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5 * 60_000,
  });

  return {
    references: data ?? null,
    loading: isLoading,
  };
}
