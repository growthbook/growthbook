import { FC, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  MetricOverride,
} from "back-end/types/experiment";
import cloneDeep from "lodash/cloneDeep";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
} from "shared/constants";
import { OrganizationSettings } from "back-end/types/organization";
import { ExperimentMetricMap } from "shared/experiments";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Modal from "@/components/Modal";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import track from "@/services/track";
import Callout from "@/components/Radix/Callout";
import PremiumCallout from "../Radix/PremiumCallout";
import MetricsOverridesSelector from "./MetricsOverridesSelector";
import { MetricsSelectorTooltip } from "./MetricsSelector";
import MetricSelector from "./MetricSelector";
import ExperimentMetricsSelector from "./ExperimentMetricsSelector";

export interface EditMetricsFormInterface {
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  activationMetric: string;
  metricOverrides: MetricOverride[];
}

export function getDefaultMetricOverridesFormValue(
  overrides: MetricOverride[],
  metricMap: ExperimentMetricMap,
  settings: OrganizationSettings
) {
  const defaultMetricOverrides = cloneDeep(overrides);
  for (let i = 0; i < defaultMetricOverrides.length; i++) {
    for (const key in defaultMetricOverrides[i]) {
      // fix fields with percentage values
      if (
        [
          "winRisk",
          "loseRisk",
          "maxPercentChange",
          "minPercentChange",
          "targetMDE",
        ].includes(key)
      ) {
        defaultMetricOverrides[i][key] *= 100;
      }
    }
    if (defaultMetricOverrides[i].regressionAdjustmentDays === undefined) {
      const metricDefinition = metricMap.get(defaultMetricOverrides[i].id);
      if (metricDefinition?.regressionAdjustmentOverride) {
        defaultMetricOverrides[i].regressionAdjustmentDays =
          metricDefinition.regressionAdjustmentDays;
      } else {
        defaultMetricOverrides[i].regressionAdjustmentDays =
          settings.regressionAdjustmentDays ??
          DEFAULT_REGRESSION_ADJUSTMENT_DAYS;
      }
    }
    if (
      isNaN(defaultMetricOverrides[i].properPriorMean ?? NaN) ||
      isNaN(defaultMetricOverrides[i].properPriorMean ?? NaN)
    ) {
      const metricDefinition = metricMap.get(defaultMetricOverrides[i].id);
      const defaultValues = metricDefinition?.priorSettings?.override
        ? {
            proper: metricDefinition.priorSettings.proper,
            mean: metricDefinition.priorSettings.mean,
            stddev: metricDefinition.priorSettings.stddev,
          }
        : {
            proper: settings.metricDefaults?.priorSettings?.proper ?? false,
            mean: settings.metricDefaults?.priorSettings?.mean ?? 0,
            stddev:
              settings.metricDefaults?.priorSettings?.stddev ??
              DEFAULT_PROPER_PRIOR_STDDEV,
          };

      defaultMetricOverrides[i].properPriorEnabled =
        defaultMetricOverrides[i].properPriorEnabled ?? defaultValues.proper;
      defaultMetricOverrides[i].properPriorMean =
        defaultMetricOverrides[i].properPriorMean ?? defaultValues.mean;
      defaultMetricOverrides[i].properPriorStdDev =
        defaultMetricOverrides[i].properPriorStdDev ?? defaultValues.stddev;
    }
  }
  return defaultMetricOverrides;
}

export function fixMetricOverridesBeforeSaving(overrides: MetricOverride[]) {
  for (let i = 0; i < overrides.length; i++) {
    for (const key in overrides[i]) {
      if (key === "id") continue;
      const v = overrides[i][key];
      // remove nullish values from payload
      if (v === undefined || v === null || (key !== "windowType" && isNaN(v))) {
        delete overrides[i][key];
        continue;
      }
      // fix fields with percentage values
      if (
        [
          "winRisk",
          "loseRisk",
          "maxPercentChange",
          "minPercentChange",
          "targetMDE",
        ].includes(key)
      ) {
        overrides[i][key] = v / 100;
      }
    }
  }
}

const EditMetricsForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
  source?: string;
}> = ({ experiment, cancel, mutate, source }) => {
  const [upgradeModal, setUpgradeModal] = useState(false);
  const [hasMetricOverrideRiskError, setHasMetricOverrideRiskError] = useState(
    false
  );
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  const hasOverrideMetricsFeature = hasCommercialFeature("override-metrics");

  const { metricMap } = useDefinitions();

  const defaultMetricOverrides = getDefaultMetricOverridesFormValue(
    experiment.metricOverrides || [],
    metricMap,
    settings
  );

  const isBandit = experiment.type === "multi-armed-bandit";

  const form = useForm<EditMetricsFormInterface>({
    defaultValues: {
      goalMetrics: experiment.goalMetrics || [],
      secondaryMetrics: experiment.secondaryMetrics || [],
      guardrailMetrics: experiment.guardrailMetrics || [],
      activationMetric: experiment.activationMetric || "",
      metricOverrides: defaultMetricOverrides,
    },
  });

  const [showOverrides, setShowOverrides] = useState(
    !!defaultMetricOverrides?.length
  );

  const { apiCall } = useAuth();
  useEffect(() => {
    track("edit-metric-form-open");
  });
  if (upgradeModal) {
    return (
      <UpgradeModal
        close={() => setUpgradeModal(false)}
        source="override-metrics"
        commercialFeature="override-metrics"
      />
    );
  }

  return (
    <Modal
      trackingEventModalType="edit-metrics-form"
      trackingEventModalSource={source}
      autoFocusSelector=""
      header="Edit Metrics"
      size="lg"
      open={true}
      close={cancel}
      ctaEnabled={!hasMetricOverrideRiskError}
      submit={form.handleSubmit(async (value) => {
        const payload = cloneDeep<EditMetricsFormInterface>(value);
        fixMetricOverridesBeforeSaving(value.metricOverrides || []);
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        mutate();
      })}
      cta="Save"
    >
      <ExperimentMetricsSelector
        datasource={experiment.datasource}
        exposureQueryId={experiment.exposureQueryId}
        project={experiment.project}
        goalMetrics={form.watch("goalMetrics")}
        secondaryMetrics={form.watch("secondaryMetrics")}
        guardrailMetrics={form.watch("guardrailMetrics")}
        setGoalMetrics={
          !(isBandit && experiment.status === "running")
            ? (goalMetrics) => form.setValue("goalMetrics", goalMetrics)
            : undefined
        }
        setSecondaryMetrics={(secondaryMetrics) =>
          form.setValue("secondaryMetrics", secondaryMetrics)
        }
        setGuardrailMetrics={(guardrailMetrics) =>
          form.setValue("guardrailMetrics", guardrailMetrics)
        }
      />
      {/* If the org has the feature, we render a callout within MetricsSelector */}
      {!hasCommercialFeature("metric-groups") ? (
        <PremiumCallout
          commercialFeature="metric-groups"
          dismissable={true}
          id="metrics-list-metric-group-promo"
          docSection="metricGroups"
          mb="4"
        >
          <strong>Metric Groups</strong> make it possible to reuse sets of
          metrics in your experiments.
        </PremiumCallout>
      ) : null}

      {!(isBandit && experiment.status === "running") && (
        <>
          <div className="form-group">
            <label className="font-weight-bold mb-1">Activation Metric</label>
            <div className="mb-1">
              <span className="font-italic">
                Users must convert on this metric before being included.{" "}
              </span>
              <MetricsSelectorTooltip onlyBinomial={true} />
            </div>
            <MetricSelector
              initialOption="None"
              value={form.watch("activationMetric")}
              exposureQueryId={experiment.exposureQueryId}
              onChange={(metric) => form.setValue("activationMetric", metric)}
              datasource={experiment.datasource}
              project={experiment.project}
              onlyBinomial
              includeFacts={true}
            />
          </div>

          {hasOverrideMetricsFeature ? (
            <div>
              {showOverrides ? (
                <div className="form-group mb-2">
                  <label>Metric Overrides</label>
                  <Callout status="warning" mb="2">
                    <strong>Deprecated</strong>: Use Metric Variants instead.
                  </Callout>
                  <MetricsOverridesSelector
                    experiment={experiment}
                    form={form}
                    disabled={!hasOverrideMetricsFeature}
                    setHasMetricOverrideRiskError={(v: boolean) =>
                      setHasMetricOverrideRiskError(v)
                    }
                  />
                </div>
              ) : (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowOverrides(true);
                  }}
                >
                  Show metric overrides (deprecated)
                </a>
              )}
            </div>
          ) : null}
        </>
      )}
    </Modal>
  );
};

export default EditMetricsForm;
