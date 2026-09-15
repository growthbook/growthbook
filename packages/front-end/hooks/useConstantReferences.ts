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
  error: Error | null;
} {
  const { apiCall, orgId } = useAuth();
  const path = configId ? `/configs/${configId}/family-references` : null;
  const key = path && orgId ? `${orgId}::${path}` : null;

  const { data, isLoading, error } = useSWR<
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
    error: error ?? null,
  };
}

export type ConfigKeyImplementation = {
  featureId: string;
  project?: string;
  location: "defaultValue" | "rule";
  ruleType?: string;
  ruleId?: string;
  experimentId?: string;
  // Set instead of `experimentId` for a contextual-bandit-ref rule; the bandit's
  // name/status are resolved into experimentName/experimentStatus (shared vocab).
  contextualBanditId?: string;
  experimentName?: string;
  experimentStatus?: string;
  variationId?: string;
  // The family config this value extends.
  configKey: string;
  // The backing config's relationship to the config being viewed.
  relation?: "self" | "ancestor" | "descendant" | "other";
  // The config field keys this value overrides.
  keys: string[];
  // The raw override values (the value's patch, minus `$extends`), keyed by
  // config field. One entry per variation for experiment/bandit refs.
  patch?: Record<string, unknown>;
  // Whether the linkage is published or only in an open feature draft.
  state: "live" | "draft";
  revisionVersion?: number;
};

export type ConfigKeyUsage = {
  familyKeys: string[];
  implementations: ConfigKeyImplementation[];
};

// Feature rules and default values overriding each key across a config's lineage
// family — for the detail-page per-key usage counts and drill-down. Cached for 5
// minutes.
export function useConfigKeyUsage(configId: string | null | undefined): {
  usage: ConfigKeyUsage | null;
  loading: boolean;
  error: Error | null;
} {
  const { apiCall, orgId } = useAuth();
  const path = configId ? `/configs/${configId}/key-usage` : null;
  const key = path && orgId ? `${orgId}::${path}` : null;

  const { data, isLoading, error } = useSWR<
    ConfigKeyUsage & { status: 200 },
    Error
  >(key, () => apiCall(path!, { method: "GET" }), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5 * 60_000,
  });

  return {
    usage: data ?? null,
    loading: isLoading,
    error: error ?? null,
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
