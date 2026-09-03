import { useEffect, useMemo } from "react";
import { UseFormReturn, FieldValues } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import {
  getFeatureBaseConfigKey,
  getConfigSubtree,
  ensureConfigBacking,
} from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";

// Config-backing context for a feature's rule value editors. A feature is
// "config-backed" when its default value serves a config; each rule/variation
// value is then a sparse patch over that config, and may re-point to any config
// in the default's lineage subtree. Shared by the experiment-ref, MAB, and
// contextual-bandit-ref rule editors so their config-backed value UI stays
// consistent (which config keys are offered, and whether backing is locked on).
// `feature` may be undefined while it is still loading (e.g. the linked-flag
// modals fetch the selected feature async) — treated as not config-backed.
export function useConfigBacking(feature: FeatureInterface | undefined): {
  defaultConfigKey: string | null;
  isConfigBacked: boolean;
  configBackingOptionKeys: string[] | undefined;
} {
  const { configs } = useDefinitions();
  const defaultConfigKey = feature ? getFeatureBaseConfigKey(feature) : null;
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

// When a rule's feature is config-backed, its per-variation values must be sparse
// patches seeded with the backing. Forces `sparse` on and normalizes each
// variation value once the backing is known. Shared by the experiment-ref and
// MAB rule editors (both react-hook-form with a `variations` array + `sparse`).
export function useSeedConfigBackedVariations(
  form: UseFormReturn<FieldValues>,
  {
    isConfigBacked,
    defaultConfigKey,
  }: { isConfigBacked: boolean; defaultConfigKey: string | null },
): void {
  useEffect(() => {
    if (!isConfigBacked || !defaultConfigKey) return;
    if (!form.watch("sparse")) form.setValue("sparse", true);
    const vars = (form.getValues("variations") as { value: string }[]) || [];
    vars.forEach((v, i) => {
      const normalized = ensureConfigBacking(v.value, defaultConfigKey);
      if (normalized !== v.value) {
        form.setValue(`variations.${i}.value`, normalized);
      }
    });
    // Re-run only when the backing config changes; `form` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigBacked, defaultConfigKey]);
}
