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

export type ConfigFamilyFeatureRef = {
  id: string;
  name: string;
  project?: string;
  // The config backing the feature's default value (in this family), if any.
  defaultConfigKey: string | null;
  // Rule configs that differ from the default config.
  ruleConfigKeys: string[];
};

export type ConfigFamilyReferences = {
  familyKeys: string[];
  features: ConfigFamilyFeatureRef[];
};

// Features that reference any config in a config's lineage family (the config,
// its ancestors, and descendants). Cached for 5 minutes.
export function useConfigFamilyReferences(
  configId: string | null | undefined,
): {
  references: ConfigFamilyReferences | null;
  loading: boolean;
} {
  const { apiCall, orgId } = useAuth();
  const path = configId ? `/configs/${configId}/family-references` : null;
  const key = path && orgId ? `${orgId}::${path}` : null;

  const { data, isLoading } = useSWR<
    ConfigFamilyReferences & { status: 200 },
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

// Features/constants/configs that reference a given constant/config via
// `@const:key`. Cached for 5 minutes; `entity` selects the API base path.
export function useConstantReferences(
  constantId: string | null | undefined,
  entity: "constants" | "configs" = "constants",
): {
  references: ConstantReferences | null;
  loading: boolean;
  error: Error | null;
} {
  const { apiCall, orgId } = useAuth();
  const path = constantId ? `/${entity}/${constantId}/references` : null;
  const key = path && orgId ? `${orgId}::${path}` : null;

  const { data, isLoading, error } = useSWR<
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
    error: error ?? null,
  };
}
