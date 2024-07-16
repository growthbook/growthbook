import React, { FC, useMemo, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FaQuestionCircle } from "react-icons/fa";
import {
  CreateMetricAnalysisProps,
  MetricAnalysisInterface,
  MetricAnalysisPopulationType,
  MetricAnalysisResult,
} from "back-end/types/metric-analysis";
import { FactMetricInterface } from "back-end/types/fact-table";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import useApi from "@/hooks/useApi";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import Toggle from "@/components/Forms/Toggle";
import DateGraph from "@/components/Metrics/DateGraph";
import HistogramGraph from "@/components/MetricAnalysis/Histogram";
import IdentifierChooser from "@/components/MetricAnalysis/IdentifierChooser";
import PopulationChooser from "@/components/MetricAnalysis/PopulationChooser";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import {
  formatNumber,
  getColumnRefFormatter,
  getExperimentMetricFormatter,
} from "@/services/metrics";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";

function MetricAnalysisOverview({
  name,
  metricType,
  userIdType,
  result,
  formatter,
  numeratorFormatter,
  denominatorFormatter,
}: {
  name: string;
  metricType: string;
  userIdType: string;
  result: MetricAnalysisResult;
  formatter: (value: number, options?: Intl.NumberFormatOptions) => string;
  numeratorFormatter?: (
    value: number,
    options?: Intl.NumberFormatOptions
  ) => string;
  denominatorFormatter?: (
    value: number,
    options?: Intl.NumberFormatOptions
  ) => string;
}) {
  return (
    <div className="mb-4">
      <div className="row mt-3">
        <div className="col-auto">
          <h4 className="mb-3 mt-1">{name}</h4>
        </div>
      </div>
      <div className="d-flex flex-row align-items-end">
        <div className="ml-0 appbox p-3 text-center row align-items-center">
          <div className="col-auto">
            {metricType === "ratio" &&
            numeratorFormatter &&
            denominatorFormatter ? (
              <>
                <div className="border-bottom">
                  {`Numerator: ${numeratorFormatter(result.numerator ?? 0)}`}
                </div>
                <div>
                  {`Denominator: ${denominatorFormatter(
                    result.denominator ?? 0
                  )}`}
                </div>
              </>
            ) : (
              <>
                <div className="border-bottom">
                  Total:{" "}
                  {metricType == "proportion"
                    ? formatNumber(result.mean * result.units)
                    : formatter(result.units * result.mean)}
                </div>
                <div>
                  <code>{userIdType}</code>
                  {": "}
                  {formatNumber(result.units)}
                </div>
              </>
            )}
          </div>
          <div className="col-auto" style={{ fontSize: "2.5em" }}>
            {"="}
          </div>
          <div className="col-auto">
            <div style={{ fontSize: "2.5em" }}>{formatter(result.mean)}</div>
            {metricType === "ratio" ? null : (
              <>
                {metricType === "proportion" ? "of" : "per"}{" "}
                <code>{userIdType}</code>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getLookbackSelected(lookbackDays: number): string {
  return [7, 14, 30].includes(lookbackDays) ? `${lookbackDays}` : `custom`;
}

type MetricAnalysisFormFields = {
  userIdType: string;
  dimensions: string[];

  lookbackSelected: string;
  lookbackDays: number;

  populationType: MetricAnalysisPopulationType;
  populationId: string | null;
};

interface MetricAnalysisProps {
  factMetric: FactMetricInterface;
  datasource: DataSourceInterfaceWithParams;
}

const MetricAnalysis: FC<MetricAnalysisProps> = ({
  factMetric,
  datasource,
}) => {
  const permissionsUtil = usePermissionsUtil();

  const { getFactTableById } = useDefinitions();
  const { apiCall } = useAuth();

  const storageKeyAvg = `metric_smoothBy_avg`; // to make metric-specific, include `${mid}`
  const storageKeySum = `metric_smoothBy_sum`;
  const [smoothByAvg, setSmoothByAvg] = useLocalStorage<"day" | "week">(
    storageKeyAvg,
    "day"
  );
  const [smoothBySum, setSmoothBySum] = useLocalStorage<"day" | "week">(
    storageKeySum,
    "day"
  );

  const [hoverDate, setHoverDate] = useState<number | null>(null);
  const onHoverCallback = (ret: { d: number | null }) => {
    setHoverDate(ret.d);
  };
  // TODO fetching too much
  const { data, mutate } = useApi<{
    metricAnalysis: MetricAnalysisInterface;
  }>(`/metric-analysis/metric/${factMetric.id}`);

  const metricAnalysis = data?.metricAnalysis;
  // get latest full object or add reset to default?
  const {
    reset,
    watch,
    setValue,
    register,
  } = useForm<MetricAnalysisFormFields>({
    defaultValues: useMemo(() => {
      return {
        userIdType: metricAnalysis?.settings?.userIdType ?? "",
        dimensions: metricAnalysis?.settings?.dimensions ?? [],
        lookbackSelected: metricAnalysis?.settings
          ? getLookbackSelected(metricAnalysis?.settings?.lookbackDays ?? 30)
          : "custom",
        lookbackDays: metricAnalysis?.settings?.lookbackDays ?? 30,
        populationType: metricAnalysis?.settings?.populationType ?? "factTable",
        populationId: metricAnalysis?.settings?.populationId ?? null,
      };
    }, [metricAnalysis]),
  });

  // TODO better way to populate form/fields than the following
  // not working to keep populationTypes
  useEffect(() => {
    reset({
      userIdType: metricAnalysis?.settings?.userIdType ?? "",
      dimensions: metricAnalysis?.settings?.dimensions ?? [],
      lookbackSelected: metricAnalysis?.settings
        ? getLookbackSelected(metricAnalysis?.settings?.lookbackDays ?? 30)
        : "custom",
      lookbackDays: metricAnalysis?.settings?.lookbackDays ?? 30,
      populationType: metricAnalysis?.settings?.populationType ?? "factTable",
      populationId: metricAnalysis?.settings?.populationId ?? null,
    });
  }, [metricAnalysis, reset]);

  const hasQueries = (metricAnalysis?.queries ?? []).length > 0;

  const formatter = getExperimentMetricFormatter(factMetric, getFactTableById);

  const numeratorFormatter = getColumnRefFormatter(
    factMetric.numerator,
    getFactTableById
  );
  const denominatorFormatter = factMetric.denominator
    ? getColumnRefFormatter(factMetric.denominator, getFactTableById)
    : undefined;

  const canRunMetricQuery =
    datasource && permissionsUtil.canRunMetricQueries(datasource);

  return (
    <div className="mb-4">
      <h3>Metric Analysis</h3>
      <div className="appbox p-3 mb-3">
        <div className="row mb-3 align-items-center">
          <div className="col-auto form-inline pr-5">
            <div>
              <div className="uppercase-title text-muted">Date Range</div>
              <div className="row">
                <div className="col-auto">
                  <SelectField
                    containerClassName={"select-dropdown-underline"}
                    options={[
                      {
                        label: "Last 7 Days",
                        value: "7",
                      },
                      {
                        label: "Last 14 Days",
                        value: "14",
                      },
                      {
                        label: "Last 30 Days",
                        value: "30",
                      },
                      {
                        label: "Custom Lookback",
                        value: "custom",
                      },
                    ]}
                    sort={false}
                    value={watch("lookbackSelected")}
                    onChange={(v) => {
                      setValue("lookbackSelected", v);
                      if (v !== "custom") {
                        setValue("lookbackDays", parseInt(v));
                      }
                    }}
                  />
                </div>
                {watch("lookbackSelected") === "custom" && (
                  <div className="col-auto">
                    <Field
                      type="number"
                      min={1}
                      max={999999}
                      append={"days"}
                      {...register("lookbackDays")}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="col-auto form-inline pr-5">
            <IdentifierChooser
              value={watch("userIdType")}
              setValue={(v) => setValue("userIdType", v)}
              factTableId={factMetric.numerator.factTableId}
            />
          </div>
          <div className="col-auto form-inline pr-5">
            <PopulationChooser
              value={watch("populationType")}
              setValue={(v) =>
                setValue("populationType", v as MetricAnalysisPopulationType)
              }
              setPopulationValue={(v) => setValue("populationId", v)}
              userIdType={watch("userIdType")}
              datasourceId={factMetric.datasource}
            />
          </div>
          <div style={{ flex: 1 }} />
          {hasQueries && (
            <div className="row my-3">
              <div className="col-auto">
                <ViewAsyncQueriesButton
                  queries={metricAnalysis?.queries.map((q) => q.query) ?? []}
                  color={metricAnalysis?.status === "error" ? "danger" : "info"}
                  error={metricAnalysis?.error}
                />
              </div>
            </div>
          )}
          <div className="col-auto">
            {canRunMetricQuery && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    const today = new Date();
                    const todayMinusLookback = new Date();
                    todayMinusLookback.setDate(
                      todayMinusLookback.getDate() -
                        (watch("lookbackDays") as number)
                    );
                    console.log(typeof watch("lookbackDays"));
                    const data: CreateMetricAnalysisProps = {
                      id: factMetric.id,
                      userIdType: watch("userIdType"),
                      dimensions: [],
                      lookbackDays: Number(watch("lookbackDays")),
                      startDate: todayMinusLookback
                        .toISOString()
                        .substring(0, 16),
                      endDate: today.toISOString().substring(0, 16),
                      populationType: watch("populationType"),
                      populationId: watch("populationId") ?? undefined,
                    };
                    await apiCall(`/metric-analysis`, {
                      method: "POST",
                      body: JSON.stringify(data),
                    });
                    mutate();
                  } catch (e) {
                    console.error(e);
                  }
                }}
              >
                <RunQueriesButton
                  icon="refresh"
                  cta={"Run Analysis"}
                  mutate={mutate}
                  model={
                    metricAnalysis ?? {
                      queries: [],
                      runStarted: new Date(),
                    }
                  }
                  cancelEndpoint={`/metric-analysis/${metricAnalysis?.id}/cancel`}
                  color="outline-primary"
                />
              </form>
            )}
          </div>
        </div>

        {/* AVERAGE; N USERS WITH 0 */}
        {metricAnalysis?.result && (
          <MetricAnalysisOverview
            name={factMetric.name}
            metricType={factMetric.metricType}
            userIdType={metricAnalysis.settings.userIdType}
            result={metricAnalysis.result}
            formatter={formatter}
            numeratorFormatter={numeratorFormatter}
            denominatorFormatter={denominatorFormatter}
          />
        )}
        {metricAnalysis?.result?.dates &&
          metricAnalysis.result.dates.length > 0 && (
            <div className="mb-4">
              <div className="row mt-3">
                <div className="col-auto">
                  <h4 className="mb-1 mt-1">
                    {factMetric.metricType === "proportion"
                      ? "Conversions"
                      : "Metric Value"}{" "}
                    Over Time
                  </h4>
                </div>
              </div>

              {factMetric.metricType != "proportion" && (
                <>
                  <div className="row mt-4 mb-1">
                    <div className="col">
                      <Tooltip
                        body={
                          <>
                            <p>
                              This figure shows the average metric value on a
                              day divided by number of unique units (e.g. users)
                              in the metric source on that day.
                            </p>
                            <p>
                              The standard deviation shows the spread of the
                              daily user metric values.
                            </p>
                            <p>
                              When smoothing is turned on, we simply average
                              values and standard deviations over the 7 trailing
                              days (including the selected day).
                            </p>
                          </>
                        }
                      >
                        <strong className="ml-4 align-bottom">
                          Daily Average <FaQuestionCircle />
                        </strong>
                      </Tooltip>
                    </div>
                    <div className="col">
                      <div className="float-right mr-2">
                        <label
                          className="small my-0 mr-2 text-right align-middle"
                          htmlFor="toggle-group-by-avg"
                        >
                          Smoothing
                          <br />
                          (7 day trailing)
                        </label>
                        <Toggle
                          value={smoothByAvg === "week"}
                          setValue={() =>
                            setSmoothByAvg(
                              smoothByAvg === "week" ? "day" : "week"
                            )
                          }
                          id="toggle-group-by-avg"
                          className="align-middle"
                        />
                      </div>
                    </div>
                  </div>
                  <DateGraph
                    type={"count"}
                    method="avg"
                    dates={metricAnalysis.result.dates.map((d) => {
                      return {
                        d: d.date,
                        v: d.mean,
                        s: d.stddev,
                        c: d.units,
                      };
                    })}
                    smoothBy={smoothByAvg}
                    formatter={formatter}
                    onHover={onHoverCallback}
                    hoverDate={hoverDate}
                  />
                </>
              )}

              {factMetric.metricType !== "ratio" ? (
                <>
                  <div className="row mt-4 mb-1">
                    <div className="col">
                      <Tooltip
                        body={
                          <>
                            {factMetric.metricType !== "proportion" ? (
                              <>
                                <p>
                                  This figure shows the daily sum of values in
                                  the metric source on that day.
                                </p>
                                <p>
                                  When smoothing is turned on, we simply average
                                  values over the 7 trailing days (including the
                                  selected day).
                                </p>
                              </>
                            ) : (
                              <>
                                <p>
                                  This figure shows the total count of units
                                  (e.g. users) in the metric source on that day.
                                </p>
                                <p>
                                  When smoothing is turned on, we simply average
                                  counts over the 7 trailing days (including the
                                  selected day).
                                </p>
                              </>
                            )}
                          </>
                        }
                      >
                        <strong className="ml-4 align-bottom">
                          Daily{" "}
                          {factMetric.metricType !== "proportion"
                            ? "Sum"
                            : "Count"}{" "}
                          <FaQuestionCircle />
                        </strong>
                      </Tooltip>
                    </div>
                    <div className="col">
                      <div className="float-right mr-2">
                        <label
                          className="small my-0 mr-2 text-right align-middle"
                          htmlFor="toggle-group-by-sum"
                        >
                          Smoothing
                          <br />
                          (7 day trailing)
                        </label>
                        <Toggle
                          value={smoothBySum === "week"}
                          setValue={() =>
                            setSmoothBySum(
                              smoothBySum === "week" ? "day" : "week"
                            )
                          }
                          id="toggle-group-by-sum"
                          className="align-middle"
                        />
                      </div>
                    </div>
                  </div>
                  <DateGraph
                    type={
                      factMetric.metricType === "proportion"
                        ? "binomial"
                        : "count"
                    }
                    method="sum"
                    dates={metricAnalysis.result.dates.map((d) => {
                      return {
                        d: d.date,
                        v: d.mean,
                        s: d.stddev,
                        c: d.units,
                        num: d.numerator,
                        den: d.denominator,
                      };
                    })}
                    smoothBy={smoothBySum}
                    formatter={formatter}
                    onHover={onHoverCallback}
                    hoverDate={hoverDate}
                  />
                </>
              ) : null}
            </div>
          )}
        {metricAnalysis?.result?.histogram &&
          metricAnalysis.result.histogram.length > 0 &&
          factMetric.metricType !== "proportion" && (
            <div className="mb-4">
              <div className="row mt-3">
                <div className="col-auto">
                  <h4 className="mb-1 mt-1">
                    Histogram of Metric value by{" "}
                    <code>{metricAnalysis.settings.userIdType}</code> Totals
                  </h4>
                </div>
              </div>
              <HistogramGraph
                data={metricAnalysis.result.histogram}
                userIdType={metricAnalysis.settings.userIdType}
                formatter={formatter}
              />
            </div>
          )}
      </div>
    </div>
  );
};

export default MetricAnalysis;
