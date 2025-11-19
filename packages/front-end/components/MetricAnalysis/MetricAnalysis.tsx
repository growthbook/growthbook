import React, { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  FaDatabase,
  FaExclamationTriangle,
  FaQuestionCircle,
} from "react-icons/fa";
import clsx from "clsx";
import { isEqual } from "lodash";
import { isBinomialMetric } from "shared/experiments";
import {
  CreateMetricAnalysisProps,
  MetricAnalysisInterface,
  MetricAnalysisPopulationType,
  MetricAnalysisResult,
  MetricAnalysisSettings,
} from "back-end/types/metric-analysis";
import { FactMetricInterface } from "back-end/types/fact-table";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import useApi from "@/hooks/useApi";
import Switch from "@/ui/Switch";
import DateGraph from "@/components/Metrics/DateGraph";
import HistogramGraph from "@/components/MetricAnalysis/HistogramGraph";
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
import QueriesLastRun from "@/components/Queries/QueriesLastRun";
import ViewAsyncQueriesButton from "@/components/Queries/ViewAsyncQueriesButton";
import OutdatedBadge from "@/components/OutdatedBadge";
import MetricAnalysisMoreMenu from "@/components/MetricAnalysis/MetricAnalysisMoreMenu";
import track from "@/services/track";
import Callout from "@/ui/Callout";
import { getMetricAnalysisProps } from "@/components/MetricAnalysis/metric-analysis-props";
import { useCurrency } from "@/hooks/useCurrency";

