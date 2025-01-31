import { IconButton } from "@radix-ui/themes";
import { PopulationDataInterface } from "back-end/types/population-data";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { config, MetricParams, PartialMetricParams } from "shared/power";
import Field from "@/components/Forms/Field";
import PercentField from "@/components/Forms/PercentField";
import Toggle from "@/components/Forms/Toggle";
import {
  postPopulationData,
  setMetricDataFromPopulationData,
} from "@/components/PowerCalculation/power-calculation-utils";
import { PowerCalculationForm } from "@/components/PowerCalculation/PowerCalculationSettingsModal";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Callout from "@/components/Radix/Callout";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@/components/Radix/DropdownMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { ensureAndReturn } from "@/types/utils";

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

export const InputField = ({
  entry,
  form,
  metricId,
  disabled = false,
  className = "",
}: {
  entry: keyof typeof config;
  form: PowerCalculationForm;
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

export const MetricParamsInput = ({
  form,
  metricId,
  engineType,
  disableValue,
}: {
  form: PowerCalculationForm;
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

export const PopulationDataQueryInput = ({
  form,
  engineType,
}: {
  form: PowerCalculationForm;
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

export const DataInput = ({
  form,
  engineType,
  hasPrefilledData = true,
}: {
  form: PowerCalculationForm;
  engineType: "bayesian" | "frequentist";
  hasPrefilledData?: boolean;
}) => {
  const [metricsEditable, setMetricsEditable] = useState<boolean>(
    !!form.getValues("customizedMetrics") || !hasPrefilledData
  );
  const metrics = form.getValues("metrics");
  const metricIds = Object.keys(metrics);
  const error = form.watch("metricValuesData.error");

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
        {error ? (
          <Callout status={"error"} mb={"2"}>
            Error populating data. Try a different population and/or metric or
            enter values manually.
            <br />
            {error}
          </Callout>
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

export const ManualDataInput = ({
  form,
  engineType,
}: {
  form: PowerCalculationForm;
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
