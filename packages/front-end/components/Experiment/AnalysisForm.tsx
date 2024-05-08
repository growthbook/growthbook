import React, { FC, useCallback, useState } from "react";
import { UseFormReturn, useFieldArray, useForm } from "react-hook-form";
import {
  AttributionModel,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import { FaQuestionCircle } from "react-icons/fa";
import { getValidDate } from "shared/dates";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import {
  getAffectedEnvsForExperiment,
  isProjectListValidForProject,
} from "shared/util";
import { getScopedSettings } from "shared/settings";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExposureQuery } from "@/services/datasources";
import useOrgSettings from "@/hooks/useOrgSettings";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { hasFileConfig } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { GBSequential } from "@/components/Icons";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { AttributionModelTooltip } from "./AttributionModelTooltip";
import MetricsOverridesSelector from "./MetricsOverridesSelector";
import MetricsSelector, { MetricsSelectorTooltip } from "./MetricsSelector";
import {
  EditMetricsFormInterface,
  fixMetricOverridesBeforeSaving,
  getDefaultMetricOverridesFormValue,
} from "./EditMetricsForm";
import MetricSelector from "./MetricSelector";

const AnalysisForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  phase: number;
  cancel: () => void;
  mutate: () => void;
  editVariationIds?: boolean;
  editDates?: boolean;
  editMetrics?: boolean;
}> = ({
  experiment,
  cancel,
  mutate,
  phase,
  editVariationIds = true,
  editDates = true,
  editMetrics = false,
}) => {
  const {
    segments,
    getProjectById,
    getDatasourceById,
    getExperimentMetricById,
    getSegmentById,
    datasources,
  } = useDefinitions();

  const { organization, hasCommercialFeature } = useUser();

  const permissionsUtil = usePermissionsUtil();

  const orgSettings = useOrgSettings();

  const hasOverrideMetricsFeature = hasCommercialFeature("override-metrics");
  const [hasMetricOverrideRiskError, setHasMetricOverrideRiskError] =
    useState(false);
  const [upgradeModal, setUpgradeModal] = useState(false);

  const pid = experiment?.project;
  const project = pid ? getProjectById(pid) : null;

  const { settings: scopedSettings } = getScopedSettings({
    organization,
    project: project ?? undefined,
  });

  const hasSequentialTestingFeature =
    hasCommercialFeature("sequential-testing");

  let canRunExperiment = !experiment.archived;
  const envs = getAffectedEnvsForExperiment({ experiment });
  if (envs.length > 0) {
    if (!permissionsUtil.canRunExperiment(experiment, envs)) {
      canRunExperiment = false;
    }
  }

  const phaseObj = experiment.phases[phase];

  const form = useForm({
    defaultValues: {
      trackingKey: experiment.trackingKey || "",
      datasource: experiment.datasource || "",
      exposureQueryId:
        getExposureQuery(
          getDatasourceById(experiment.datasource)?.settings,
          experiment.exposureQueryId,
          experiment.userIdType
        )?.id || "",
      activationMetric: experiment.activationMetric || "",
      segment: experiment.segment || "",
      queryFilter: experiment.queryFilter || "",
      skipPartialData: experiment.skipPartialData ? "strict" : "loose",
      attributionModel:
        experiment.attributionModel ||
        orgSettings.attributionModel ||
        "firstExposure",
      dateStarted: getValidDate(phaseObj?.dateStarted ?? "")
        .toISOString()
        .substr(0, 16),
      dateEnded: getValidDate(phaseObj?.dateEnded ?? "")
        .toISOString()
        .substr(0, 16),
      variations: experiment.variations || [],
      sequentialTestingEnabled:
        hasSequentialTestingFeature &&
        experiment.sequentialTestingEnabled !== undefined
          ? experiment.sequentialTestingEnabled
          : !!orgSettings.sequentialTestingEnabled,
      sequentialTestingTuningParameter:
        experiment.sequentialTestingEnabled !== undefined
          ? experiment.sequentialTestingTuningParameter
          : orgSettings.sequentialTestingTuningParameter ??
            DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
      metrics: experiment.metrics,
      guardrails: experiment.guardrails || [],
      metricOverrides: getDefaultMetricOverridesFormValue(
        experiment.metricOverrides || [],
        getExperimentMetricById,
        orgSettings
      ),
      statsEngine: experiment.statsEngine,
    },
  });

  const [usingSequentialTestingDefault, setUsingSequentialTestingDefault] =
    useState(experiment.sequentialTestingEnabled === undefined);
  const setSequentialTestingToDefault = useCallback(
    (enable: boolean) => {
      if (enable) {
        form.setValue(
          "sequentialTestingEnabled",
          !!orgSettings.sequentialTestingEnabled
        );
        form.setValue(
          "sequentialTestingTuningParameter",
          orgSettings.sequentialTestingTuningParameter ??
            DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER
        );
      }
      setUsingSequentialTestingDefault(enable);
    },
    [
      form,
      setUsingSequentialTestingDefault,
      orgSettings.sequentialTestingEnabled,
      orgSettings.sequentialTestingTuningParameter,
    ]
  );

  const { apiCall } = useAuth();

  const datasource = getDatasourceById(form.watch("datasource"));
  const datasourceProperties = datasource?.properties;

  const filteredSegments = segments.filter(
    (s) => s.datasource === datasource?.id
  );

  // Error: Type instantiation is excessively deep and possibly infinite.
  const variations = useFieldArray({
    control: form.control,
    name: "variations",
  });

  const exposureQueries = datasource?.settings?.queries?.exposure || [];
  const exposureQueryId = form.watch("exposureQueryId");
  const exposureQuery = exposureQueries.find((e) => e.id === exposureQueryId);

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
      header={"Experiment Settings"}
      open={true}
      close={cancel}
      size="lg"
      ctaEnabled={!editMetrics || !hasMetricOverrideRiskError}
      submit={form.handleSubmit(async (value) => {
        const { dateStarted, dateEnded, skipPartialData, ...values } = value;

        const body: Partial<ExperimentInterfaceStringDates> & {
          phaseStartDate: string;
          phaseEndDate?: string;
          currentPhase?: number;
        } = {
          ...values,
          currentPhase: phase,
          phaseStartDate: dateStarted,
          skipPartialData: skipPartialData === "strict",
        };

        fixMetricOverridesBeforeSaving(body.metricOverrides || []);

        if (experiment.status === "stopped") {
          body.phaseEndDate = dateEnded;
        }
        if (usingSequentialTestingDefault) {
          // User checked the org default checkbox; ignore form values
          body.sequentialTestingEnabled =
            !!orgSettings.sequentialTestingEnabled;
          body.sequentialTestingTuningParameter =
            orgSettings.sequentialTestingTuningParameter ??
            DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
        }

        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        mutate();
      })}
      cta="Save"
    >
      <SelectField
        label="Data Source"
        labelClassName="font-weight-bold"
        value={datasource?.id || ""}
        onChange={(newDatasource) => {
          form.setValue("datasource", newDatasource);

          // If unsetting the datasource, leave all the other settings alone
          // That way, it will be restored if the user switches back to the previous value
          if (!newDatasource) {
            return;
          }

          // If the exposure query is now invalid
          const ds = getDatasourceById(newDatasource);
          if (!getExposureQuery(ds?.settings, form.watch("exposureQueryId"))) {
            form.setValue("exposureQueryId", "");
          }

          // If the segment is now invalid
          const segment = form.watch("segment");
          if (
            segment &&
            getSegmentById(segment)?.datasource !== newDatasource
          ) {
            form.setValue("segment", "");
          }

          const isValidMetric = (id: string) =>
            getExperimentMetricById(id)?.datasource === newDatasource;

          // If the activationMetric is now invalid
          const activationMetric = form.watch("activationMetric");
          if (activationMetric && !isValidMetric(activationMetric)) {
            form.setValue("activationMetric", "");
          }

          // Filter the selected metrics to only valid ones
          const metrics = form.watch("metrics");
          form.setValue("metrics", metrics.filter(isValidMetric));

          // Filter the selected guardrails to only valid ones
          const guardrails = form.watch("guardrails");
          form.setValue("guardrails", guardrails.filter(isValidMetric));
        }}
        options={datasources
          .filter(
            (ds) =>
              ds.id === experiment.datasource ||
              isProjectListValidForProject(ds.projects, experiment.project)
          )
          .map((d) => ({
            value: d.id,
            label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
          }))}
        className="portal-overflow-ellipsis"
        initialOption="Manual"
        helpText={
          <>
            <strong className="text-danger">Warning:</strong> Changing this will
            remove all metrics and segments from the experiment.
          </>
        }
      />
      {datasource?.properties?.exposureQueries && (
        <SelectField
          label="Experiment Assignment Table"
          labelClassName="font-weight-bold"
          value={form.watch("exposureQueryId")}
          onChange={(v) => form.setValue("exposureQueryId", v)}
          initialOption="Choose..."
          required
          options={exposureQueries.map((q) => {
            return {
              label: q.name,
              value: q.id,
            };
          })}
          helpText={
            <>
              <div>
                Should correspond to the Identifier Type used to randomize units
                for this experiment
              </div>
              {exposureQuery?.userIdType ? (
                <>
                  Identifier Type: <code>{exposureQuery?.userIdType}</code>
                </>
              ) : null}
            </>
          }
        />
      )}
      {datasource && (
        <Field
          label="Experiment Key"
          labelClassName="font-weight-bold"
          {...form.register("trackingKey")}
          helpText={
            <>
              Unique identifier for this experiment, used to track impressions
              and analyze results. Will match against the{" "}
              <code>experiment_id</code> column in your data source.
            </>
          }
          disabled={!canRunExperiment}
        />
      )}
      {editVariationIds && (
        <div className="form-group">
          <label className="font-weight-bold">Variation Ids</label>
          <div className="row align-items-top">
            {variations.fields.map((v, i) => (
              <div
                className={`col-${Math.max(
                  Math.round(12 / variations.fields.length),
                  3
                )} mb-2`}
                key={i}
              >
                <Field
                  label={v.name}
                  labelClassName="mb-0"
                  containerClassName="mb-1"
                  {...form.register(`variations.${i}.key`)}
                  placeholder={i + ""}
                />
              </div>
            ))}
          </div>
          <small className="form-text text-muted">
            Will match against the variation_id column in your data source
          </small>
        </div>
      )}
      {phaseObj && editDates && (
        <div className="row">
          <div className="col">
            <Field
              label="Start Date (UTC)"
              labelClassName="font-weight-bold"
              type="datetime-local"
              {...form.register("dateStarted")}
              helpText="Only include users who entered the experiment on or after this date"
            />
          </div>
          {experiment.status === "stopped" && (
            <div className="col">
              <Field
                label="End Date (UTC)"
                labelClassName="font-weight-bold"
                type="datetime-local"
                {...form.register("dateEnded")}
                helpText="Only include users who entered the experiment on or before this date"
              />
            </div>
          )}
        </div>
      )}
      {datasource && (
        <MetricSelector
          datasource={form.watch("datasource")}
          exposureQueryId={exposureQueryId}
          project={experiment.project}
          includeFacts={true}
          labelClassName="font-weight-bold"
          label={
            <>
              Activation Metric <MetricsSelectorTooltip onlyBinomial={true} />
            </>
          }
          initialOption="None"
          onlyBinomial
          value={form.watch("activationMetric")}
          onChange={(value) => form.setValue("activationMetric", value || "")}
          helpText="Users must convert on this metric before being included"
        />
      )}
      {datasourceProperties?.experimentSegments && (
        <SelectField
          label="Segment"
          labelClassName="font-weight-bold"
          value={form.watch("segment")}
          onChange={(value) => form.setValue("segment", value || "")}
          initialOption="None (All Users)"
          options={filteredSegments.map((s) => {
            return {
              label: s.name,
              value: s.id,
            };
          })}
          helpText="Only users in this segment will be included"
        />
      )}
      {datasourceProperties?.separateExperimentResultQueries && (
        <SelectField
          label="Metric Conversion Windows"
          labelClassName="font-weight-bold"
          value={form.watch("skipPartialData")}
          onChange={(value) => form.setValue("skipPartialData", value)}
          options={[
            {
              label: "Include In-Progress Conversions",
              value: "loose",
            },
            {
              label: "Exclude In-Progress Conversions",
              value: "strict",
            },
          ]}
          helpText="How to treat users not enrolled in the experiment long enough to complete conversion window."
        />
      )}
      {datasourceProperties?.separateExperimentResultQueries && (
        <SelectField
          label={
            <AttributionModelTooltip>
              <strong>Conversion Window Override</strong> <FaQuestionCircle />
            </AttributionModelTooltip>
          }
          value={form.watch("attributionModel")}
          onChange={(value) => {
            const model = value as AttributionModel;
            form.setValue("attributionModel", model);
          }}
          options={[
            {
              label: "Respect Conversion Windows",
              value: "firstExposure",
            },
            {
              label: "Ignore Conversion Windows",
              value: "experimentDuration",
            },
          ]}
        />
      )}
      <StatsEngineSelect
        value={form.watch("statsEngine")}
        onChange={(v) => {
          form.setValue("statsEngine", v);
        }}
        parentSettings={scopedSettings}
        allowUndefined={true}
      />
      {(form.watch("statsEngine") || scopedSettings.statsEngine.value) ===
        "frequentist" && (
        <div className="d-flex flex-row no-gutters align-items-top">
          <div className="col-5">
            <SelectField
              label={
                <PremiumTooltip commercialFeature="sequential-testing">
                  <GBSequential /> Use Sequential Testing
                </PremiumTooltip>
              }
              labelClassName="font-weight-bold"
              value={form.watch("sequentialTestingEnabled") ? "on" : "off"}
              onChange={(v) => {
                form.setValue("sequentialTestingEnabled", v === "on");
              }}
              options={[
                {
                  label: "On",
                  value: "on",
                },
                {
                  label: "Off",
                  value: "off",
                },
              ]}
              helpText="Only applicable to frequentist analyses"
              disabled={
                !hasSequentialTestingFeature || usingSequentialTestingDefault
              }
            />
          </div>
          <div
            className="col-3 pl-4"
            style={{
              opacity: form.watch("sequentialTestingEnabled") ? "1" : "0.5",
            }}
          >
            <Field
              label="Tuning parameter"
              type="number"
              containerClassName="mb-0"
              min="0"
              disabled={
                usingSequentialTestingDefault ||
                !hasSequentialTestingFeature ||
                hasFileConfig()
              }
              helpText={
                <>
                  <span className="ml-2">
                    (
                    {orgSettings.sequentialTestingTuningParameter ??
                      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER}{" "}
                    is default)
                  </span>
                </>
              }
              {...form.register("sequentialTestingTuningParameter", {
                valueAsNumber: true,
                validate: (v) => {
                  return !((v ?? 0) <= 0);
                },
              })}
            />
          </div>
          <div className="col align-self-center">
            <label className="ml-5">
              <input
                type="checkbox"
                className="form-check-input"
                checked={usingSequentialTestingDefault}
                disabled={!hasSequentialTestingFeature}
                onChange={(e) =>
                  setSequentialTestingToDefault(e.target.checked)
                }
              />
              Reset to Organization Default
            </label>
          </div>
        </div>
      )}
      {datasourceProperties?.queryLanguage === "sql" && (
        <div className="row">
          <div className="col">
            <Field
              label="Custom SQL Filter"
              labelClassName="font-weight-bold"
              {...form.register("queryFilter")}
              textarea
              placeholder="e.g. user_id NOT IN ('123', '456')"
              helpText="WHERE clause to add to the default experiment query"
            />
          </div>
          <div className="pt-2 border-left col-sm-4 col-lg-6">
            Available columns:
            <div className="mb-2 d-flex flex-wrap">
              {["timestamp", "variation_id"]
                .concat(exposureQuery ? [exposureQuery.userIdType] : [])
                .concat(exposureQuery?.dimensions || [])
                .map((d) => {
                  return (
                    <div className="mr-2 mb-2 border px-1" key={d}>
                      <code>{d}</code>
                    </div>
                  );
                })}
            </div>
            <div>
              <strong>Tip:</strong> Use a subquery inside an <code>IN</code> or{" "}
              <code>NOT IN</code> clause for more advanced filtering.
            </div>
          </div>
        </div>
      )}
      {editMetrics && (
        <>
          <div className="form-group mt-3">
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
              datasource={form.watch("datasource")}
              exposureQueryId={exposureQueryId}
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
              datasource={form.watch("datasource")}
              exposureQueryId={exposureQueryId}
              project={experiment.project}
              includeFacts={true}
            />
          </div>

          {(form.watch("metrics").length > 0 ||
            form.watch("guardrails").length > 0) && (
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
                form={
                  form as unknown as UseFormReturn<EditMetricsFormInterface>
                }
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
          )}
        </>
      )}
    </Modal>
  );
};

export default AnalysisForm;
