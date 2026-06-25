import useSWR from "swr";
import { useAuth } from "@/services/auth";

export type ConstantFeatureRef = {
  id: string;
  name?: string;
  project?: string;
};
export type ConstantConstantRef = {
  id: string;
  key: string;
  name: string;
  project?: string;
  // True when the referencing entity is a config (so the UI links to /configs).
  isConfig?: boolean;
};

export type ConstantReferences = {
  features: ConstantFeatureRef[];
  constants: ConstantConstantRef[];
};

// Features/constants/configs that reference a given constant/config via
// `@const:key`. Cached for 5 minutes; `entity` selects the API base path.
export function useConstantReferences(
  constantId: string | null | undefined,
  entity: "constants" | "configs" = "constants",
): {
  references: ConstantReferences | null;
  loading: boolean;
} {
  const { apiCall, orgId } = useAuth();
  const path = constantId ? `/${entity}/${constantId}/references` : null;
  const key = path && orgId ? `${orgId}::${path}` : null;

  const { data, isLoading } = useSWR<
    ConstantReferences & { status: 200 },
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
