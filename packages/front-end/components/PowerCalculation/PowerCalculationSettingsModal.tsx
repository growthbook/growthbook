import { useEffect, useMemo, useState } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import clsx from "clsx";
import {
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  isBinomialMetric,
  quantileMetricType,
} from "shared/experiments";
import {
  config,
  isValidPowerCalculationParams,
  ensureAndReturnPowerCalculationParams,
  MetricParams,
  PartialMetricParams,
  FullModalPowerCalculationParams,
  PartialPowerCalculationParams,
  StatsEngineSettings,
} from "shared/power";
import { OrganizationSettings } from "back-end/types/organization";
import { MetricPriorSettings } from "back-end/types/fact-table";
import { PopulationDataInterface } from "back-end/types/population-data";
import {
  getSnapshotAnalysis,
  isProjectListValidForProject,
  meanVarianceFromSums,
  ratioVarianceFromSums,
} from "shared/util";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { daysBetween } from "shared/dates";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import Field from "@/components/Forms/Field";
import PercentField from "@/components/Forms/PercentField";
import Toggle from "@/components/Forms/Toggle";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ensureAndReturn } from "@/types/utils";
import { AuthContextValue, useAuth } from "@/services/auth";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import SelectField from "@/components/Forms/SelectField";
import HelperText from "@/components/Radix/HelperText";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import { useExperiments } from "@/hooks/useExperiments";
import RadioGroup from "@/components/Radix/RadioGroup";
import useApi from "@/hooks/useApi";
import Callout from "@/components/Radix/Callout";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@/components/Radix/DropdownMenu";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";

export type PowerModalPages = "select" | "set-params";

