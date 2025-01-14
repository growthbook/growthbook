import { useCallback, useEffect, useState } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import clsx from "clsx";
import {
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  isBinomialMetric,
  quantileMetricType,
} from "shared/experiments";
import { OrganizationSettings } from "back-end/types/organization";
import { MetricPriorSettings } from "back-end/types/fact-table";
import { PopulationDataInterface } from "back-end/types/population-data";
import { getSnapshotAnalysis, meanVarianceFromSums, ratioVarianceFromSums } from "shared/util";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import PercentField from "@/components/Forms/PercentField";
import Toggle from "@/components/Forms/Toggle";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ensureAndReturn } from "@/types/utils";
import { useAuth } from "@/services/auth";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import SelectField from "@/components/Forms/SelectField";
import HelperText from "@/components/Radix/HelperText";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import {
  config,
  isValidPowerCalculationParams,
  ensureAndReturnPowerCalculationParams,
  MetricParams,
  PartialMetricParams,
  FullModalPowerCalculationParams,
  PartialPowerCalculationParams,
  StatsEngineSettings,
} from "./types";
import { useExperiments } from "@/hooks/useExperiments";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { EXPOSURE_DATE_DIMENSION_NAME } from "shared/constants";

export type Props = {
  close?: () => void;
  onSuccess: (_: FullModalPowerCalculationParams) => void;
  params: PartialPowerCalculationParams;
  statsEngineSettings: StatsEngineSettings;
};

type Form = UseFormReturn<PartialPowerCalculationParams>;

type Config =
  | {
      defaultSettingsValue?: (
        priorSettings: MetricPriorSettings | undefined,
        orgSettings: OrganizationSettings
      ) => number | undefined;
      defaultValue?: number;
    }
  | {
      defaultSettingsValue?: (
        priorSettings: MetricPriorSettings | undefined,
        orgSettings: OrganizationSettings
      ) => boolean | undefined;
      defaultValue?: boolean;
    };

const defaultValue = (
  { defaultSettingsValue, defaultValue }: Config,
  priorSettings: MetricPriorSettings | undefined,
  settings: OrganizationSettings
) => {
  const settingsDefault = defaultSettingsValue?.(priorSettings, settings);
  if (settingsDefault !== undefined) return settingsDefault;

  return defaultValue;
};