const LOOKBACK_DAY_OPTIONS = [7, 14, 30, 180, 365];

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
    options?: Intl.NumberFormatOptions,
  ) => string;
  denominatorFormatter?: (
    value: number,
    options?: Intl.NumberFormatOptions,
  ) => string;
}) {
  const displayCurrency = useCurrency();
  const formatterOptions = { currency: displayCurrency };

  let numeratorText = "Metric Total: ";
  let numeratorValue: string =
    metricType === "proportion" || metricType === "retention"
      ? formatNumber(result.units * result.mean)
      : formatter(result.units * result.mean, formatterOptions);
  let denominatorText: string | JSX.Element = (
    <>
      {"Unique "}
      <code>{userIdType}</code>
      {": "}
    </>
  );
  let denominatorValue: string = formatNumber(result.units);
  if (metricType === "ratio" && numeratorFormatter && denominatorFormatter) {
    numeratorText = "Numerator: ";
    denominatorText = "Denominator: ";
    numeratorValue = numeratorFormatter(
      result.numerator ?? 0,
      formatterOptions,
    );
    denominatorValue = denominatorFormatter(
      result.denominator ?? 0,
      formatterOptions,
    );
  }

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
            <div className="border-bottom row">
              <div className="mr-2">{numeratorText}</div>
              <div style={{ flex: 1 }} />
              <div>{numeratorValue}</div>
            </div>
            <div className="row">
              <div className="mr-2">{denominatorText}</div>
              <div style={{ flex: 1 }} />
              <div>{denominatorValue}</div>
            </div>
          </div>
          <div className="col-auto" style={{ fontSize: "2.5em" }}>
            {"="}
          </div>
          <div className="col-auto">
            <div style={{ fontSize: "2.5em" }}>
              {formatter(result.mean, formatterOptions)}
            </div>
            {metricType === "ratio" ? null : (
              <>
                {metricType === "proportion" || metricType === "retention"
                  ? "of"
                  : "per"}{" "}
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
  return LOOKBACK_DAY_OPTIONS.includes(lookbackDays)
    ? `${lookbackDays}`
    : `custom`;
}

function settingsMatch(
  settings: MetricAnalysisSettings,
  desiredSettings: CreateMetricAnalysisProps,
) {
  // skip strict date checking
  const fieldsThatCanDiffer = ["startDate", "endDate"];
  return Object.entries(settings).every(([key, value]) => {
    return (
      fieldsThatCanDiffer.includes(key) || isEqual(value, desiredSettings[key])
    );
  });
}

function isOutdated(
  factMetric: FactMetricInterface,
  analysis?: MetricAnalysisInterface | null,
): { outdated: boolean; reasons: string[] } {
  if (analysis && factMetric.dateUpdated > analysis.dateCreated) {
    return {
      outdated: true,
      reasons: ["The metric was updated since last analysis"],
    };
  }
  return {
    outdated: false,
    reasons: [],
  };
}

function getAnalysisSettingsForm(
  settings: MetricAnalysisSettings | undefined,
  userIdTypes: string[] | undefined,
) {
  return {
    userIdType: settings?.userIdType ?? userIdTypes?.[0] ?? "",
    lookbackSelected: settings
      ? getLookbackSelected(settings.lookbackDays)
      : "30",
    lookbackDays: settings?.lookbackDays ?? 30,
    populationType: settings?.populationType ?? "factTable",
    populationId: settings?.populationId ?? null,
    additionalNumeratorFilters: settings?.additionalNumeratorFilters,
    additionalDenominatorFilters: settings?.additionalDenominatorFilters,
  };
}

export type MetricAnalysisFormFields = {
  userIdType: string;

  lookbackSelected: string;
  lookbackDays: number;

  populationType: MetricAnalysisPopulationType;
  populationId: string | null;
  additionalNumeratorFilters?: string[];
  additionalDenominatorFilters?: string[];
};

interface MetricAnalysisProps {
  factMetric: FactMetricInterface;
  datasource: DataSourceInterfaceWithParams;
  outerClassName?: string;
  className?: string;
  northStarView?: boolean;
  experiments?: ExperimentInterfaceStringDates[];
  externalHover?: {
    hoverDate: number | null;
    onHoverCallback: (ret: { d: number | null }) => void;
  };
}

const MetricAnalysis: FC<MetricAnalysisProps> = ({
  factMetric,
  datasource,
  outerClassName,
  className,
  northStarView,
  experiments,
  externalHover,
}) => {
  const permissionsUtil = usePermissionsUtil();

  const { getFactTableById } = useDefinitions();
  const { apiCall } = useAuth();

  const storageKeyAvg = `metric_smoothBy_avg`; // to make metric-specific, include `${mid}`
  const storageKeySum = `metric_smoothBy_sum`;
  const [smoothByAvg, setSmoothByAvg] = useLocalStorage<"day" | "week">(
    storageKeyAvg,
    "day",
  );
  const [smoothBySum, setSmoothBySum] = useLocalStorage<"day" | "week">(
    storageKeySum,
    "day",
  );

  const [uniqueHoverDate, setUniqueHoverDate] = useState<number | null>(null);
  const onUniqueHoverCallback = (ret: { d: number | null }) => {
    setUniqueHoverDate(ret.d);
  };

  const { hoverDate, onHoverCallback } = externalHover
    ? externalHover
    : { hoverDate: uniqueHoverDate, onHoverCallback: onUniqueHoverCallback };

  const [error, setError] = useState<string | null>(null);

  const endOfToday = new Date();
  // use end of day to allow query caching to work within local working day
  endOfToday.setHours(23, 59, 59, 999);

  const { data, mutate } = useApi<{
    metricAnalysis: MetricAnalysisInterface | null;
  }>(`/metric-analysis/metric/${factMetric.id}`);

  const metricAnalysis = data?.metricAnalysis;
  const factTable = getFactTableById(factMetric.numerator.factTableId);
  // get latest full object or add reset to default?
  const { reset, watch, getValues, setValue, register } =
    useForm<MetricAnalysisFormFields>({
      defaultValues: getAnalysisSettingsForm(
        metricAnalysis?.settings,
        factTable?.userIdTypes,
      ),
    });
  const populationValue: string | undefined = watch("populationType");

  // TODO better way to populate form/fields than the following
  const { queries, queryStatus } = useMemo(() => {
    reset(
      getAnalysisSettingsForm(metricAnalysis?.settings, factTable?.userIdTypes),
    );
    const queries = metricAnalysis?.queries ?? [];
    const { status: queryStatus } = getQueryStatus(
      queries,
      metricAnalysis?.error,
    );
    return {
      queries,
      queryStatus,
    };
  }, [metricAnalysis, reset, factTable]);

  const formatter = getExperimentMetricFormatter(factMetric, getFactTableById);

  const numeratorFormatter = getColumnRefFormatter(
    factMetric.numerator,
    getFactTableById,
  );
  const denominatorFormatter = factMetric.denominator
    ? getColumnRefFormatter(factMetric.denominator, getFactTableById)
    : undefined;

  const canRunMetricQuery =
    datasource && permissionsUtil.canRunMetricQueries(datasource);

  const desiredSettings = getMetricAnalysisProps({
    id: factMetric.id,
    values: getValues(),
    endOfToday,
  });
  const matchedSettings =
    metricAnalysis && settingsMatch(metricAnalysis.settings, desiredSettings);

  const outdated = isOutdated(factMetric, metricAnalysis);
  return (
    <div className={`mb-4 ${outerClassName || ""}`}>
      <div className={`appbox p-3 mb-3 ${className || ""}`}>
        {factMetric.metricType === "quantile" ? (
          <Callout status="warning" mt="2" mb="2">
            Standalone metric analysis not available for quantile metrics.
          </Callout>
        ) : (
          <>
            <div
              className="d-flex flex-wrap mb-3 align-items-center"
              style={{ gap: "1rem 0", margin: "0 -0.5rem" }}
            >
              <div className="col-auto form-inline pr-5">
                <div>
                  <div className="uppercase-title text-muted">Date Range</div>
                  <div className="row nowrap align-items-center">
                    <div className="col-auto">
                      <SelectField
                        containerClassName={"select-dropdown-underline"}
                        options={[
                          ...LOOKBACK_DAY_OPTIONS.map((days) => ({
                            label: `Last ${days} Days`,
                            value: `${days}`,
                          })),
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
                      <div className="col-auto" style={{ marginTop: "-10px" }}>
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
                  setValue={(v) => {
                    // reset population chooser
                    // if id type changes as possible joins
                    // may have changed
                    if (v !== watch("userIdType")) {
                      setValue("populationType", "factTable");
                      setValue("populationId", null);
                    }
                    setValue("userIdType", v);
                  }}
                  factTableId={factMetric.numerator.factTableId}
                />
              </div>
              <div className="col-auto form-inline pr-5">
                <PopulationChooser
                  value={populationValue ?? "factTable"}
                  setValue={(v, populationId) => {
                    setValue(
                      "populationType",
                      v as MetricAnalysisPopulationType,
                    );
                    setValue("populationId", populationId);
                  }}
                  userIdType={watch("userIdType")}
                  datasourceId={factMetric.datasource}
                />
              </div>
              <div style={{ flex: 1 }} />
              {queries.length > 0 &&
                queryStatus !== "running" &&
                matchedSettings && (
                  <div className="col-auto">
                    {outdated.outdated ? (
                      <OutdatedBadge reasons={outdated.reasons} />
                    ) : (
                      <QueriesLastRun
                        status={queryStatus}
                        dateCreated={metricAnalysis?.dateCreated}
                      />
                    )}
                  </div>
                )}
              {queries.length > 0 &&
              ["failed", "partially-succeeded"].includes(queryStatus) ? (
                <ViewAsyncQueriesButton
                  queries={queries.map((q) => q.query)}
                  display={null}
                  color={clsx(
                    {
                      "outline-danger": [
                        "failed",
                        "partially-succeeded",
                      ].includes(queryStatus),
                    },
                    " ",
                  )}
                  icon={
                    <span
                      className="position-relative pr-2"
                      style={{ marginRight: 6 }}
                    >
                      <span className="text-main">
                        <FaDatabase />
                      </span>
                      <FaExclamationTriangle
                        className="position-absolute"
                        style={{
                          top: -6,
                          right: -4,
                        }}
                      />
                    </span>
                  }
                  error={metricAnalysis?.error}
                  condensed={true}
                  status={queryStatus}
                />
              ) : null}
              <div className="col-auto">
                {canRunMetricQuery && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setError(null);
                      const data = getMetricAnalysisProps({
                        id: factMetric.id,
                        values: getValues(),
                        endOfToday,
                      });
                      try {
                        track("MetricAnalysis_Update", {
                          type: factMetric.metricType,
                          populationType: data.populationType,
                          days: data.lookbackDays,
                        });
                        await apiCall(`/metric-analysis`, {
                          method: "POST",
                          body: JSON.stringify(data),
                        });
                        mutate();
                      } catch (e) {
                        setError(e.message);
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
              <MetricAnalysisMoreMenu
                metricAnalysis={metricAnalysis}
                forceRefresh={async () => {
                  try {
                    setError(null);
                    const data: CreateMetricAnalysisProps = {
                      ...getMetricAnalysisProps({
                        id: factMetric.id,
                        values: getValues(),
                        endOfToday,
                      }),
                      force: true,
                    };
                    track("MetricAnalysis_ForceUpdate", {
                      type: factMetric.metricType,
                      populationType: data.populationType,
                      days: data.lookbackDays,
                    });
                    await apiCall(`/metric-analysis`, {
                      method: "POST",
                      body: JSON.stringify(data),
                    });
                    mutate();
                  } catch (e) {
                    setError(e.message);
                  }
                }}
                canRunMetricQuery={canRunMetricQuery}
              />
            </div>

            {factMetric.metricType === "retention" ? (
              <Callout status="info" mt="2" mb="2">
                {
                  "Retention metrics analyzed here (outside the context of an experiment) have no clear baseline to use and will be treated as regular proportion metrics."
                }
              </Callout>
            ) : null}
            {error || metricAnalysis?.error ? (
              <Callout status="error" mt="2" mb="2">
                {`Analysis error: ${error || metricAnalysis?.error}`}
              </Callout>
            ) : null}
            {metricAnalysis ? (
              <>
                {!matchedSettings ? (
                  <Callout status="warning" mt="2" mb="2">
                    <span style={{ fontSize: "1.2em" }}>
                      Analysis settings changed. Update results or{" "}
                      <a
                        role="button"
                        className="btn-link"
                        onClick={(e) => {
                          e.preventDefault();
                          setError(null);
                          track("MetricAnalysis_ResetSettings");
                          reset(
                            getAnalysisSettingsForm(
                              metricAnalysis?.settings,
                              factTable?.userIdTypes,
                            ),
                          );
                        }}
                      >
                        return to latest analysis
                      </a>
                      .
                    </span>
                  </Callout>
                ) : (
                  <>
                    {metricAnalysis?.result && !northStarView && (
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
                          <div className="mt-3">
                            <h4 className="mb-1 mt-1">
                              {isBinomialMetric(factMetric)
                                ? "Conversions"
                                : "Metric Value"}{" "}
                              Over Time
                            </h4>
                          </div>

                          {!isBinomialMetric(factMetric) && (
                            <>
                              <div className="row mt-4 mb-1">
                                <div className="col">
                                  <Tooltip
                                    body={
                                      <>
                                        {factMetric.metricType === "ratio" ? (
                                          <>
                                            <p>
                                              {`This figure shows the numerator total
                                      on a day divided by denominator total on a day${
                                        metricAnalysis.settings
                                          .populationType != "factTable"
                                          ? ` for units (e.g. users) that appear in the population at
                                          any time in the selected window.`
                                          : `.`
                                      }`}
                                            </p>
                                            <p>
                                              The standard deviation shows the
                                              spread of the daily metric values.
                                            </p>
                                          </>
                                        ) : (
                                          <>
                                            <p>
                                              {`This figure shows the average metric value
                                      on a day divided by number of unique units
                                      (e.g. users) that appear in the metric source
                                      on that day${
                                        metricAnalysis.settings
                                          .populationType != "factTable"
                                          ? ` and in the population at any time in the selected window.`
                                          : ``
                                      }`}
                                            </p>
                                            <p>
                                              The standard deviation shows the
                                              spread of the daily user metric
                                              values.
                                            </p>
                                          </>
                                        )}
                                        <p>
                                          When smoothing is turned on, we simply
                                          average values and standard deviations
                                          over the 7 trailing days (including
                                          the selected day).
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
                                    <Switch
                                      value={smoothByAvg === "week"}
                                      onChange={() =>
                                        setSmoothByAvg(
                                          smoothByAvg === "week"
                                            ? "day"
                                            : "week",
                                        )
                                      }
                                      id="toggle-group-by-avg"
                                      label="Smoothing"
                                      description="7 day trailing"
                                    />
                                  </div>
                                </div>
                              </div>
                              <DateGraph
                                type="count"
                                method="avg"
                                dates={metricAnalysis.result.dates.map((d) => {
                                  return {
                                    d: d.date,
                                    v: d.mean,
                                    s: d.stddev,
                                    c: d.units,
                                  };
                                })}
                                showStdDev={!northStarView}
                                experiments={experiments}
                                smoothBy={smoothByAvg}
                                formatter={formatter}
                                onHover={onHoverCallback}
                                hoverDate={hoverDate}
                              />
                            </>
                          )}

                          {factMetric.metricType !== "ratio" &&
                          !(northStarView && !isBinomialMetric(factMetric)) ? (
                            <>
                              <div className="row mt-4 mb-1">
                                <div className="col">
                                  <Tooltip
                                    body={
                                      <>
                                        <p>
                                          {`This figure shows the ${
                                            !isBinomialMetric(factMetric)
                                              ? `daily sum of values in the metric source`
                                              : `daily count of units (e.g. users) that fit
                                        the metric definition`
                                          }${
                                            metricAnalysis.settings
                                              .populationType != "factTable"
                                              ? ` that also appear in the population at
                                          any time in the selected window`
                                              : ``
                                          }.`}
                                        </p>
                                        <p>
                                          {`When smoothing is turned on, we simply
                                      average ${
                                        !isBinomialMetric(factMetric)
                                          ? "values"
                                          : "counts"
                                      } over the 7 trailing
                                      days (including the selected day).`}
                                        </p>
                                      </>
                                    }
                                  >
                                    <strong className="ml-4 align-bottom">
                                      Daily{" "}
                                      {!isBinomialMetric(factMetric)
                                        ? "Sum"
                                        : "Count"}{" "}
                                      <FaQuestionCircle />
                                    </strong>
                                  </Tooltip>
                                </div>
                                <div className="col">
                                  <div className="float-right mr-2">
                                    <Switch
                                      value={smoothBySum === "week"}
                                      onChange={() =>
                                        setSmoothBySum(
                                          smoothBySum === "week"
                                            ? "day"
                                            : "week",
                                        )
                                      }
                                      id="toggle-group-by-sum"
                                      label="Smoothing"
                                      description="7 day trailing"
                                    />
                                  </div>
                                </div>
                              </div>
                              <DateGraph
                                type={
                                  isBinomialMetric(factMetric)
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
                                showStdDev={!northStarView}
                                experiments={experiments}
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
                      !isBinomialMetric(factMetric) &&
                      !northStarView && (
                        <div className="mt-5 mb-2">
                          <h4 className="align-bottom">
                            Histogram of Metric Value by{" "}
                            <code>{metricAnalysis.settings.userIdType}</code>{" "}
                            Totals
                          </h4>
                          <HistogramGraph
                            data={metricAnalysis.result.histogram}
                            formatter={formatter}
                          />
                        </div>
                      )}
                  </>
                )}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};

export default MetricAnalysis;