export type Props = {
  close?: () => void;
  onSuccess: (_: FullModalPowerCalculationParams) => void;
  params: PartialPowerCalculationParams;
  statsEngineSettings: StatsEngineSettings;
  startPage: PowerModalPages;
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
  experiments,
}: {
  form: Form;
  close?: () => void;
  onNext: () => void;
  experiments: ExperimentInterfaceStringDates[];
}) => {
  const {
    metrics: appMetrics,
    factMetrics: appFactMetrics,
    segments: appSegments,
    project,
    factTables: appFactTables,
    datasources,
  } = useDefinitions();
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();

  const hasHistoricalPower = hasCommercialFeature("historical-power");

  const selectedDatasource = form.watch("metricValuesData.datasource");
  const [availableMetrics, setAvailableMetrics] = useState<string[] | null>(
    null
  );
  const [availablePopulations, setAvailablePopulations] = useState<
    { label: string; value: string }[]
  >([]);
  const [identifiers, setIdentifiers] = useState<string[]>([]);

  // only allow metrics from the same datasource in an analysis
  // combine both metrics and remove quantile metrics
  const allAppMetrics: ExperimentMetricInterface[] = [
    ...appMetrics,
    ...appFactMetrics,
  ].filter((m) => {
    const isQuantileMetric = quantileMetricType(m) !== "";
    let inList = true;
    if (availableMetrics !== null) {
      inList = availableMetrics.includes(m.id);
    }
    const inDatasource =
      !selectedDatasource || m.datasource === selectedDatasource;
    return !isQuantileMetric && inList && inDatasource;
  }); // identifier type joinable

  const metrics = form.watch("metrics");
  const selectedMetrics = Object.keys(metrics);

  const metricValuesSource = form.watch("metricValuesData.source");
  const metricValuesSourceId = form.watch("metricValuesData.sourceId");

  const isNextDisabled =
    !selectedMetrics.length &&
    (metricValuesSourceId !== "" || metricValuesSource === "manual") &&
    (hasHistoricalPower || metricValuesSource === "manual");

  // TODO onNext validate that experiment has results
  const availableExperiments = useMemo(
    () =>
      experiments
        .map((exp) => {
          const datasource = datasources.find((d) => d.id === exp.datasource);
          const exposureQuery = datasource?.settings?.queries?.exposure?.find(
            (e) => e.id === exp.exposureQueryId
          );

          return {
            ...exp,
            exposureQueryUserIdType: exposureQuery?.userIdType,
            allMetrics: getAllMetricIdsFromExperiment(exp),
          };
        })
        .filter((e) => {
          if (
            e.status === "draft" ||
            !e.exposureQueryUserIdType ||
            e.allMetrics.length === 0
          )
            return false;
          return true;
        }),
    [experiments, datasources]
  );

  const availableSegments = useMemo(
    () =>
      appSegments.filter((s) =>
        isProjectListValidForProject(s.projects, project)
      ),
    [appSegments, project]
  );
  const availableFactTables = useMemo(
    () =>
      appFactTables.filter((ft) =>
        isProjectListValidForProject(ft.projects, project)
      ),
    [appFactTables, project]
  );

  useEffect(() => {
    switch (metricValuesSource) {
      case "factTable": {
        setAvailablePopulations(
          availableFactTables.map((p) => ({ label: p.name, value: p.id }))
        );
        const factTable = availableFactTables.find(
          (f) => f.id === metricValuesSourceId
        );
        setAvailableMetrics(null);
        if (factTable) {
          form.setValue("metricValuesData.sourceName", factTable.name);
          form.setValue("metricValuesData.datasource", factTable.datasource);
          form.setValue(
            "metricValuesData.identifierType",
            factTable.userIdTypes[0]
          );
          setIdentifiers(factTable.userIdTypes);
        }
        break;
      }
      case "segment": {
        setAvailablePopulations(
          availableSegments.map((p) => ({ label: p.name, value: p.id }))
        );
        const segment = availableSegments.find(
          (s) => s.id === metricValuesSourceId
        );
        setAvailableMetrics(null);
        if (segment) {
          form.setValue("metricValuesData.sourceName", segment.name);
          form.setValue("metricValuesData.datasource", segment.datasource);
          form.setValue("metricValuesData.identifierType", segment.userIdType);
          setIdentifiers([segment.userIdType]);
        }
        break;
      }
      case "experiment": {
        setAvailablePopulations(
          availableExperiments.map((p) => ({ label: p.name, value: p.id }))
        );
        const experiment = availableExperiments.find(
          (e) => e.id === metricValuesSourceId
        );
        if (experiment) {
          form.setValue("metricValuesData.sourceName", experiment.name);
          form.setValue("metricValuesData.datasource", experiment.datasource);
          form.setValue(
            "metricValuesData.identifierType",
            experiment.exposureQueryUserIdType
          );
          setAvailableMetrics(experiment.allMetrics);
          setIdentifiers(
            experiment.exposureQueryUserIdType
              ? [experiment.exposureQueryUserIdType]
              : []
          );
        }
        break;
      }
      default: {
        setAvailablePopulations([]);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    metricValuesSource,
    metricValuesSourceId,
    setAvailablePopulations,
    setAvailableMetrics,
  ]);

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
      header="New Power Calculation"
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
      <>
        <p>
          Estimate the power of your future experiment based on user traffic and
          selected key metrics. Use <strong>Fact Tables</strong>,{" "}
          <strong>Segments</strong>, or <strong>Past Experiments</strong> to
          automatically calculate expected traffic and metric values to more
          reliably estimate power.
        </p>
        <div className="d-flex">
          <label className="font-weight-bold">Population Type</label>
          <PremiumTooltip
            premiumText={
              "Automated calculations based on Fact Tables, Segments, and Past Experiments are only available on the Pro or Enterprise plans."
            }
            commercialFeature="historical-power"
          >
            <></>
          </PremiumTooltip>
        </div>
        <div className="mb-2">
          Pick the population that best represents the users you are targeting
          with your experiment.
        </div>
        <RadioGroup
          value={metricValuesSource ?? "manual"}
          options={[
            {
              value: "factTable",
              label: "Fact table",
              disabled: !hasHistoricalPower,
            },
            {
              value: "segment",
              label: "Segment",
              disabled: !hasHistoricalPower,
            },
            {
              value: "experiment",
              label: "Past experiment",
              disabled: !hasHistoricalPower,
            },
            { value: "manual", label: "Enter values manually" },
          ]}
          setValue={(value) => {
            if (value !== metricValuesSource) {
              form.setValue("metricValuesData.sourceId", undefined);
              form.setValue("metricValuesData.sourceName", undefined);
              form.setValue("metrics", {});
              form.setValue(
                "metricValuesData.source",
                value as FullModalPowerCalculationParams["metricValuesData"]["source"]
              );
              form.setValue("metricValuesData.identifierType", undefined);
              form.setValue("customizedMetrics", false);
            }
          }}
          mb="2"
        />
        {metricValuesSource !== "manual" ? (
          <>
            <SelectField
              label={
                <>
                  <span className="mr-auto font-weight-bold">
                    {metricValuesSource === "factTable"
                      ? "Fact Table"
                      : metricValuesSource === "experiment"
                      ? "Experiment"
                      : "Segment"}
                  </span>
                </>
              }
              value={metricValuesSourceId ?? ""}
              options={availablePopulations}
              onChange={(value) =>
                form.setValue("metricValuesData.sourceId", value)
              }
              className="mb-2"
              forceUndefinedValueToNull={true}
            />
            <SelectField
              label={
                <>
                  <span className="mr-auto font-weight-bold">
                    Identifier Type
                  </span>
                </>
              }
              disabled={identifiers.length <= 1}
              value={form.watch("metricValuesData.identifierType") ?? ""}
              options={identifiers.map((i) => ({ label: i, value: i }))}
              onChange={(value) =>
                form.setValue("metricValuesData.identifierType", value)
              }
              forceUndefinedValueToNull={true}
            />
          </>
        ) : null}
        <hr />
        <label className="mr-auto font-weight-bold">
          {" "}
          Select Metrics{" "}
          <Tooltip
            body={
              <>
                {metricValuesSource === "experiment" ? (
                  <p>
                    Only metrics analyzed with this experiment can be selected.
                  </p>
                ) : metricValuesSource !== "manual" ? (
                  <p>
                    Only metrics that are in the same datasource and share an
                    identifier type with your population can be selected.
                  </p>
                ) : null}
                <p>Quantile metrics cannot be selected.</p>
              </>
            }
          />
        </label>
        <div className="mb-2">
          Pick the key metrics for which you want to estimate power.
        </div>

        <MultiSelectField
          sort={false}
          value={selectedMetrics}
          options={allAppMetrics.map(({ name: label, id: value }) => ({
            label,
            value,
          }))}
          isOptionDisabled={() => 5 <= selectedMetrics.length}
          disabled={!metricValuesSourceId && metricValuesSource !== "manual"}
          onChange={(value: string[]) => {
            form.setValue(
              "metrics",
              value.reduce((result, id) => {
                const metric = ensureAndReturn(
                  allAppMetrics.find((m) => m.id === id)
                );
                if (!selectedDatasource)
                  form.setValue(
                    "metricValuesData.datasource",
                    metric.datasource
                  );

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
      </>
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
  const { permissionsUtil } = useUser();
  const { getDatasourceById } = useDefinitions();

  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  const [queryModalOpen, setQueryModalOpen] = useState<boolean>(false);

  const metricValuesData = form.watch("metricValuesData");
  const metricValuesSourceId = metricValuesData?.sourceId;
  const datasource = metricValuesData?.datasource;
  const metricValuesPopulationId = metricValuesData?.populationId;
  const datasourceProjects = datasource
    ? getDatasourceById(datasource)?.projects
    : [];

  const customizedMetrics = form.getValues("customizedMetrics");

  const canRunPopulationQuery = permissionsUtil.canRunPopulationDataQueries({
    projects: datasourceProjects ?? [],
  });

  const { data, error: getError, mutate } = useApi<{
    populationData: PopulationDataInterface;
  }>(`/population-data/${metricValuesPopulationId}`, {
    shouldRun: () => !!metricValuesPopulationId,
  });

  const [error, setError] = useState<string | undefined>(getError?.message);

  const populationData = data?.populationData;

  useEffect(() => {
    if (populationData?.status === "success" && !customizedMetrics) {
      setMetricDataFromPopulationData({ populationData, form });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [populationData]);

  if (!metricValuesSourceId) return null;

  // TODO add url sharing and save populationId + metric
  return (
    <>
      {queryModalOpen ? (
        <AsyncQueriesModal
          queries={populationData?.queries?.map((q) => q.query) ?? []}
          error={populationData?.error}
          close={() => setQueryModalOpen(false)}
        />
      ) : null}
      <div className="ml-2 row align-items-center">
        <div className="col-auto pl-0">
          Compute metric values using last 8 weeks of data from{" "}
          <strong>{form.watch("metricValuesData.sourceName")}</strong>.
        </div>
        <div style={{ flex: 1 }} />
        <div className="col-auto">
          {canRunPopulationQuery && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  form.setValue("customizedMetrics", false);
                  const res = await postPopulationData({
                    form,
                    apiCall,
                    force: true,
                  });
                  form.setValue(
                    "metricValuesData.populationId",
                    res.populationData?.id
                  );
                  mutate();
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              <RunQueriesButton
                icon="refresh"
                cta={
                  populationData?.status === "success"
                    ? "Refresh Data"
                    : "Get Data"
                }
                mutate={mutate}
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
        <div className="col-auto pl-0">
          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                color="gray"
                radius="full"
                size="2"
                highContrast
              >
                <BsThreeDotsVertical size={18} />
              </IconButton>
            }
            open={dropdownOpen}
            onOpenChange={(o) => {
              setDropdownOpen(!!o);
            }}
            menuPlacement="end"
          >
            <DropdownMenuItem
              onClick={() => {
                setQueryModalOpen(true);
                setDropdownOpen(false);
              }}
            >
              View Queries
            </DropdownMenuItem>
          </DropdownMenu>
        </div>
      </div>
      {populationData?.status === "error" || error ? (
        <>
          {populationData?.status === "error" ? (
            <Callout status={"error"} mt={"2"}>
              Queries failed. Investigate the issue, pick a different population
              and/or metric, or enter values manually.
              <br />
              <ViewAsyncQueriesButton
                queries={populationData?.queries?.map((q) => q.query) ?? []}
                error={populationData?.error}
                icon={null}
                hideQueryCount={true}
                className="btn btn-link p-0 pt-1"
              />
            </Callout>
          ) : error ? (
            <Callout status={"error"} mt={"2"}>
              Error starting queries: Try a different population and/or metric
              or enter values manually.
              <br />
              {error}
            </Callout>
          ) : null}
          <hr />
          <DataInput
            form={form}
            engineType={engineType}
            hasPrefilledData={false}
          />
        </>
      ) : null}
      {populationData?.status === "success" && (
        <>
          <hr />
          <DataInput form={form} engineType={engineType} />
        </>
      )}
    </>
  );
};

const DataInput = ({
  form,
  engineType,
  hasPrefilledData = true,
}: {
  form: Form;
  engineType: "bayesian" | "frequentist";
  hasPrefilledData?: boolean;
}) => {
  const [metricsEditable, setMetricsEditable] = useState<boolean>(
    !!form.getValues("customizedMetrics") || !hasPrefilledData
  );
  const metrics = form.getValues("metrics");
  const metricIds = Object.keys(metrics);

  return (
    <>
      <div className="ml-2 mt-4">
        {hasPrefilledData ? (
          <div className="mb-2">
            Metric values below pre-filled from{" "}
            {form.getValues("metricValuesData.source") === "experiment" ? (
              <>
                from experiment:{" "}
                <strong>
                  {form.getValues("metricValuesData.sourceName")}.
                </strong>
              </>
            ) : (
              "query data."
            )}
            {metricsEditable ? (
              <Tooltip
                body="Reset to query values"
                usePortal={true}
                tipPosition="top"
              >
                <a
                  role="button"
                  className="ml-1 mb-0"
                  onClick={() => {
                    const savedData = form.getValues("savedData");
                    if (savedData) {
                      let savedMetrics = {};
                      for (const [id, m] of Object.entries(metrics)) {
                        const oldMetricValues = savedData.metrics[id];
                        if (oldMetricValues) {
                          savedMetrics = {
                            ...savedMetrics,
                            [id]: {
                              ...oldMetricValues,
                              // don't override effect size
                              effectSize: m.effectSize,
                              overrideMetricLevelSettings:
                                m.overrideMetricLevelSettings,
                              overridePriorLiftMean: m.overridePriorLiftMean,
                              overridePriorLiftStandardDeviation:
                                m.overridePriorLiftStandardDeviation,
                              overrideProper: m.overrideProper,
                            },
                          };
                        } else {
                          savedMetrics = {
                            ...savedMetrics,
                            [id]: m,
                          };
                        }
                      }
                      form.setValue("customizedMetrics", false);
                      form.setValue("metrics", savedMetrics);
                      form.setValue("usersPerWeek", savedData.usersPerWeek);
                      setMetricsEditable(false);
                    }
                  }}
                >
                  Reset to data values.
                </a>
              </Tooltip>
            ) : (
              <a
                role="button"
                className="ml-1 mb-0"
                onClick={() => {
                  setMetricsEditable(true);
                  form.setValue("customizedMetrics", true);
                }}
              >
                Customize values.
              </a>
            )}
          </div>
        ) : null}
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
          disabled={!metricsEditable}
        />
      </div>
      <div className="ml-2">
        {metricIds.map((metricId) => (
          <MetricParamsInput
            key={metricId}
            metricId={metricId}
            engineType={engineType}
            form={form}
            disableValue={!metricsEditable}
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
              key={`${name}-${entry}-${disableValue}`}
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
      {form.watch("metricValuesData.source") === "segment" ||
      form.watch("metricValuesData.source") === "factTable" ? (
        <PopulationDataQueryInput form={form} engineType={engineType} />
      ) : null}
      {form.watch("metricValuesData.source") === "experiment" ? (
        <DataInput form={form} engineType={engineType} />
      ) : null}
      {form.watch("metricValuesData.source") === "manual" ? (
        <ManualDataInput form={form} engineType={engineType} />
      ) : null}
    </Modal>
  );
};

async function postPopulationData({
  form,
  apiCall,
  force = false,
}: {
  form: Form;
  apiCall: AuthContextValue["apiCall"];
  force?: boolean;
}): Promise<{ populationData?: PopulationDataInterface }> {
  const metricValuesData = form.watch("metricValuesData");
  const sourceType = metricValuesData?.source;
  const metricIds = Object.keys(form.watch("metrics"));
  const userIdType = metricValuesData?.identifierType;
  const datasourceId = metricValuesData?.datasource;
  const sourceId = metricValuesData?.sourceId;
  const res = await apiCall<{
    populationData: PopulationDataInterface;
  }>(`/population-data`, {
    method: "POST",
    body: JSON.stringify({
      metricIds,
      datasourceId,
      sourceType,
      sourceId,
      userIdType,
      force,
    }),
  });
  return res;
}

function setMetricDataFromPopulationData({
  populationData,
  form,
}: {
  populationData: PopulationDataInterface;
  form: Form;
}) {
  const metrics = form.watch("metrics");

  if (populationData?.status !== "success") return;
  Object.entries(metrics).forEach(([id, metric]) => {
    const queryMetric = populationData.metrics.find((m) => m.metricId === id);
    if (!queryMetric) {
      metrics[id] = {
        ...metric,
        ...(metric.type === "binomial"
          ? { conversionRate: 0 }
          : { mean: 0, standardDeviation: 0 }),
      };
      return;
    }

    const mdata = queryMetric.data;

    const isRatioMetric =
      mdata.denominator_sum ||
      mdata.denominator_sum_squares ||
      mdata.main_denominator_sum_product;

    if (isRatioMetric && metric.type === "mean") {
      const mean = mdata.main_sum / (mdata.denominator_sum ?? 0);
      const standardDeviation = ratioVarianceFromSums({
        numerator_sum: mdata.main_sum,
        numerator_sum_squares: mdata.main_sum_squares,
        denominator_sum: mdata.denominator_sum ?? 0,
        denominator_sum_squares: mdata.denominator_sum_squares ?? 0,
        numerator_denominator_sum_product:
          mdata.main_denominator_sum_product ?? 0,
        n: mdata.count,
      });
      metrics[id] = {
        ...metric,
        mean,
        standardDeviation,
      };
      return;
    }

    if (metric.type === "binomial") {
      const mean = (mdata.count ?? 0) === 0 ? 0 : mdata.main_sum / mdata.count;
      metrics[id] = {
        ...metric,
        conversionRate: mean,
      };
      return;
    }

    const mean = (mdata.count ?? 0) === 0 ? 0 : mdata.main_sum / mdata.count;
    const standardDeviation = meanVarianceFromSums(
      mdata.main_sum,
      mdata.main_sum_squares,
      mdata.count
    );
    metrics[id] = {
      ...metric,
      mean,
      standardDeviation,
    };
  });
  const usersPerWeek = Math.round(
    populationData.units.reduce((r, u) => {
      return r + u.count;
    }, 0) / (populationData.units.length ?? 1)
  );
  form.setValue("metrics", metrics);
  form.setValue("usersPerWeek", isNaN(usersPerWeek) ? 0 : usersPerWeek);

  form.setValue("savedData", {
    usersPerWeek: isNaN(usersPerWeek) ? 0 : usersPerWeek,
    metrics: metrics,
  });
}

export default function PowerCalculationSettingsModal({
  close,
  onSuccess,
  statsEngineSettings,
  params,
  startPage,
}: Props) {
  const settings = useOrgSettings();
  const { project } = useDefinitions();
  const { experiments } = useExperiments(project, false, "standard");
  const { hasCommercialFeature } = useUser();
  const { apiCall } = useAuth();

  const [step, setStep] = useState<PowerModalPages>(startPage);

  const form = useForm<PartialPowerCalculationParams>({
    defaultValues: {
      ...params,
      metricValuesData: {
        source: hasCommercialFeature("historical-power")
          ? "factTable"
          : "manual",
        ...params.metricValuesData,
      },
    },
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
          experiments={experiments}
          close={close}
          onNext={async () => {
            if (form.watch("metricValuesData.source") === "experiment") {
              const experimentId = form.watch("metricValuesData.sourceId");
              const experiment = experiments.find((e) => e.id === experimentId);

              if (experiment) {
                const phase = experiment.phases.length - 1;
                try {
                  const { snapshot } = await apiCall<{
                    snapshot: ExperimentSnapshotInterface;
                  }>(
                    `/experiment/${experiment.id}/snapshot/${phase}/?type=standard`
                  );
                  if (snapshot) {
                    const analysis = getSnapshotAnalysis(snapshot);

                    // use total traffic for traffic
                    const units =
                      snapshot.health?.traffic.overall.variationUnits.reduce(
                        (result, v) => v + result,
                        0
                      ) ?? 0;

                    const experimentPhase = experiment.phases[phase];
                    const phaseLength = daysBetween(
                      experimentPhase.dateStarted ?? new Date(),
                      experimentPhase.dateEnded ?? new Date()
                    );
                    const lengthWeeks = phaseLength / 7;
                    let newMetrics = {};
                    let totalUnits = 0;

                    analysis?.results?.[0]?.variations?.forEach((v, i) => {
                      // use control only for metric mean and variance
                      if (i === 0) {
                        metricIds.forEach((metricId) => {
                          const mean = v.metrics[metricId].stats?.mean;
                          const standardDeviation =
                            v.metrics[metricId].stats?.stddev;
                          newMetrics = {
                            ...newMetrics,
                            [metricId]: {
                              ...metrics[metricId],
                              mean,
                              conversionRate: mean,
                              standardDeviation,
                            },
                          };
                        });
                      }
                      if (!units) {
                        totalUnits += v.users;
                      }
                    });

                    const usersPerWeek = Math.round(
                      (units || totalUnits) / lengthWeeks
                    );
                    form.setValue("metrics", newMetrics);
                    form.setValue("usersPerWeek", usersPerWeek);

                    form.setValue("savedData", {
                      usersPerWeek: usersPerWeek,
                      metrics: newMetrics,
                    });
                  }
                  setStep("set-params");
                } catch (e) {
                  console.error(e.message);
                }
              }
            } else if (form.watch("metricValuesData.source") !== "manual") {
              const res = await postPopulationData({ form, apiCall });
              form.setValue(
                "metricValuesData.populationId",
                res.populationData?.id
              );
              // sets it if data already exists, otherwise starts running on next page
              if (res.populationData?.status === "success") {
                setMetricDataFromPopulationData({
                  populationData: res.populationData,
                  form,
                });
              }
            } else {
              setStep("set-params");
            }
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
