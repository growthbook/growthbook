import React, { useMemo } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import {
  ExperimentReportInterface,
  MetricSnapshotSettings,
} from "shared/types/report";
import { FaQuestionCircle } from "react-icons/fa";
import {
  AttributionModel,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import uniq from "lodash/uniq";
import {
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
} from "shared/constants";
import { datetime, getValidDate } from "shared/dates";
import { getScopedSettings } from "shared/settings";
import { MetricInterface } from "shared/types/metric";
import { DifferenceType } from "shared/types/stats";
import {
  getAllMetricIdsFromExperiment,
  getMetricSnapshotSettings,
} from "shared/experiments";
import { isDefined } from "shared/util";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExposureQuery } from "@/services/datasources";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { hasFileConfig } from "@/services/env";
import { GBCuped, GBSequential } from "@/components/Icons";
import useApi from "@/hooks/useApi";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import { trackReport } from "@/services/track";
import { MetricsSelectorTooltip } from "@/components/Experiment/MetricsSelector";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import SelectField from "@/components/Forms/SelectField";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import { AttributionModelTooltip } from "@/components/Experiment/AttributionModelTooltip";
import MetricSelector from "@/components/Experiment/MetricSelector";
import Switch from "@/ui/Switch";
import Tooltip from "@/components/Tooltip/Tooltip";
import ExperimentMetricsSelector from "@/components/Experiment/ExperimentMetricsSelector";
import DatePicker from "@/components/DatePicker";

