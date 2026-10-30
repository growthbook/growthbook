import { useState } from "react";
import { useForm } from "react-hook-form";
import { isEqual } from "lodash";
import {
  DecisionFrameworkMetricOverrides,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { expandMetricGroups } from "shared/experiments";
import { MetricOverride } from "shared/validators";
import { StatsEngine } from "shared/types/stats";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import Callout from "@/ui/Callout";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import { decimalToPercent } from "@/services/utils";
import {
  getOverridesBlockedReason,
  mergeTargetMDEs,
  pruneMetricOverrides,
  withoutDeprecatedOverrideFields,
} from "@/services/metricOverrides";
import MetricsOverridesSelector from "./MetricsOverridesSelector";
import {
  EditMetricsFormInterface,
  fixMetricOverridesBeforeSaving,
  getDefaultMetricOverridesFormValue,
} from "./EditMetricsForm";

/** Confirming stages the overrides on the page's draft rather than saving them. */
export default function MetricOverridesModal({
  experiment,
  datasource,
  statsEngine,
  metrics,
  overrides,
  focusMetricIds,
  targetMDEOverrides,
  close,
  stageChanges,
}: {
  experiment: ExperimentInterfaceStringDates;
  // The page's current values for these, which may be unsaved.
  datasource: string;
  statsEngine: StatsEngine;
  metrics: Pick<
    EditMetricsFormInterface,
    "goalMetrics" | "secondaryMetrics" | "guardrailMetrics" | "activationMetric"
  >;
  overrides: MetricOverride[];
  /** With just one, that metric's card opens focused, added if it has none. */
  focusMetricIds?: string[];
  /** Given where the decision framework runs: goal metrics' target MDEs. */
  targetMDEOverrides?: DecisionFrameworkMetricOverrides[];
  close: () => void;
  stageChanges: (
    // Each is null where it's left as it was.
    overrides: MetricOverride[] | null,
    // Every metric's target MDE override, when goals' are editable here.
    targetMDEOverrides: DecisionFrameworkMetricOverrides[] | null,
  ) => void;
}) {
  const { getExperimentMetricById, getDatasourceById, metricGroups } =
    useDefinitions();
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  // Incremental refresh reuses earlier results, which an override would
  // silently contradict.
  const incremental = getIsExperimentIncludedInIncrementalRefresh(
    getDatasourceById(datasource) ?? undefined,
    experiment.id,
    experiment.type,
  );
  const hasFeature = hasCommercialFeature("override-metrics");
  const canOverride = hasFeature && !incremental;
  // A target MDE only changes how finished results are judged, so it stays
  // editable where nothing else is.
  const onlyTargetMDE = !canOverride && !!targetMDEOverrides;
  // What stays locked, beyond the goals' target MDEs.
  const blockedReason = getOverridesBlockedReason({
    hasFeature,
    incremental,
    targetMDEsEditable: !!targetMDEOverrides,
    goal: false,
  });

  const goalIds = targetMDEOverrides
    ? expandMetricGroups(metrics.goalMetrics, metricGroups)
    : [];
  const goalTargetMDEs = (targetMDEOverrides ?? []).flatMap(
    ({ id, targetMDE }) =>
      targetMDE !== undefined && goalIds.includes(id)
        ? [{ id, targetMDE }]
        : [],
  );
  const focusId = focusMetricIds?.length === 1 ? focusMetricIds[0] : null;
  // Target MDEs live elsewhere, so a goal metric overriding only that still
  // needs its card, as does a metric opened to add its first override.
  const cardIds = [
    ...goalTargetMDEs.map((o) => o.id),
    ...(focusId && (canOverride || (onlyTargetMDE && goalIds.includes(focusId)))
      ? [focusId]
      : []),
  ];
  const withCards = [
    ...overrides,
    ...[...new Set(cardIds)]
      .filter((id) => !overrides.some((m) => m.id === id))
      .map((id) => ({ id })),
  ];

  const [targetId] = useState(() =>
    focusId && withCards.some((o) => o.id === focusId) ? focusId : null,
  );

  const form = useForm<
    EditMetricsFormInterface & {
      // Percentages, by goal metric; unset follows the metric.
      targetMDEs: Record<string, number | undefined>;
    }
  >({
    defaultValues: {
      ...metrics,
      metricOverrides: getDefaultMetricOverridesFormValue(
        withCards,
        getExperimentMetricById,
        settings,
      ),
      targetMDEs: Object.fromEntries(
        goalTargetMDEs.map((o) => [o.id, decimalToPercent(o.targetMDE, 11)]),
      ),
    },
  });

  return (
    <ModalStandard
      onOpenAutoFocus={(e) => {
        const content = e.currentTarget as HTMLElement;
        const card = targetId
          ? content.querySelector<HTMLElement>(
              `[data-override-metric="${CSS.escape(targetId)}"]`,
            )
          : null;
        // Its first setting, past the header's remove link.
        const field = card?.querySelector<HTMLElement>(
          "tbody button[role='combobox'], tbody input:not([type='hidden'])",
        );
        e.preventDefault();
        if (!field) return content.focus();
        field.focus();
        card?.scrollIntoView({ block: "nearest" });
      }}
      open={true}
      close={close}
      trackingEventModalType="edit-metric-overrides"
      header="Metric Overrides"
      subheader="Change how individual metrics are analyzed in this experiment. Anything you don't override follows the metric's own settings."
      cta="Confirm"
      ctaEnabled={canOverride || onlyTargetMDE}
      size="lg"
      submit={validatedSubmit(form, async (value) => {
        let next: MetricOverride[] | null = null;
        if (canOverride) {
          const edited = withoutDeprecatedOverrideFields(value.metricOverrides);
          fixMetricOverridesBeforeSaving(edited);
          const pruned = pruneMetricOverrides(edited);
          // Opening and confirming isn't an edit, whatever the saved
          // overrides' shape.
          if (
            !isEqual(
              pruned,
              pruneMetricOverrides(withoutDeprecatedOverrideFields(overrides)),
            )
          ) {
            next = pruned;
          }
        }
        const nextTargetMDEs = targetMDEOverrides
          ? mergeTargetMDEs(targetMDEOverrides, goalIds, value.targetMDEs)
          : null;
        stageChanges(
          next,
          nextTargetMDEs && !isEqual(nextTargetMDEs, targetMDEOverrides)
            ? nextTargetMDEs
            : null,
        );
      })}
    >
      {blockedReason ? (
        <Callout status="info" mb="3">
          {blockedReason}
        </Callout>
      ) : null}
      <MetricsOverridesSelector
        experiment={experiment}
        form={form}
        disabled={!canOverride && !onlyTargetMDE}
        onlyTargetMDE={onlyTargetMDE}
        datasource={datasource}
        statsEngine={statsEngine}
        highlightMetricId={targetId}
        targetMDEGoalIds={targetMDEOverrides ? goalIds : undefined}
      />
    </ModalStandard>
  );
}
