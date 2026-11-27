import { useState } from "react";
import { useFormContext } from "react-hook-form";
import {
  AUTO_EXPERIMENT_FEATURES,
  getAutoExperimentParentFeature,
  isAutoExperimentFeatureEnabled,
} from "shared/util";
import type { AutoExperimentUsage } from "shared/util";
import type { AutoExperimentFeature } from "shared/types/organization";
import { Box } from "@radix-ui/themes";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";
import useAutoExperiments, {
  AUTO_EXPERIMENTS_ENV_HINT,
} from "@/hooks/useAutoExperiments";
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

const MAX_LISTED = 10;

type Serving = AutoExperimentUsage[AutoExperimentFeature];

function DisableAutoExperimentDialog({
  feature,
  serving,
  oneWay,
  onConfirm,
  close,
}: {
  feature: AutoExperimentFeature;
  serving: Serving;
  // The instance won't let it be turned back on.
  oneWay: boolean;
  onConfirm: () => void;
  close: () => void;
}) {
  const copy = AUTO_EXPERIMENT_COPY[feature];
  // `total` also counts what this admin can't read, which has no name here.
  const listed = serving.items.slice(0, MAX_LISTED);
  const more = serving.total - listed.length;
  return (
    <ConfirmDialog
      title={copy.disableTitle}
      content={
        <>
          {serving.total
            ? `${serving.total} live experiment${serving.total === 1 ? "" : "s"} will stop serving ${copy.blocked} when you save.`
            : null}
          {/* Spans: the dialog renders its content inside a paragraph. */}
          {listed.length ? (
            <Box as="span" display="block" mt="3">
              {listed.map((item) => (
                <Box as="span" display="block" key={`${item.kind}:${item.id}`}>
                  {/* A new tab: the dialog opens over a form with unsaved changes. */}
                  <Link
                    href={
                      item.kind === "experiment"
                        ? `/experiment/${item.id}`
                        : `/contextual-bandit/${item.id}`
                    }
                    external
                  >
                    {item.name}
                  </Link>
                  {item.rollout ? " (temporary rollout)" : ""}
                </Box>
              ))}
              {more > 0 ? (
                <Box as="span" display="block">
                  and {more} more
                </Box>
              ) : null}
            </Box>
          ) : null}
          {oneWay ? (
            <Box as="span" display="block" mt={serving.total ? "3" : "0"}>
              Once saved, this can&apos;t be enabled again unless the
              ALLOW_AUTO_EXPERIMENTS environment variable is set to true.
            </Box>
          ) : null}
        </>
      }
      yesText="Disable"
      onConfirm={() => {
        onConfirm();
        close();
      }}
      onCancel={close}
    />
  );
}

// Saved with the rest of the settings form. Changing a saved one asks first.
export default function AutoExperimentSettings() {
  const { mode, canManage, isEnabled: isSaved } = useAutoExperiments();
  const { apiCall } = useAuth();
  const { watch, getValues, setValue } =
    useFormContext<OrganizationSettingsWithMetricDefaults>();
  const autoExperiments = watch("autoExperiments");
  const isEnabled = (feature: AutoExperimentFeature) =>
    isAutoExperimentFeatureEnabled({ autoExperiments }, feature, mode);
  const [enabling, setEnabling] = useState<AutoExperimentFeature | null>(null);
  const [disabling, setDisabling] = useState<{
    feature: AutoExperimentFeature;
    serving: Serving;
  } | null>(null);

  const set = (feature: AutoExperimentFeature, enabled: boolean) => {
    const parent = getAutoExperimentParentFeature(feature);
    setValue("autoExperiments", {
      // Read now: `disable` calls this after waiting on a request.
      ...getValues("autoExperiments"),
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

  // Says what the setting is serving before it goes off. Only a courtesy:
  // turning one off has to work even when that can't be read. Always asks
  // when the instance won't let it be turned back on.
  const disable = async (feature: AutoExperimentFeature) => {
    let serving: Serving = { total: 0, items: [] };
    try {
      const { usage } = await apiCall<{ usage: AutoExperimentUsage }>(
        "/organization/auto-experiments/usage",
      );
      serving = usage[feature];
    } catch (e) {
      console.error(e);
    }
    if (serving.total || mode !== "allowed") setDisabling({ feature, serving });
    else set(feature, false);
  };

  const toggle = (
    feature: AutoExperimentFeature,
    saved: boolean,
    enabled: boolean,
  ) => {
    // Going back to the saved value only undoes a queued change.
    if (enabled === saved) set(feature, enabled);
    else if (enabled) setEnabling(feature);
    else void disable(feature);
  };

  return (
    <>
      {ORDERED_FEATURES.map((feature) => {
        const parent = getAutoExperimentParentFeature(feature);
        if (parent && !isEnabled(parent)) return null;
        // Judged on the saved value, so a queued uncheck can still be undone.
        const saved = isSaved(feature);
        const instanceBlocks = mode !== "allowed" && !saved;
        return (
          <Box key={feature} pl={parent ? "5" : "0"}>
            <UnsavedMark name={`autoExperiments.${feature}`}>
              <Checkbox
                id={`toggle-autoExperiments-${feature}`}
                label={AUTO_EXPERIMENT_COPY[feature].name}
                disabled={!canManage || instanceBlocks}
                disabledMessage={
                  canManage
                    ? AUTO_EXPERIMENTS_ENV_HINT
                    : "Only admins can change this setting"
                }
                value={isEnabled(feature)}
                setValue={(v) => toggle(feature, saved, v)}
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
      {disabling ? (
        <DisableAutoExperimentDialog
          feature={disabling.feature}
          serving={disabling.serving}
          oneWay={mode !== "allowed"}
          onConfirm={() => set(disabling.feature, false)}
          close={() => setDisabling(null)}
        />
      ) : null}
    </>
  );
}