const SelectStep = ({
  form,
  close,
  onNext,
}: {
  form: Form;
  close?: () => void;
  onNext: () => void;
}) => {
  const {
    metrics: appMetrics,
    factMetrics: appFactMetrics,
    segments: appSegments,
    project,
  } = useDefinitions();

  const {
    experiments: appExperiments,
    error: experimentsError,
    loading: experimentsLoading,
  } = useExperiments(project, false, "standard");

  const settings = useOrgSettings();

  const selectedDatasource = form.watch("selectedDatasource");
  // only allow metrics from the same datasource in an analysis
  // combine both metrics and remove quantile metrics
  const allAppMetrics: ExperimentMetricInterface[] = [
    ...appMetrics,
    ...appFactMetrics,
  ].filter((m) => {
    const isQuantileMetric = quantileMetricType(m) !== "";
    const inSelectedDatasource = selectedDatasource ? m.datasource === selectedDatasource : true;
    return !isQuantileMetric && inSelectedDatasource;
  });
  const metrics = form.watch("metrics");
  const selectedMetrics = Object.keys(metrics);


  const metricValuesSource = form.getValues("metricValuesSource") ?? "";

  const isNextDisabled = !selectedMetrics.length && metricValuesSource === "";

  const availableSegments = appSegments
    .filter((s) => !selectedDatasource || s.datasource === selectedDatasource)
    .map((s) => ({
      label: `Segment: ${s.name}`,
      value: s.id,
    }));
  console.log(selectedDatasource);
  const availableExperiments = appExperiments
    .filter((e) => {
      if (!selectedDatasource || e.status === "draft") return false;
      const allExpMetrics = getAllMetricIdsFromExperiment(e);
      const hasDatasource = !selectedDatasource || e.datasource === selectedDatasource;
      if (!hasDatasource) return false;
      const hasMetrics = selectedMetrics.every((m) => allExpMetrics.includes(m));
      return hasMetrics;
    })
    .map((e) => ({
      label: `Experiment: ${e.name}`,
      value: e.id,
    }));

  // TODO onNext validate that experiemnt has results

  const field = (
    key: keyof typeof config,
    metric: ExperimentMetricInterface
  ) => ({
    [key]: defaultValue(config[key], metric.priorSettings, settings),
  });

  return (
    <Modal
      trackingEventModalType=""
      open
      size="lg"
      header="New Calculation"
      close={close}
      includeCloseCta={false}
      cta="Next >"
      secondaryCTA={
        <button
          disabled={isNextDisabled}
          onClick={onNext}
          className="btn btn-primary"
        >
          Next &gt;
        </button>
      }
    >
      <MultiSelectField
        labelClassName="d-flex"
        label={
          <>
            <span className="mr-auto font-weight-bold">
              Select Metrics{" "}
              <Tooltip body={"Quantile metrics cannot be selected."} />
            </span>
          </>
        }
        sort={false}
        value={selectedMetrics}
        options={allAppMetrics.map(({ name: label, id: value }) => ({
          label,
          value,
        }))}
        isOptionDisabled={() => 5 <= selectedMetrics.length}
        onChange={(value: string[]) => {
          form.setValue(
            "metrics",
            value.reduce((result, id) => {
              const metric = ensureAndReturn(
                allAppMetrics.find((m) => m.id === id)
              );
              if (!selectedDatasource) form.setValue("selectedDatasource", metric.datasource);

              return {
                ...result,
                [id]: metrics[id] || {
                  name: metric.name,
                  ...field("effectSize", metric),
                  ...(isBinomialMetric(metric)
                    ? { type: "binomial", ...field("conversionRate", metric) }
                    : {
                        type: "mean",
                        ...field("mean", metric),
                        ...field("standardDeviation", metric),
                        standardDeviation: undefined,
                      }),
                  ...field("overrideMetricLevelSettings", metric),
                  ...field("overrideProper", metric),
                  ...field("overridePriorLiftMean", metric),
                  ...field("overridePriorLiftStandardDeviation", metric),
                  ...field("metricProper", metric),
                  ...field("metricPriorLiftMean", metric),
                  ...field("metricPriorLiftStandardDeviation", metric),
                },
              };
            }, {})
          );
        }}
      />
      {selectedMetrics.length === 5 && (
        <HelperText status="info" mb="3">
          Limit 5 metrics
        </HelperText>
      )}
      <SelectField
        label={
          <>
            <span className="mr-auto font-weight-bold">
              Source of Metric Data{" "}
              <Tooltip
                body={
                  "Use a Segment to simulate an experiment with real traffic and metric data, or manually enter metric values. Only Segments that share identifier types and datasources with selected metrics will be available."
                }
              />
            </span>
          </>
        }
        value={
          metricValuesSource === "manual"
            ? "manual"
            : form.getValues("metricDataSourceId") ?? ""
        }
        options={[
          { options: availableSegments, label: "Automatic Query-Based" },
          { options: availableExperiments, label: "Automatic Past Experiment Data" },
          {
            options: [{ value: "manual", label: "Manual Entry" }],
            label: "Manual",
          },
        ]}
        onChange={(value) => {
          if (value !== "manual") {
            form.setValue("metricDataSourceId", value);
            if (value.startsWith("exp")) {
              form.setValue("metricValuesSource", "experiment");
              form.setValue(
                "metricDataSourceName",
                availableExperiments.find((s) => s.value === value)?.label
              );
            } else {
              form.setValue("metricValuesSource", "query");
              form.setValue(
                "metricDataSourceName",
                availableSegments.find((s) => s.value === value)?.label
              );
            }
          } else {
            form.setValue("metricValuesSource", "manual");
          }
        }}
      />
      {/* Identifier type selector goes here */}
    </Modal>
  );
};

