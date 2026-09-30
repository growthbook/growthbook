import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  DecisionFrameworkMetricOverrides,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { expandMetricGroups } from "shared/experiments";
import { MetricOverride } from "shared/validators";
import { StatsEngine } from "shared/types/stats";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
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
  /** With just one, that metric's card opens focused. */
  focusMetricIds?: string[];
  /** Given where the decision framework runs: goal metrics' target MDEs. */
  targetMDEOverrides?: DecisionFrameworkMetricOverrides[];
  close: () => void;
  stageChanges: (
    overrides: MetricOverride[],
    // Every goal metric's target MDE override, when they're editable here.
    targetMDEOverrides?: DecisionFrameworkMetricOverrides[],
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

  const goalIds = targetMDEOverrides
    ? expandMetricGroups(metrics.goalMetrics, metricGroups)
    : [];
  // Target MDEs live elsewhere, so a goal metric overriding only that still
  // needs its card.
  const withCards = [
    ...overrides,
    ...(targetMDEOverrides ?? [])
      .filter(
        (o) =>
          o.targetMDE !== undefined &&
          goalIds.includes(o.id) &&
          !overrides.some((m) => m.id === o.id),
      )
      .map((o) => ({ id: o.id })),
  ];

  const [targetId] = useState(() => {
    const id = focusMetricIds?.length === 1 ? focusMetricIds[0] : null;
    return id && withCards.some((o) => o.id === id) ? id : null;
  });

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
        (targetMDEOverrides ?? [])
          .filter((o) => o.targetMDE !== undefined && goalIds.includes(o.id))
          .map((o) => [o.id, Number(((o.targetMDE ?? 0) * 100).toFixed(9))]),
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
      ctaEnabled={canOverride}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        const next = value.metricOverrides ?? [];
        fixMetricOverridesBeforeSaving(next);
        stageChanges(
          next,
          targetMDEOverrides
            ? goalIds.flatMap((id) => {
                const percent = value.targetMDEs?.[id];
                return percent === undefined || Number.isNaN(percent)
                  ? []
                  : [{ id, targetMDE: percent / 100 }];
              })
            : undefined,
        );
      })}
    >
      {!hasFeature ? (
        <Callout status="info" mb="3">
          Overriding metrics is available on paid plans.
        </Callout>
      ) : incremental ? (
        <Callout status="info" mb="3">
          Metric overrides aren&apos;t available for experiments using
          incremental refresh.
        </Callout>
      ) : null}
      <MetricsOverridesSelector
        experiment={experiment}
        form={form}
        disabled={!canOverride}
        datasource={datasource}
        statsEngine={statsEngine}
        highlightMetricId={targetId}
        targetMDEGoalIds={targetMDEOverrides ? goalIds : undefined}
      />
    </ModalStandard>
  );
}
