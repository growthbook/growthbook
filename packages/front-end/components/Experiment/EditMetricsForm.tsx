import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  MetricOverride,
} from "back-end/types/experiment";
import cloneDeep from "lodash/cloneDeep";
import { DEFAULT_REGRESSION_ADJUSTMENT_DAYS } from "shared/constants";
import { OrganizationSettings } from "back-end/types/organization";
import { ExperimentMetricInterface } from "shared/experiments";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import Modal from "../Modal";
import PremiumTooltip from "../Marketing/PremiumTooltip";
import UpgradeMessage from "../Marketing/UpgradeMessage";
import UpgradeModal from "../Settings/UpgradeModal";
import MetricsOverridesSelector from "./MetricsOverridesSelector";
import MetricsSelector, { MetricsSelectorTooltip } from "./MetricsSelector";
import MetricSelector from "./MetricSelector";

export interface EditMetricsFormInterface {
  metrics: string[];
  guardrails: string[];
  activationMetric: string;
  metricOverrides: {
    id: string;
    conversionWindowHours?: number;
    conversionDelayHours?: number;
    winRisk?: number;
    loseRisk?: number;
    regressionAdjustmentOverride?: boolean;
    regressionAdjustmentEnabled?: boolean;
    regressionAdjustmentDays?: number;
  }[];
}

export function getDefaultMetricOverridesFormValue(
  overrides: MetricOverride[],
  getExperimentMetricById: (id: string) => ExperimentMetricInterface | null,
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
        ].includes(key)
      ) {
        defaultMetricOverrides[i][key] *= 100;
      }
    }
    if (defaultMetricOverrides[i].regressionAdjustmentDays === undefined) {
      const metricDefinition = getExperimentMetricById(
        defaultMetricOverrides[i].id
      );
      if (metricDefinition?.regressionAdjustmentOverride) {
        defaultMetricOverrides[i].regressionAdjustmentDays =
          metricDefinition.regressionAdjustmentDays;
      } else {
        defaultMetricOverrides[i].regressionAdjustmentDays =
          settings.regressionAdjustmentDays ??
          DEFAULT_REGRESSION_ADJUSTMENT_DAYS;
      }
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
      if (v === undefined || v === null || isNaN(v)) {
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
}> = ({ experiment, cancel, mutate }) => {
  const [upgradeModal, setUpgradeModal] = useState(false);
  const [hasMetricOverrideRiskError, setHasMetricOverrideRiskError] = useState(
    false
  );
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  const hasOverrideMetricsFeature = hasCommercialFeature("override-metrics");

  const { getExperimentMetricById } = useDefinitions();

  const defaultMetricOverrides = getDefaultMetricOverridesFormValue(
    experiment.metricOverrides || [],
    getExperimentMetricById,
    settings
  );

  const form = useForm<EditMetricsFormInterface>({
    defaultValues: {
      metrics: experiment.metrics || [],
      guardrails: experiment.guardrails || [],
      activationMetric: experiment.activationMetric || "",
      metricOverrides: defaultMetricOverrides,
    },
  });
  const { apiCall } = useAuth();

  if (upgradeModal) {
    return (
      <UpgradeModal
        close={() => setUpgradeModal(false)}
        reason="To override metric conversion windows,"
        source="override-metrics"
      />
    );
  }

  return (
    <Modal
      autoFocusSelector=""
      header="Edit Metrics"
      size="lg"
      open={true}
      close={cancel}
      ctaEnabled={!hasMetricOverrideRiskError}
      submit={form.handleSubmit(async (value) => {
        const payload = cloneDeep<EditMetricsFormInterface>(value);
        fixMetricOverridesBeforeSaving(payload.metricOverrides);
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        mutate();
      })}
      cta="Save"
    >
      <div className="form-group">
        <label className="font-weight-bold mb-1">Goal Metrics</label>
        <div className="mb-1">
          <span className="font-italic">
            Metrics you are trying to improve with this experiment.{" "}
          </span>
          <MetricsSelectorTooltip />
        </div>
        <MetricsSelector
          selected={form.watch("metrics")}
          onChange={(metrics) => form.setValue("metrics", metrics)}
          datasource={experiment.datasource}
          exposureQueryId={experiment.exposureQueryId}
          project={experiment.project}
          autoFocus={true}
          includeFacts={true}
        />
      </div>

      <div className="form-group">
        <label className="font-weight-bold mb-1">Guardrail Metrics</label>
        <div className="mb-1">
          <span className="font-italic">
            Metrics you want to monitor, but are NOT specifically trying to
            improve.{" "}
          </span>
          <MetricsSelectorTooltip />
        </div>
        <MetricsSelector
          selected={form.watch("guardrails")}
          onChange={(metrics) => form.setValue("guardrails", metrics)}
          datasource={experiment.datasource}
          exposureQueryId={experiment.exposureQueryId}
          project={experiment.project}
          includeFacts={true}
        />
      </div>

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

      <div className="form-group mb-2">
        <PremiumTooltip commercialFeature="override-metrics">
          Metric Overrides (optional)
        </PremiumTooltip>
        <div className="mb-2 font-italic" style={{ fontSize: 12 }}>
          <p className="mb-0">
            Override metric behaviors within this experiment.
          </p>
          <p className="mb-0">
            Leave any fields empty that you do not want to override.
          </p>
        </div>
        <MetricsOverridesSelector
          experiment={experiment}
          form={form}
          disabled={!hasOverrideMetricsFeature}
          setHasMetricOverrideRiskError={(v: boolean) =>
            setHasMetricOverrideRiskError(v)
          }
        />
        {!hasOverrideMetricsFeature && (
          <UpgradeMessage
            showUpgradeModal={() => setUpgradeModal(true)}
            commercialFeature="override-metrics"
            upgradeMessage="override metrics"
          />
        )}
      </div>
    </Modal>
  );
};

export default EditMetricsForm;
