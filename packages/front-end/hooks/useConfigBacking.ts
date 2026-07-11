import { useMemo } from "react";
import { FeatureInterface } from "shared/types/feature";
import { getFeatureBaseConfigKey, getConfigSubtree } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";

// Config-backing context for a feature's rule value editors. A feature is
// "config-backed" when its default value serves a config; each rule/variation
// value is then a sparse patch over that config, and may re-point to any config
// in the default's lineage subtree. Shared by the experiment-ref, MAB, and
// contextual-bandit-ref rule editors so their config-backed value UI stays
// consistent (which config keys are offered, and whether backing is locked on).
export function useConfigBacking(feature: FeatureInterface): {
  defaultConfigKey: string | null;
  isConfigBacked: boolean;
  configBackingOptionKeys: string[] | undefined;
} {
  const { configs } = useDefinitions();
  const defaultConfigKey = getFeatureBaseConfigKey(feature);
  const isConfigBacked = defaultConfigKey !== null;
  const configBackingOptionKeys = useMemo(
    () =>
      defaultConfigKey
        ? getConfigSubtree(defaultConfigKey, configs)
        : undefined,
    [defaultConfigKey, configs],
  );
  return { defaultConfigKey, isConfigBacked, configBackingOptionKeys };
}
