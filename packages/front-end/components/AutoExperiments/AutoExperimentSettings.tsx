import { useState } from "react";
import { useFormContext } from "react-hook-form";
import {
  AUTO_EXPERIMENT_FEATURES,
  getAutoExperimentParentFeature,
  isAutoExperimentFeatureEnabled,
} from "shared/util";
import type { AutoExperimentFeature } from "shared/types/organization";
import { Box } from "@radix-ui/themes";
import Checkbox from "@/ui/Checkbox";
import useAutoExperiments from "@/hooks/useAutoExperiments";
import { UnsavedMark } from "@/components/GeneralSettings/SettingsGroup";
import { OrganizationSettingsWithMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import EnableAutoExperimentDialog, {
  AUTO_EXPERIMENT_COPY,
} from "./EnableAutoExperimentDialog";

// Each feature followed by the ones that depend on it.
const ORDERED_FEATURES = AUTO_EXPERIMENT_FEATURES.filter(
  (f) => !getAutoExperimentParentFeature(f),
).flatMap((parent) => [
  parent,
  ...AUTO_EXPERIMENT_FEATURES.filter(
    (f) => getAutoExperimentParentFeature(f) === parent,
  ),
]);

// Saved with the rest of the settings form. Turning one on asks first.
export default function AutoExperimentSettings() {
  const { mode, canManage, isEnabled: isSaved } = useAutoExperiments();
  const { watch, setValue } =
    useFormContext<OrganizationSettingsWithMetricDefaults>();
  const autoExperiments = watch("autoExperiments");
  const isEnabled = (feature: AutoExperimentFeature) =>
    isAutoExperimentFeatureEnabled({ autoExperiments }, feature, mode);
  const [enabling, setEnabling] = useState<AutoExperimentFeature | null>(null);

  const set = (feature: AutoExperimentFeature, enabled: boolean) => {
    const parent = getAutoExperimentParentFeature(feature);
    setValue("autoExperiments", {
      ...autoExperiments,
      [feature]: enabled,
      ...(enabled && parent ? { [parent]: true } : {}),
      // What depends on it goes off with it, as the server would do.
      ...(!enabled
        ? Object.fromEntries(
            AUTO_EXPERIMENT_FEATURES.filter(
              (f) => getAutoExperimentParentFeature(f) === feature,
            ).map((f) => [f, false]),
          )
        : {}),
    });
  };

  return (
    <>
      {ORDERED_FEATURES.map((feature) => {
        const parent = getAutoExperimentParentFeature(feature);
        if (parent && !isEnabled(parent)) return null;
        // Judged on the saved value, so a queued uncheck can still be undone.
        const instanceBlocks = mode !== "allowed" && !isSaved(feature);
        return (
          <Box key={feature} pl={parent ? "5" : "0"}>
            <UnsavedMark name={`autoExperiments.${feature}`}>
              <Checkbox
                id={`toggle-autoExperiments-${feature}`}
                label={AUTO_EXPERIMENT_COPY[feature].name}
                disabled={!canManage || instanceBlocks}
                disabledMessage={
                  canManage
                    ? "Set the ALLOW_AUTO_EXPERIMENTS environment variable to true to allow enabling this"
                    : "Only admins can change this setting"
                }
                value={isEnabled(feature)}
                setValue={(v) =>
                  v ? setEnabling(feature) : set(feature, false)
                }
              />
            </UnsavedMark>
          </Box>
        );
      })}
      {enabling ? (
        <EnableAutoExperimentDialog
          feature={enabling}
          onConfirm={() => set(enabling, true)}
          close={() => setEnabling(null)}
        />
      ) : null}
    </>
  );
}
