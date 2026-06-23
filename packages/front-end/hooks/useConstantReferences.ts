import useSWR from "swr";
import { useAuth } from "@/services/auth";

export type ConstantFeatureRef = { id: string; project?: string };
export type ConstantConstantRef = {
  id: string;
  key: string;
  name: string;
  project?: string;
};

export type ConstantReferences = {
  features: ConstantFeatureRef[];
  constants: ConstantConstantRef[];
};

// Features and other constants that reference a given constant via `@const:key`.
// Cached for 5 minutes to avoid duplicate fetches when the references modal
// mounts shortly after the detail page.
export function useConstantReferences(constantId: string | null | undefined): {
  references: ConstantReferences | null;
  loading: boolean;
} {
  const { apiCall, orgId } = useAuth();
  const path = constantId ? `/constants/${constantId}/references` : null;
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
