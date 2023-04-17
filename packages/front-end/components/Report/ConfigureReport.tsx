import React, { useCallback, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import {
  MetricRegressionAdjustmentStatus,
  ReportInterface,
} from "back-end/types/report";
import { FaQuestionCircle } from "react-icons/fa";
import { AttributionModel } from "back-end/types/experiment";
import uniq from "lodash/uniq";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getValidDate } from "@/services/dates";
import { getExposureQuery } from "@/services/datasources";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { getRegressionAdjustmentsForMetric } from "@/services/experiments";
import { hasFileConfig } from "@/services/env";
import { GBCuped, GBSequential } from "@/components/Icons";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "@/constants/stats";
import MetricsSelector from "../Experiment/MetricsSelector";
import Field from "../Forms/Field";
import Modal from "../Modal";
import SelectField from "../Forms/SelectField";
import DimensionChooser from "../Dimensions/DimensionChooser";
import { AttributionModelTooltip } from "../Experiment/AttributionModelTooltip";

export default function ConfigureReport({
  report,
  mutate,
  viewResults,
}: {
  report: ReportInterface;
  mutate: () => void;
  viewResults: () => void;
}) {
  const settings = useOrgSettings();
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const {
    metrics,
    segments,
    getDatasourceById,
    getMetricById,
  } = useDefinitions();
  const datasource = getDatasourceById(report.args.datasource);
  const [usingStatsEngineDefault, setUsingStatsEngineDefault] = useState(false);

  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );
  const hasSequentialTestingFeature = hasCommercialFeature(
    "sequential-testing"
  );

  const allExperimentMetricIds = uniq([
    ...report.args.metrics,
    ...(report.args.guardrails ?? []),
  ]);
  const allExperimentMetrics = allExperimentMetricIds.map((m) =>
    getMetricById(m)
  );
  const denominatorMetricIds = uniq(
    allExperimentMetrics.map((m) => m?.denominator).filter((m) => m)
  );
  const denominatorMetrics = denominatorMetricIds.map((m) => getMetricById(m));

  const form = useForm({
    defaultValues: {
      ...report.args,
      exposureQueryId:
        getExposureQuery(
          datasource?.settings,
          report.args.exposureQueryId,
          report.args.userIdType
        )?.id || "",
      attributionModel:
        report.args.attributionModel ||
        settings.attributionModel ||
        "firstExposure",
      startDate: getValidDate(report.args.startDate)
        .toISOString()
        .substr(0, 16),
      endDate: report.args.endDate
        ? getValidDate(report.args.endDate).toISOString().substr(0, 16)
        : undefined,
      statsEngine:
        report.args.statsEngine || settings.statsEngine || "bayesian",
      regressionAdjustmentEnabled:
        hasRegressionAdjustmentFeature &&
        !!report.args.regressionAdjustmentEnabled,
      metricRegressionAdjustmentStatuses:
        report.args.metricRegressionAdjustmentStatuses || [],
      sequentialTestingEnabled:
        hasSequentialTestingFeature && !!report.args.sequentialTestingEnabled,
      sequentialTestingTuningParameter:
        report.args.sequentialTestingTuningParameter,
    },
  });

  // CUPED adjustments
  const metricRegressionAdjustmentStatuses = useMemo(() => {
    const metricRegressionAdjustmentStatuses: MetricRegressionAdjustmentStatus[] = [];
    for (const metric of allExperimentMetrics) {
      if (!metric) continue;
      const {
        metricRegressionAdjustmentStatus,
      } = getRegressionAdjustmentsForMetric({
        metric: metric,
        denominatorMetrics: denominatorMetrics,
        experimentRegressionAdjustmentEnabled: !!form.watch(
          `regressionAdjustmentEnabled`
        ),
        organizationSettings: settings,
        metricOverrides: report.args.metricOverrides,
      });
      metricRegressionAdjustmentStatuses.push(metricRegressionAdjustmentStatus);
    }
    return metricRegressionAdjustmentStatuses;
  }, [
    allExperimentMetrics,
    denominatorMetrics,
    settings,
    form,
    report.args.metricOverrides,
  ]);

  const filteredMetrics = metrics.filter(
    (m) => m.datasource === report.args.datasource
  );
  const filteredSegments = segments.filter(
    (s) => s.datasource === report.args.datasource
  );

  const datasourceProperties = datasource?.properties;

  const variations = useFieldArray({
    control: form.control,
    name: "variations",
  });

  const exposureQueries = datasource?.settings?.queries?.exposure || [];
  const exposureQueryId = form.watch("exposureQueryId");
  const exposureQuery = exposureQueries.find((e) => e.id === exposureQueryId);

  const setStatsEngineToDefault = useCallback(
    (enable: boolean) => {
      if (enable) {
        form.setValue("statsEngine", settings.statsEngine);
      }
      setUsingStatsEngineDefault(enable);
    },
    [form, setUsingStatsEngineDefault, settings.statsEngine]
  );

  return (
    <Modal
      inline={true}
      header=""
      size="fill"
      open={true}
      className="border-0"
      submit={form.handleSubmit(async (value) => {
        const args = {
          ...value,
          skipPartialData: !!value.skipPartialData,
        };
        if (value.regressionAdjustmentEnabled) {
          args.metricRegressionAdjustmentStatuses = metricRegressionAdjustmentStatuses;
        }

        await apiCall(`/report/${report.id}`, {
          method: "PUT",
          body: JSON.stringify({
            args,
          }),
        });
        mutate();
        viewResults();
      })}
      cta="Save and Run"
    >
      <Field
        label="Experiment Id"
        labelClassName="font-weight-bold"
        {...form.register("trackingKey")}
        helpText="Will match against the experiment_id column in your data source"
      />
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
                {...form.register(`variations.${i}.id`)}
                placeholder={i + ""}
              />
            </div>
          ))}
        </div>
        <small className="form-text text-muted">
          Will match against the variation_id column in your data source
        </small>
      </div>
      <div className="form-group">
        <label className="font-weight-bold">Variation Weights</label>
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
                {...form.register(`variations.${i}.weight`, {
                  valueAsNumber: true,
                })}
              />
            </div>
          ))}
        </div>
        <small className="form-text text-muted">
          Will use this to check for a Sample Ratio Mismatch (SRM) in the
          results
        </small>
      </div>
      {datasource?.properties?.userIds && (
        <Field
          label="Experiment Assignment Table"
          labelClassName="font-weight-bold"
          {...form.register("exposureQueryId")}
          options={(datasource?.settings?.queries?.exposure || []).map((e) => ({
            display: e.name,
            value: e.id,
          }))}
          helpText="Determines where we pull experiment assignment data from"
        />
      )}

      <div className="row">
        <div className="col">
          <Field
            label="Start Date (UTC)"
            labelClassName="font-weight-bold"
            type="datetime-local"
            {...form.register("startDate")}
            helpText="Only include users who entered the experiment on or after this date"
          />
        </div>
        <div className="col">
          {form.watch("endDate") && (
            <Field
              label="End Date (UTC)"
              labelClassName="font-weight-bold"
              type="datetime-local"
              {...form.register("endDate")}
              helpText="Only include users who entered the experiment on or before this date"
            />
          )}
        </div>
      </div>

      <div className="form-group">
        <label className="font-weight-bold mb-1">Goal Metrics</label>
        <div className="mb-1 font-italic">
          Metrics you are trying to improve with this experiment.
        </div>
        <MetricsSelector
          selected={form.watch("metrics")}
          onChange={(metrics) => form.setValue("metrics", metrics)}
          datasource={report.args.datasource}
        />
      </div>
      <div className="form-group">
        <label className="font-weight-bold mb-1">Guardrail Metrics</label>
        <div className="mb-1 font-italic">
          Metrics you want to monitor, but are NOT specifically trying to
          improve.
        </div>
        <MetricsSelector
          selected={form.watch("guardrails")}
          onChange={(metrics) => form.setValue("guardrails", metrics)}
          datasource={report.args.datasource}
        />
      </div>
      <DimensionChooser
        value={form.watch("dimension")}
        setValue={(value) => form.setValue("dimension", value || "")}
        activationMetric={!!form.watch("activationMetric")}
        exposureQueryId={form.watch("exposureQueryId")}
        datasourceId={report.args.datasource}
        userIdType={report.args.userIdType}
        labelClassName="font-weight-bold"
        showHelp={true}
      />
      <SelectField
        label="Activation Metric"
        labelClassName="font-weight-bold"
        options={filteredMetrics.map((m) => {
          return {
            label: m.name,
            value: m.id,
          };
        })}
        initialOption="None"
        value={form.watch("activationMetric")}
        onChange={(value) => form.setValue("activationMetric", value || "")}
        helpText="Users must convert on this metric before being included"
      />
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
          value={form.watch("skipPartialData") ? "strict" : "loose"}
          onChange={(v) => {
            form.setValue("skipPartialData", v === "strict");
          }}
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
          helpText="How to treat users who have not had the full time to convert yet"
        />
      )}
      {datasourceProperties?.separateExperimentResultQueries && (
        <SelectField
          label={
            <AttributionModelTooltip>
              <strong>Attribution Model</strong> <FaQuestionCircle />
            </AttributionModelTooltip>
          }
          value={form.watch("attributionModel")}
          onChange={(value) => {
            const model = value as AttributionModel;
            form.setValue("attributionModel", model);
          }}
          options={[
            {
              label: "First Exposure",
              value: "firstExposure",
            },
            {
              label: "Experiment Duration",
              value: "experimentDuration",
            },
          ]}
        />
      )}

      <div className="d-flex flex-row no-gutters align-items-center">
        <div className="col-3">
          <SelectField
            disabled={usingStatsEngineDefault}
            label={<strong>Stats Engine</strong>}
            value={form.watch("statsEngine")}
            onChange={(value) =>
              form.setValue(
                "statsEngine",
                value === "frequentist" ? "frequentist" : "bayesian"
              )
            }
            options={[
              {
                label: "Bayesian",
                value: "bayesian",
              },
              {
                label: "Frequentist",
                value: "frequentist",
              },
            ]}
          />
        </div>
        <label className="ml-5 mt-3">
          <input
            type="checkbox"
            className="form-check-input"
            checked={usingStatsEngineDefault}
            onChange={(e) => setStatsEngineToDefault(e.target.checked)}
          />
          Reset to Organization Default
        </label>
      </div>

      <div className="d-flex flex-row no-gutters align-items-center">
        <div className="col-3">
          <SelectField
            label={
              <PremiumTooltip commercialFeature="regression-adjustment">
                <GBCuped /> Use Regression Adjustment (CUPED)
              </PremiumTooltip>
            }
            labelClassName="font-weight-bold"
            value={form.watch("regressionAdjustmentEnabled") ? "on" : "off"}
            onChange={(v) => {
              form.setValue("regressionAdjustmentEnabled", v === "on");
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
            disabled={!hasRegressionAdjustmentFeature}
          />
        </div>
      </div>

      <div className="d-flex flex-row no-gutters align-items-top">
        <div className="col-3">
          <SelectField
            label={
              <PremiumTooltip commercialFeature="regression-adjustment">
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
            disabled={!hasSequentialTestingFeature}
          />
        </div>
        <div
          className="col-2 px-4"
          style={{
            opacity: form.watch("sequentialTestingEnabled") ? "1" : "0.5",
          }}
        >
          <Field
            label="Tuning parameter"
            type="number"
            containerClassName="mb-0"
            min="0"
            disabled={!hasSequentialTestingFeature || hasFileConfig()}
            helpText={
              <>
                <span className="ml-2">
                  (
                  {settings.sequentialTestingTuningParameter ??
                    DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER}{" "}
                  is organization default)
                </span>
              </>
            }
            {...form.register("sequentialTestingTuningParameter", {
              valueAsNumber: true,
              validate: (v) => {
                return !(v <= 0);
              },
            })}
          />
        </div>
      </div>

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
    </Modal>
  );
}