export default function ConfigureLegacyReport({
  report,
  mutate,
  viewResults,
}: {
  report: ExperimentReportInterface;
  mutate: () => void;
  viewResults: () => void;
}) {
  const orgSettings = useOrgSettings();
  const { apiCall } = useAuth();
  const { organization, hasCommercialFeature } = useUser();
  const {
    segments,
    getProjectById,
    getDatasourceById,
    getMetricById,
    getExperimentMetricById,
    metricGroups,
  } = useDefinitions();
  const datasource = getDatasourceById(report.args.datasource);

  const eid = report.experimentId;
  const { data: experimentData } = useApi<{
    experiment: ExperimentInterfaceStringDates;
  }>(`/experiment/${eid}`);
  const experiment = experimentData?.experiment;
  const pid = experiment?.project;
  const project = pid ? getProjectById(pid) : null;

  const { settings: parentSettings } = getScopedSettings({
    organization,
    project: project ?? undefined,
    experiment: experiment ?? undefined,
  });

  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment",
  );
  const hasSequentialTestingFeature =
    hasCommercialFeature("sequential-testing");

  const allExperimentMetricIds = getAllMetricIdsFromExperiment(
    report.args,
    false,
    metricGroups,
  );
  const allExperimentMetrics = allExperimentMetricIds.map((m) =>
    getExperimentMetricById(m),
  );
  const denominatorMetricIds = uniq(
    allExperimentMetrics
      .map((m) => m?.denominator)
      .filter((m) => m && typeof m === "string") as string[],
  );
  const denominatorMetrics: MetricInterface[] = useMemo(() => {
    return denominatorMetricIds
      .map((m) => getMetricById(m as string))
      .filter(isDefined);
  }, [denominatorMetricIds, getMetricById]);

  // todo: type this form
  const form = useForm({
    defaultValues: {
      ...report.args,
      differenceType: report.args.differenceType ?? "relative",
      exposureQueryId:
        getExposureQuery(
          datasource?.settings,
          report.args.exposureQueryId,
          report.args.userIdType,
        )?.id || "",
      attributionModel:
        report.args.attributionModel ||
        orgSettings.attributionModel ||
        "firstExposure",
      startDate: getValidDate(report.args.startDate)
        .toISOString()
        .substr(0, 16),
      endDate: report.args.endDate
        ? getValidDate(report.args.endDate).toISOString().substr(0, 16)
        : undefined,
      statsEngine: report.args.statsEngine || parentSettings.statsEngine.value,
      useLatestPriorSettings: report.args.useLatestPriorSettings || false,
      regressionAdjustmentEnabled:
        (hasRegressionAdjustmentFeature &&
          report.args.regressionAdjustmentEnabled) ??
        DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      settingsForSnapshotMetrics: report.args.settingsForSnapshotMetrics || [],
      sequentialTestingEnabled:
        hasSequentialTestingFeature && !!report.args.sequentialTestingEnabled,
      sequentialTestingTuningParameter:
        report.args.sequentialTestingTuningParameter,
    },
  });

  // CUPED adjustments
  const settingsForSnapshotMetrics = useMemo(() => {
    const settingsForSnapshotMetrics: MetricSnapshotSettings[] = [];
    for (const metric of allExperimentMetrics) {
      if (!metric) continue;
      const { metricSnapshotSettings } = getMetricSnapshotSettings({
        metric: metric,
        denominatorMetrics: denominatorMetrics,
        experimentRegressionAdjustmentEnabled: !!form.watch(
          `regressionAdjustmentEnabled`,
        ),
        organizationSettings: orgSettings,
        metricOverrides: report.args.metricOverrides,
      });
      settingsForSnapshotMetrics.push(metricSnapshotSettings);
    }
    return settingsForSnapshotMetrics;
  }, [
    allExperimentMetrics,
    denominatorMetrics,
    orgSettings,
    form,
    report.args.metricOverrides,
  ]);

  const filteredSegments = segments.filter(
    (s) => s.datasource === report.args.datasource,
  );

  const datasourceProperties = datasource?.properties;

  const variations = useFieldArray({
    control: form.control,
    name: "variations",
  });

  const exposureQueries = datasource?.settings?.queries?.exposure || [];
  const exposureQueryId = form.watch("exposureQueryId");
  const exposureQuery = exposureQueries.find((e) => e.id === exposureQueryId);

  return (
    <Modal
      trackingEventModalType=""
      inline={true}
      header=""
      size="fill"
      open={true}
      className="border-0 bg-transparent"
      submit={form.handleSubmit(async (value) => {
        const args = {
          ...value,
          skipPartialData: !!value.skipPartialData,
        };

        args.settingsForSnapshotMetrics = settingsForSnapshotMetrics;

        const res = await apiCall<{ updatedReport: ExperimentReportInterface }>(
          `/report/${report.id}`,
          {
            method: "PUT",
            body: JSON.stringify({
              args,
            }),
          },
        );
        trackReport(
          "update",
          "SaveAndRunButton",
          datasource?.type || null,
          res.updatedReport,
        );
        mutate();
        viewResults();
      })}
      cta="Save and Run"
    >
      <Field
        label="Tracking Key"
        labelClassName="font-weight-bold"
        {...form.register("trackingKey")}
        helpText="Will match against the experiment_id column in your experiment assignment table"
      />
      <div className="form-group">
        <label className="font-weight-bold">Variation Ids</label>
        <div className="row align-items-top">
          {variations.fields.map((v, i) => (
            <div
              className={`col-${Math.max(
                Math.round(12 / variations.fields.length),
                3,
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
                3,
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
        <SelectField
          label={
            <>
              Experiment Assignment Table{" "}
              <Tooltip body="Should correspond to the Identifier Type used to randomize units for this experiment" />
            </>
          }
          labelClassName="font-weight-bold"
          value={form.watch("exposureQueryId") ?? ""}
          onChange={(v) => form.setValue("exposureQueryId", v)}
          required
          options={exposureQueries?.map((q) => {
            return {
              label: q.name,
              value: q.id,
            };
          })}
          formatOptionLabel={({ label, value }) => {
            const userIdType = exposureQueries?.find(
              (e) => e.id === value,
            )?.userIdType;
            return (
              <>
                {label}
                {userIdType ? (
                  <span
                    className="text-muted small float-right position-relative"
                    style={{ top: 3 }}
                  >
                    Identifier Type: <code>{userIdType}</code>
                  </span>
                ) : null}
              </>
            );
          }}
        />
      )}

      <div className="row">
        <div className="col">
          <DatePicker
            label="Start Date (UTC)"
            date={form.watch("startDate")}
            setDate={(v) => {
              form.setValue("startDate", v ? datetime(v) : "");
            }}
            scheduleEndDate={form.watch("endDate")}
            disableAfter={form.watch("endDate") || undefined}
          />
        </div>
        <div className="col">
          <DatePicker
            label="End Date (UTC)"
            date={form.watch("endDate")}
            setDate={(v) => {
              form.setValue("endDate", v ? datetime(v) : "");
            }}
            scheduleStartDate={form.watch("startDate")}
            disableBefore={form.watch("startDate") || undefined}
            containerClassName=""
          />
          <div className="mb-3 mt-1 small">
            Leave blank to use latest data whenever report is run.{" "}
            <a
              role="button"
              className="a"
              onClick={(e) => {
                e.preventDefault();
                form.setValue("endDate", "");
              }}
            >
              Clear Input
            </a>
          </div>
        </div>
      </div>

      <ExperimentMetricsSelector
        datasource={report.args.datasource}
        exposureQueryId={exposureQueryId}
        project={project?.id}
        goalMetrics={form.watch("goalMetrics")}
        secondaryMetrics={form.watch("secondaryMetrics")}
        guardrailMetrics={form.watch("guardrailMetrics")}
        setGoalMetrics={(goalMetrics) =>
          form.setValue("goalMetrics", goalMetrics)
        }
        setSecondaryMetrics={(secondaryMetrics) =>
          form.setValue("secondaryMetrics", secondaryMetrics)
        }
        setGuardrailMetrics={(guardrailMetrics) =>
          form.setValue("guardrailMetrics", guardrailMetrics)
        }
      />
      <DimensionChooser
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | null | undefined' is not assignable... Remove this comment to see the full error message
        value={form.watch("dimension")}
        setValue={(value) => form.setValue("dimension", value || "")}
        activationMetric={!!form.watch("activationMetric")}
        exposureQueryId={form.watch("exposureQueryId")}
        datasourceId={report.args.datasource}
        userIdType={report.args.userIdType}
        labelClassName="font-weight-bold"
        showHelp={true}
        newUi={false}
      />
      <SelectField
        label="Difference Type"
        labelClassName="font-weight-bold"
        value={form.watch("differenceType")}
        onChange={(v) => form.setValue("differenceType", v as DifferenceType)}
        sort={false}
        options={[
          {
            label: "Relative",
            value: "relative",
          },
          {
            label: "Absolute",
            value: "absolute",
          },
          {
            label: "Scaled Impact",
            value: "scaled",
          },
        ]}
        helpText="Choose the units to display lifts in"
      />
      <MetricSelector
        datasource={form.watch("datasource")}
        exposureQueryId={exposureQueryId}
        includeFacts={true}
        label={
          <>
            Activation Metric{" "}
            <MetricsSelectorTooltip onlyBinomial={true} isSingular={true} />
          </>
        }
        labelClassName="font-weight-bold"
        initialOption="None"
        onlyBinomial
        value={form.watch("activationMetric") || ""}
        onChange={(value) => form.setValue("activationMetric", value || "")}
        helpText="Users must convert on this metric before being included"
      />
      {datasourceProperties?.experimentSegments && (
        <SelectField
          label="Segment"
          labelClassName="font-weight-bold"
          // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
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
          label="Handling In-Progress Conversions"
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
        parentSettings={parentSettings}
        allowUndefined={false}
      />

      {form.watch("statsEngine") === "frequentist" && (
        <div className="d-flex flex-row no-gutters align-items-top ml-1">
          <div className="col-3">
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
                    {orgSettings.sequentialTestingTuningParameter ??
                      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER}{" "}
                    is organization default)
                  </span>
                </>
              }
              {...form.register("sequentialTestingTuningParameter", {
                valueAsNumber: true,
                validate: (v) => {
                  // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
                  return !(v <= 0);
                },
              })}
            />
          </div>
        </div>
      )}
      {form.watch("statsEngine") === "bayesian" && (
        <div className="align-items-center">
          <Switch
            id="useLatestPriorSettings"
            label="Use latest metric prior settings"
            description="Enabling this ensures the report uses the latest priors set for your organization and metrics. You can disable it to freeze the priors for this report and keep them from changing when metric definitions change."
            value={form.watch("useLatestPriorSettings")}
            onChange={(v) => form.setValue("useLatestPriorSettings", v)}
          />
        </div>
      )}
      <div className="d-flex flex-row no-gutters align-items-center mb-3 ml-1">
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
            disabled={!hasRegressionAdjustmentFeature}
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