const sortParams = (params: PartialMetricParams): PartialMetricParams => {
  const overridePrior = {
    overrideMetricLevelSettings: params.overrideMetricLevelSettings,
    overrideProper: params.overrideProper,
    overridePriorLiftMean: params.overridePriorLiftMean,
    overridePriorLiftStandardDeviation:
      params.overridePriorLiftStandardDeviation,
    metricProper: params.metricProper,
    metricPriorLiftMean: params.metricPriorLiftMean,
    metricPriorLiftStandardDeviation: params.metricPriorLiftStandardDeviation,
  };

  if (params.type === "binomial")
    return {
      name: params.name,
      type: params.type,
      effectSize: params.effectSize,
      conversionRate: params.conversionRate,
      ...overridePrior,
    };

  return {
    name: params.name,
    type: params.type,
    effectSize: params.effectSize,
    mean: params.mean,
    standardDeviation: params.standardDeviation,
    ...overridePrior,
  };
};

const displayedMetricParams = [
  "conversionRate",
  "mean",
  "standardDeviation",
  "effectSize",
] as const;

const displayedBayesianParams = [
  "overridePriorLiftMean",
  "overridePriorLiftStandardDeviation",
  "overrideProper",
] as const;

const InputField = ({
  entry,
  form,
  metricId,
  disabled = false,
  className = "",
}: {
  entry: keyof typeof config;
  form: Form;
  metricId: string;
  disabled?: boolean;
  className?: string;
}) => {
  const metrics = form.watch("metrics");
  const params = ensureAndReturn(metrics[metricId]);
  const entryValue = isNaN(params[entry]) ? undefined : params[entry];
  const { title, tooltip, ...c } = config[entry];

  const isKeyInvalid = (() => {
    if (entryValue === undefined) return false;
    if (c.type === "boolean") return false;
    if (c.minValue !== undefined && entryValue <= c.minValue) return true;
    if (c.maxValue !== undefined && c.maxValue < entryValue) return true;
    return false;
  })();

  const helpText = (() => {
    if (c.type === "boolean") return;

    const min = c.minValue ? c.minValue * 100 : c.minValue;
    const max = c.maxValue ? c.maxValue * 100 : c.maxValue;

    if (min !== undefined && max !== undefined)
      return `Must be greater than ${min} and less than or equal to ${max}`;
    if (min !== undefined) return `Must be greater than ${min}`;
    if (max !== undefined) return `Must be less than ${max}`;
    return "Must be a number";
  })();

  const commonOptions = {
    label: (
      <>
        <span className="font-weight-bold mr-1">{title}</span>{" "}
        {tooltip && (
          <Tooltip
            popperClassName="text-left"
            body={tooltip}
            tipPosition="right"
          />
        )}
      </>
    ),
    ...(c.type !== "boolean" ? { min: c.minValue, max: c.maxValue } : {}),
    className: clsx("w-50", isKeyInvalid && "border border-danger"),
    helpText: isKeyInvalid ? (
      <div className="text-danger">{helpText}</div>
    ) : undefined,
  };

  return (
    <div className={`col-4 ${className}`}>
      {c.type === "percent" && (
        <PercentField
          {...commonOptions}
          value={entryValue}
          onChange={(v) => form.setValue(`metrics.${metricId}.${entry}`, v)}
          disabled={disabled}
        />
      )}
      {c.type === "number" && (
        <Field
          {...commonOptions}
          {...form.register(`metrics.${metricId}.${entry}`, {
            valueAsNumber: true,
          })}
          disabled={disabled}
        />
      )}
      {c.type === "boolean" && (
        <div className="form-group">
          <div className="row align-items-center mt-4 self-start">
            <div className="col-auto">
              <Toggle
                id={`input-value-${metricId}-${entry}`}
                value={entryValue}
                setValue={(v) => {
                  form.setValue(`metrics.${metricId}.${entry}`, v);
                }}
                disabled={disabled}
              />
            </div>
            <div>{title}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const PopulationDataQueryInput = ({
  form,
  engineType,
}: {
  form: Form;
  engineType: "bayesian" | "frequentist";
}) => {
  const { apiCall } = useAuth();

  const [populationDataId, setPopulationDataId] = useState<string | null>(null);
  const [data, setData] = useState<PopulationDataInterface | null>(null);
  const metrics = form.getValues("metrics");
  const metricIds = Object.keys(metrics);

  const metricDataSourceId = form.watch("metricDataSourceId");

  const getData = useCallback(async () => {
    const path = populationDataId
      ? `/population-data/${populationDataId}`
      : `/population-data/source/${metricDataSourceId}`;
    const res = await apiCall<{
      populationData: PopulationDataInterface | null;
    }>(path);
    setData(res.populationData);
  }, [apiCall, metricDataSourceId, populationDataId]);

  useEffect(() => {
    getData();
  }, [getData]);

  // todo reset data if refresh errors?
  const populationData = data; // TODO
  const canRunPopulationQuery = true; // TODO

  // get datasource
  const datasourceId = "ds_2s1by2213lormx6hi";

  useEffect(() => {
    if (populationData?.status === "success") {
      const newMetrics = populationData.metrics.reduce((result, m) => {
        const oldMetric = metrics[m.metric];
        if (!oldMetric) return result;

        // build metric TODO BETTER
        const isRatioMetric =
          m.data.denominator_sum ||
          m.data.denominator_sum_squares ||
          m.data.main_denominator_sum_product;

        if (isRatioMetric && m.type === "ratio") {
          // TODO
          const mean = m.data.main_sum / (m.data.denominator_sum ?? 0);
          const standardDeviation = ratioVarianceFromSums({
            numerator_sum: m.data.main_sum,
            numerator_sum_squares: m.data.main_sum_squares,
            denominator_sum: m.data.denominator_sum ?? 0,
            denominator_sum_squares: m.data.denominator_sum_squares ?? 0,
            numerator_denominator_sum_product:
              m.data.main_denominator_sum_product ?? 0,
            n: m.data.count,
          });
          return {
            ...result,
            [m.metric]: {
              ...oldMetric,
              ...{
                mean,
                standardDeviation,
              },
            },
          };
        } else if (m.type === "binomial") {
          const mean = m.data.main_sum / m.data.count;
          return {
            ...result,
            [m.metric]: {
              ...oldMetric,
              ...{
                conversionRate: mean,
              },
            },
          };
        } else {
          const mean = m.data.main_sum / m.data.count;
          const standardDeviation = meanVarianceFromSums(
            m.data.main_sum,
            m.data.main_sum_squares,
            m.data.count
          );
          return {
            ...result,
            [m.metric]: {
              ...oldMetric,
              ...{
                mean,
                standardDeviation,
              },
            },
          };
        }
      }, metrics);
      form.setValue("metrics", newMetrics);

      form.setValue(
        "usersPerWeek",
        Math.round(
          populationData.units.reduce((r, u) => {
            return r + u.count;
          }, 0) / populationData.units.length
        )
      ); // change to 8
    }
  }, [populationData, form, metrics]);

  if (!metricDataSourceId) return null; // TODO error

  // TODO add url sharing and save populationId + metric
  // TODO permissions check
  // TODO identifier type check
  return (
    <>
      {" "}
      <div className="ml-2 row">
        <div className="col-auto">
          Compute metric values using last 8 weeks of data from{" "}
          <strong>{form.watch("metricDataSourceName")}</strong>.
        </div>
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          {canRunPopulationQuery && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  // track("MetricAnalysis_Update", {
                  //   type: factMetric.metricType,
                  //   populationType: data.populationType,
                  //   days: data.lookbackDays,
                  // });
                  const sourceType =
                    form.watch("metricDataSourceType") ?? "segment";
                  const res = await apiCall<{
                    populationData: PopulationDataInterface;
                  }>(`/population-data`, {
                    method: "POST",
                    body: JSON.stringify({
                      metrics: metricIds,
                      datasourceId,
                      sourceType,
                      sourceId: metricDataSourceId,
                      userIdType: "user_id",
                    }),
                  });
                  setPopulationDataId(res.populationData.id);
                  //setPopulationDataId(res.populationData.id);
                  await getData();
                } catch (e) {
                  //setError(e.message);
                }
              }}
            >
              <RunQueriesButton
                icon="refresh"
                cta={
                  populationData?.status === "success"
                    ? "Refresh Data"
                    : "Compute Metric Values"
                }
                mutate={getData}
                model={
                  populationData ?? {
                    queries: [],
                    runStarted: new Date(),
                  }
                }
                cancelEndpoint={`/population-data/${populationData?.id}/cancel`}
                color="outline-primary"
              />
            </form>
          )}
        </div>
        <div className="col-auto">
          <ViewAsyncQueriesButton
            queries={populationData?.queries?.map((q) => q.query) ?? []}
            error={populationData?.error}
            hideQueryCount={true}
            display={""}
          />
        </div>{" "}
        {/* error and classname */}
      </div>
      {populationData?.status === "success" && (
        <>
          <div className="ml-2 mt-4">
            <div className="mb-2">
              Greyed out values below pre-filled from query results.
            </div>
            <Field
              label={
                <div>
                  <span className="font-weight-bold mr-1">
                    Estimated Users Per Week
                  </span>
                  <Tooltip
                    popperClassName="text-left"
                    body="Total users across all variations"
                    tipPosition="right"
                  />
                </div>
              }
              type="number"
              {...form.register("usersPerWeek", {
                valueAsNumber: true,
              })}
              disabled={true}
            />
          </div>
          <div className="ml-2">
            {metricIds.map((metricId) => (
              <MetricParamsInput
                key={metricId}
                metricId={metricId}
                engineType={engineType}
                form={form}
                disableValue={true}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
};

// consolidate with experiment
const ExperimentDataInput = ({
  form,
  engineType,
}: {
  form: Form;
  engineType: "bayesian" | "frequentist";
}) => {

  const metrics = form.getValues("metrics");
  const metricIds = Object.keys(metrics);

  const metricDataSourceId = form.watch("metricDataSourceId");
  const snapshot = form.watch("snapshot")

  if (!metricDataSourceId) return null; // TODO error

  useEffect(() => {
  
  }, [snapshot, getSnapshotAnalysis, EXPOSURE_DATE_DIMENSION_NAME, form]);

  console.log(metrics);
  if (!snapshot) return null; // TODO
  // TODO add url sharing and save populationId + metric
  // TODO permissions check
  // TODO identifier type check
  return (
    <>
      <div className="ml-2">
        <div className="mb-2">
          Greyed out values below pre-filled from <strong>{form.watch("metricDataSourceName")}</strong>.
        </div>
        <Field
          label={
            <div>
              <span className="font-weight-bold mr-1">
                Estimated Users Per Week
              </span>
              <Tooltip
                popperClassName="text-left"
                body="Total users across all variations"
                tipPosition="right"
              />
            </div>
          }
          type="number"
          {...form.register("usersPerWeek", {
            valueAsNumber: true,
          })}
          disabled={true}
        />
      </div>
      <div className="ml-2">
        {metricIds.map((metricId) => (
          <MetricParamsInput
            key={metricId}
            metricId={metricId}
            engineType={engineType}
            form={form}
            disableValue={true}
          />
        ))}
      </div>
    </>
  );
};

const MetricParamsInput = ({
  form,
  metricId,
  engineType,
  disableValue,
}: {
  form: Form;
  metricId: string;
  engineType: "bayesian" | "frequentist";
  disableValue: boolean;
}) => {
  const metrics = form.watch("metrics");
  // eslint-disable-next-line
  const { name, ...params } = sortParams(ensureAndReturn(metrics[metricId]));

  const isBayesianParamDisabled = (entity) => {
    if (params.overrideProper) return false;

    return [
      "overridePriorLiftMean",
      "overridePriorLiftStandardDeviation",
    ].includes(entity);
  };

  return (
    <div className="card gsbox mb-3 pt-3 pl-3 pr-3 pb-1 mb-2 power-analysis-params">
      <div className="card-title uppercase-title mb-3">{name}</div>
      <div className="row">
        {Object.keys(params)
          .filter((v) =>
            (displayedMetricParams as readonly string[]).includes(v)
          )
          .map((entry: keyof Omit<MetricParams, "name" | "type">) => (
            <InputField
              key={`${name}-${entry}`}
              entry={entry}
              form={form}
              metricId={metricId}
              disabled={
                ["mean", "standardDeviation", "conversionRate"].includes(entry)
                  ? disableValue
                  : false
              }
            />
          ))}
      </div>
      {engineType === "bayesian" && (
        <>
          <div className="row align-items-center h-100 mb-2">
            <div className="col-auto">
              <input
                id={`input-value-${metricId}-overrideMetricLevelSettings`}
                type="checkbox"
                checked={params.overrideMetricLevelSettings}
                onChange={() =>
                  form.setValue(
                    `metrics.${metricId}.overrideMetricLevelSettings`,
                    !params.overrideMetricLevelSettings
                  )
                }
              />
            </div>
            <div>Override metric-level settings</div>
          </div>
          <div className="row">
            {params.overrideMetricLevelSettings &&
              Object.keys(params)
                .filter((v) =>
                  (displayedBayesianParams as readonly string[]).includes(v)
                )
                .map((entry: keyof Omit<MetricParams, "name" | "type">) => (
                  <InputField
                    key={`${name}-${entry}`}
                    entry={entry}
                    form={form}
                    metricId={metricId}
                    className={
                      isBayesianParamDisabled(entry) ? "invisible" : "visible"
                    }
                  />
                ))}
          </div>
        </>
      )}
    </div>
  );
};

const ManualDataInput = ({
  form,
  engineType,
}: {
  form: Form;
  engineType: "bayesian" | "frequentist";
}) => {
  const metrics = form.watch("metrics");
  const metricIds = Object.keys(metrics);

  const usersPerWeek = form.watch("usersPerWeek");
  const isUsersPerDayInvalid = usersPerWeek !== undefined && usersPerWeek <= 0;

  return (
    <>
      <div className="ml-2">
        <Field
          label={
            <div>
              <span className="font-weight-bold mr-1">
                Estimated Users Per Week
              </span>
              <Tooltip
                popperClassName="text-left"
                body="Total users across all variations"
                tipPosition="right"
              />
            </div>
          }
          type="number"
          {...form.register("usersPerWeek", {
            valueAsNumber: true,
          })}
          className={isUsersPerDayInvalid ? "border border-danger" : undefined}
          helpText={
            isUsersPerDayInvalid ? (
              <div className="text-danger">Must be greater than 0</div>
            ) : undefined
          }
        />
      </div>

      <div className="ml-2">
        <p>Customize metric details for calculating experiment duration.</p>

        {metricIds.map((metricId) => (
          <MetricParamsInput
            key={metricId}
            metricId={metricId}
            engineType={engineType}
            form={form}
            disableValue={false}
          />
        ))}
      </div>
    </>
  );
};

const SetParamsStep = ({
  form,
  close,
  onBack,
  onSubmit,
  engineType,
}: {
  form: Form;
  close?: () => void;
  onBack: () => void;
  onSubmit: (_: FullModalPowerCalculationParams) => void;
  engineType: "bayesian" | "frequentist";
}) => {
  return (
    <Modal
      trackingEventModalType=""
      open
      size="lg"
      header="New Calculation"
      close={close}
      includeCloseCta={false}
      cta="Submit"
      secondaryCTA={
        <button className="btn btn-link" onClick={onBack}>
          &lt; Back
        </button>
      }
      tertiaryCTA={
        <button
          disabled={
            !isValidPowerCalculationParams(engineType, form.getValues())
          }
          className="btn btn-primary"
          onClick={() =>
            onSubmit(
              ensureAndReturnPowerCalculationParams(
                engineType,
                form.getValues()
              )
            )
          }
        >
          Submit
        </button>
      }
    >
      {form.watch("metricValuesSource") === "query" ? (
        <PopulationDataQueryInput form={form} engineType={engineType} />
      ) : null}
      {form.watch("metricValuesSource") === "experiment" ? (
        <ExperimentDataInput form={form} engineType={engineType} />
      ) : null}
      {form.watch("metricValuesSource") === "manual" ? (
        <ManualDataInput form={form} engineType={engineType} />
      ) : null}
    </Modal>
  );
};

export default function PowerCalculationSettingsModal({
  close,
  onSuccess,
  statsEngineSettings,
  params,
}: Props) {
  const [step, setStep] = useState<"select" | "set-params">("select");
  const settings = useOrgSettings();
  const { apiCall } = useAuth();

  const form = useForm<PartialPowerCalculationParams>({
    defaultValues: params,
  });

  const metrics = form.watch("metrics");
  const metricIds = Object.keys(metrics);
  const defaultValues = Object.keys(config).reduce(
    (defaultValues, key) =>
      config[key].metricType
        ? {
            ...defaultValues,
            [key]: {
              type: config[key].metricType,
              value: defaultValue(config[key], undefined, settings),
            },
          }
        : defaultValues,
    {}
  );

  useEffect(() => {
    form.setValue(
      "metrics",
      Object.keys(metrics).reduce(
        (m, id) => ({
          ...m,
          [id]: {
            ...Object.keys(defaultValues).reduce(
              (values, key) =>
                metrics[id].type === defaultValues[key].type ||
                defaultValues[key].type === "all"
                  ? { ...values, [key]: defaultValues[key].value }
                  : {},
              {}
            ),
            ...metrics[id],
          },
        }),
        {}
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {step === "select" && (
        <SelectStep
          form={form}
          close={close}
          onNext={async () => {
            if (form.watch("metricValuesSource") === "experiment") {
              const experiment = form.watch("metricDataSourceId");
              const { snapshot } = await apiCall<{
                snapshot: ExperimentSnapshotInterface;
              }>(
                `/experiment/${experiment}/snapshot/0/?type=standard`
              );
              if (snapshot) {
                const analysis = getSnapshotAnalysis(snapshot);
                // use control for mean and variance
                // use total traffic for traffic
                const units = snapshot.health?.traffic.overall.variationUnits.reduce((result, v) => v + result, 0) ?? 0;
                // TODO get length from experiment
                const length = (snapshot.health?.traffic.dimension?.[EXPOSURE_DATE_DIMENSION_NAME]?.length ?? 7) / 7;
                let newMetrics = {};
                analysis?.results?.[0]?.variations?.forEach((v, i) => {
                  if (i === 0) {
                    metricIds.forEach((metricId) => {
                      console.log(v.metrics[metricId]);
                      const mean = v.metrics[metricId].stats?.mean;
                      console.log(mean);
                      const standardDeviation = v.metrics[metricId].stats?.stddev;
                      newMetrics = {
                        ...newMetrics,
                        [metricId]: {
                          ...metrics[metricId],
                          mean,
                          conversionRate: mean,
                          standardDeviation,
                        },
                      }
                    });
                  }
                });
                form.setValue("metrics", newMetrics);
          
                form.setValue(
                  "usersPerWeek",
                  Math.round(units / length)
                );
              }
            }
            // throw error
            setStep("set-params")
            
          }}
        />
      )}
      {step === "set-params" && (
        <SetParamsStep
          form={form}
          close={close}
          engineType={statsEngineSettings.type}
          onBack={() => setStep("select")}
          onSubmit={onSuccess}
        />
      )}
    </>
  );
}
