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

export type ContextualBanditRef = {
  id: string;
  name: string;
  project?: string;
};

export type InterleavingRef = {
  id: string;
  name: string;
  project?: string;
};

export type SavedGroupReferences = {
  features: SavedGroupRef[];
  experiments: ExperimentRef[];
  contextualBandits: ContextualBanditRef[];
  interleavings: InterleavingRef[];
  savedGroups: SavedGroupGroupRef[];
};

export function totalSavedGroupReferences(
  refs: SavedGroupReferences | null | undefined,
): number {
  if (!refs) return 0;
  return (
    refs.features.length +
    refs.experiments.length +
    refs.contextualBandits.length +
    refs.interleavings.length +
    refs.savedGroups.length
  );
}

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
