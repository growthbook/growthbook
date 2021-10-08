import {
  DataSourceProperties,
  DataSourceSettings,
} from "../../types/datasource";
import { DimensionInterface } from "../../types/dimension";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { MixpanelConnectionParams } from "../../types/integrations/mixpanel";
import { MetricInterface } from "../../types/metric";
import { SegmentInterface } from "../../types/segment";
import { decryptDataSourceParams } from "../services/datasource";
import { formatQuery, runQuery } from "../services/mixpanel";
import {
  ExperimentMetricQueryResponse,
  ExperimentQueryResponses,
  ExperimentUsersQueryResponse,
  ImpactEstimationResult,
  MetricValueParams,
  MetricValueQueryResponse,
  MetricValueQueryResponseRow,
  PastExperimentResponse,
  SourceIntegrationInterface,
  UsersQueryParams,
  UsersQueryResponse,
} from "../types/Integration";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "../util/secrets";
import {
  processMetricValueQueryResponse,
  processUsersQueryResponse,
} from "../services/queries";

const percentileNumbers = [
  0.01,
  0.05,
  0.1,
  0.2,
  0.3,
  0.4,
  0.5,
  0.6,
  0.7,
  0.8,
  0.9,
  0.95,
  0.99,
];

export default class Mixpanel implements SourceIntegrationInterface {
  datasource: string;
  params: MixpanelConnectionParams;
  organization: string;
  settings: DataSourceSettings;
  constructor(encryptedParams: string, settings: DataSourceSettings) {
    this.params = decryptDataSourceParams<MixpanelConnectionParams>(
      encryptedParams
    );
    this.settings = {
      variationIdFormat: "index",
      events: {
        experimentEvent: "$experiment_started",
        experimentIdProperty: "Experiment name",
        variationIdProperty: "Variant name",
        pageviewEvent: "Page view",
        urlProperty: "$current_url",
        ...settings.events,
      },
    };
  }
  getExperimentUsersQuery(): string {
    throw new Error("Method not implemented.");
  }
  getExperimentMetricQuery(): string {
    throw new Error("Method not implemented.");
  }
  runExperimentUsersQuery(): Promise<ExperimentUsersQueryResponse> {
    throw new Error("Method not implemented.");
  }
  runExperimentMetricQuery(): Promise<ExperimentMetricQueryResponse> {
    throw new Error("Method not implemented.");
  }
  getExperimentResultsQuery(
    experiment: ExperimentInterface,
    phase: ExperimentPhase,
    metrics: MetricInterface[],
    activationMetric: MetricInterface,
    dimension: DimensionInterface
  ): string {
    const hasEarlyStartMetrics = metrics.filter((m) => m.earlyStart).length > 0;

    const onActivate = `
        ${activationMetric ? "state.activated = true;" : ""}
        state.start = e.time;
        ${
          hasEarlyStartMetrics
            ? ` // Process queued values
        state.queuedEvents.forEach((q) => {
          // Make sure event happened during the same session (within 30 minutes)
          if(state.start - q.time > ${30 * 60 * 1000}) return;
          ${metrics
            .filter((m) => m.earlyStart)
            .map(
              (metric, i) => `// Metric - ${metric.name}
          if(${this.getValidMetricCondition(metric, "q")}) {
            ${this.getMetricAggregationCode(
              metric,
              this.getMetricValueCode(metric, "q"),
              `state.m${i}`
            )}
          }`
            )
            .join("\n")}
        });
        state.queuedEvents = [];`
            : ""
        }`;

    const query = formatQuery(`// Experiment results - ${experiment.name}
        const metrics = ${JSON.stringify(
          metrics.map(({ id, name }) => ({ id, name })),
          null,
          2
        )};
  
        return ${this.getEvents(
          phase.dateStarted,
          phase.dateEnded || new Date()
        )}
        .filter(function(e) {
          if(${this.getValidExperimentCondition(
            experiment.trackingKey,
            "e",
            phase.dateStarted,
            phase.dateEnded
          )}) return true;
          ${
            activationMetric
              ? `if(${this.getValidMetricCondition(
                  activationMetric
                )}) return true;`
              : ""
          }
          ${metrics
            .map(
              (metric) => `// Metric - ${metric.name}
          if(${this.getValidMetricCondition(metric)}) return true;`
            )
            .join("\n")}
          return false;
        })
        // Metric value per user
        .groupByUser(function(state, events) {
          state = state || {
            inExperiment: false,
            ${dimension ? "dimension: null," : ""}
            ${activationMetric ? "activated: false," : ""}
            start: null,
            variation: null,
            ${metrics.map((m, i) => `m${i}: null,`).join("\n")} ${
      hasEarlyStartMetrics ? "queuedEvents: []" : ""
    }
          };
          for(var i=0; i<events.length; i++) {
            const e = events[i];
            // User is put into the experiment
            if(!state.inExperiment && ${this.getValidExperimentCondition(
              experiment.trackingKey,
              "e",
              phase.dateStarted,
              phase.dateEnded
            )}) {
              state.inExperiment = true;
              state.variation = ${this.getPropertyColumn(
                this.settings.events.variationIdProperty || "Variant name",
                "e"
              )};
              ${
                dimension
                  ? `state.dimension = ${this.getPropertyColumn(
                      dimension.sql,
                      "e"
                    )} || null;`
                  : ""
              }
              ${activationMetric ? "" : onActivate}
              continue;
            }
  
            // Not in the experiment yet
            if(!state.inExperiment) {
              ${hasEarlyStartMetrics ? "state.queuedEvents.push(e);" : ""}
              continue;
            }
            ${
              activationMetric
                ? `
              // Not activated yet
              if(!state.activated) {
                // Does this event activate it? (Metric - ${
                  activationMetric.name
                })
                if(${this.getValidMetricCondition(activationMetric)}) {
                  ${onActivate}
                }
                else {
                  ${hasEarlyStartMetrics ? "state.queuedEvents.push(e);" : ""}
                  continue;
                }
              }
            `
                : ""
            }
  
            ${metrics
              .map(
                (metric, i) => `// Metric - ${metric.name}
              if(${this.getValidMetricCondition(metric, "e", "state.start")}) {
                ${this.getMetricAggregationCode(
                  metric,
                  this.getMetricValueCode(metric),
                  `state.m${i}`
                )}
              }
            `
              )
              .join("")}
          }
          return state;
        })
        // Remove users that are not in the experiment
        .filter(function(ev) {
          if(!ev.value.inExperiment) return false;
          if(ev.value.variation === null || ev.value.variation === undefined) return false;
          ${activationMetric ? "if(!ev.value.activated) return false;" : ""}
          return true;
        })
        // One group per experiment variation${
          dimension ? "/dimension" : ""
        } with summary data
        .groupBy(["value.variation"${dimension ? ', "value.dimension"' : ""}], [
          // Total users in the group
          mixpanel.reducer.count(),
          ${metrics
            .map(
              (metric, i) => `// Metric - ${metric.name}
          mixpanel.reducer.numeric_summary('value.m${i}'),`
            )
            .join("\n")}
        ])
        // Convert to an object that's easier to work with
        .map(row => {
          const ret = {
            variation: row.key[0],
            dimension: ${dimension ? "row.key[1] || ''" : "''"},
            users: row.value[0],
            metrics: [],
          };
          for(let i=1; i<row.value.length; i++) {
            ret.metrics.push({
              id: metrics[i-1].id,
              name: metrics[i-1].name,
              count: row.value[i].count,
              mean: row.value[i].avg,
              stddev: row.value[i].stddev,
            });
          }
          return ret;
        });
      `);

    return query;
  }
  async getExperimentResults(
    experiment: ExperimentInterface,
    phase: ExperimentPhase,
    metrics: MetricInterface[],
    activationMetric: MetricInterface,
    dimension: DimensionInterface
  ): Promise<ExperimentQueryResponses> {
    const query = this.getExperimentResultsQuery(
      experiment,
      phase,
      metrics,
      activationMetric,
      dimension
    );

    const result = await runQuery<
      {
        variation: string;
        dimension: string;
        users: number;
        metrics: {
          id: string;
          name: string;
          count: number;
          mean: number;
          stddev: number;
        }[];
      }[]
    >(this.params, query);

    return result.map(({ variation, dimension, users, metrics }) => {
      return {
        dimension,
        variation,
        users,
        metrics: metrics.map((m) => {
          return {
            metric: m.id,
            count: m.count,
            mean: m.mean,
            stddev: m.stddev,
          };
        }),
      };
    });
  }
  async testConnection(): Promise<boolean> {
    const today = new Date().toISOString().substr(0, 10);
    const query = formatQuery(`
      return Events({
        from_date: "${today}",
        to_date: "${today}"
      })
      .reduce(mixpanel.reducer.count());
    `);
    await runQuery(this.params, query);
    return true;
  }
  getSourceProperties(): DataSourceProperties {
    return {
      includeInConfig: true,
      readonlyFields: [],
      type: "api",
      queryLanguage: "javascript",
      metricCaps: true,
      separateExperimentResultQueries: false,
    };
  }

  async getImpactEstimation(
    urlRegex: string,
    metric: MetricInterface,
    segment?: SegmentInterface
  ): Promise<ImpactEstimationResult> {
    const numDays = 30;

    const conversionWindowHours =
      metric.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS;

    // Ignore last X hours of data since we need to give people time to convert
    const end = new Date();
    end.setHours(end.getHours() - conversionWindowHours);
    const start = new Date();
    start.setDate(start.getDate() - numDays);
    start.setHours(start.getHours() - conversionWindowHours);

    const baseSettings = {
      from: start,
      to: end,
      includeByDate: false,
      userIdType: metric.userIdType,
      conversionWindowHours,
    };

    const usersQuery = this.getUsersQuery({
      ...baseSettings,
      name: "Traffic - Selected Pages and Segment",
      urlRegex,
      segmentQuery: segment?.sql || null,
      segmentName: segment?.name,
    });
    const metricQuery = this.getMetricValueQuery({
      ...baseSettings,
      name: "Metric Value - Entire Site",
      metric,
      includePercentiles: false,
    });
    const valueQuery = this.getMetricValueQuery({
      ...baseSettings,
      name: "Metric Value - Selected Pages and Segment",
      metric,
      includePercentiles: false,
      urlRegex,
      segmentQuery: segment?.sql || null,
      segmentName: segment?.name,
    });

    const [
      usersResponse,
      metricTotalResponse,
      valueResponse,
    ] = await Promise.all([
      this.runUsersQuery(usersQuery),
      this.runMetricValueQuery(metricQuery),
      this.runMetricValueQuery(valueQuery),
    ]);

    const users = processUsersQueryResponse(usersResponse);
    const metricTotal = processMetricValueQueryResponse(metricTotalResponse);
    const value = processMetricValueQueryResponse(valueResponse);

    const formatted =
      [usersQuery, metricQuery, valueQuery]
        .map((code) => formatQuery(code))
        .join("\n\n\n") + ";";

    if (users && metricTotal && value) {
      return {
        query: formatted,
        users: users.users / numDays || 0,
        value: (value.count * value.mean) / numDays || 0,
        metricTotal: (metricTotal.count * metricTotal.mean) / numDays || 0,
      };
    }

    return {
      query: formatted,
      users: 0,
      value: 0,
      metricTotal: 0,
    };
  }

  getUsersQuery(params: UsersQueryParams): string {
    return formatQuery(`
      // ${params.name} - Number of Users
      return ${this.getEvents(params.from, params.to)}
        .filter(function(event) {
          ${
            params.segmentQuery
              ? `// Limit to Segment - ${params.segmentName}
          if(!(${params.segmentQuery})) return false;`
              : ""
          }
          // Valid page view
          if(${this.getValidPageCondition(params.urlRegex)}) return true;
          return false;
        })
        // One event per user
        .groupByUser(mixpanel.reducer.min("time"))
        .reduce([
          // Overall count of users
          mixpanel.reducer.count()${
            params.includeByDate
              ? `,
          // Count of users per day
          (prevs, events) => {
            const dates = {};
            prevs.forEach(prev => {
              prev.dates.forEach(d=>dates[d.date] = (dates[d.date] || 0) + d.users)
            });
            events.forEach(e=>{
              const date = (new Date(e.value)).toISOString().substr(0,10);
              dates[date] = (dates[date] || 0) + 1;
            });

            return {
              type: "byDate",
              dates: Object.keys(dates).map(d => ({
                date: d,
                users: dates[d]
              }))
            };
          }`
              : ""
          }
        ])
        // Transform into easy-to-use objects
        .map(vals => vals.map(val => !val.type ? {type:"overall",users:val} : val))
    `);
  }

  getMetricValueQuery(params: MetricValueParams): string {
    const metric = params.metric;

    return formatQuery(`
      // ${params.name} - Metric value (${metric.name})
      return ${this.getEvents(params.from, params.to)}
        .filter(function(event) {
          ${
            params.segmentQuery
              ? `// Limit to Segment - ${params.segmentName}
          if(!(${params.segmentQuery})) return false;`
              : ""
          }
          // Valid page view
          if(${this.getValidPageCondition(params.urlRegex)}) return true;
          if(${this.getValidMetricCondition(metric, "event")}) return true;
          return false;
        })
        // Metric value per user
        .groupByUser(function(state, events) {
          state = state || {firstPageView: false, metricValue: null, queuedValues: []};
          for(var i=0; i<events.length; i++) {
            if(!state.firstPageView && ${this.getValidPageCondition(
              params.urlRegex,
              "events[i]"
            )}) {
              state.firstPageView = events[i].time;
              // Process queued values
              state.queuedValues.forEach((q) => {
                ${this.getConversionWindowCheck(
                  params.metric.conversionWindowHours,
                  "state.firstPageView",
                  "q.time",
                  "return"
                )}
                ${this.getMetricAggregationCode(metric, "q.value")}
              });
              state.queuedValues = [];
              ${metric.earlyStart ? "" : "continue;"}
            }
            if(${this.getValidMetricCondition(metric, "events[i]")}) {
              if(!state.firstPageView) {
                ${
                  metric.earlyStart
                    ? `state.queuedValues.push({value: ${this.getMetricValueCode(
                        metric
                      )}, time: events[i].time});`
                    : ""
                }
                continue;
              }
              ${this.getConversionWindowCheck(
                params.metric.conversionWindowHours,
                "state.firstPageView"
              )}
              ${this.getMetricAggregationCode(
                metric,
                this.getMetricValueCode(metric)
              )}
            }
          }
          return state;
        })
        // Remove users that did not convert
        .filter(function(ev) {
          return ev.value.firstPageView && ev.value.metricValue !== null;
        })
        .reduce([
          // Overall summary metrics
          mixpanel.reducer.numeric_summary('value.metricValue')${
            params.includeByDate
              ? `,
            // Summary metrics by date
            (prevs, events) => {
              const dates = {};
              prevs.forEach(prev => {
                prev.dates.forEach(d=>{
                  dates[d.date] = dates[d.date] || {count:0, sum:0};
                  dates[d.date].count += d.count;
                  dates[d.date].sum += d.sum;
                })
              });
              events.forEach(e=>{
                const date = (new Date(e.value.firstPageView)).toISOString().substr(0,10);
                dates[date] = dates[date] || {count:0, sum:0};
                dates[date].count++;
                dates[date].sum += e.value.metricValue;
              });

              return {
                type: "byDate",
                dates: Object.keys(dates).map(d => ({
                  date: d,
                  ...dates[d]
                }))
              };
            }`
              : ""
          }${
      params.includePercentiles && metric.type !== "binomial"
        ? `,
          // Percentile breakdown
          mixpanel.reducer.numeric_percentiles(
            "value.metricValue",
            ${JSON.stringify(percentileNumbers.map((n) => n * 100))}
          )`
        : ""
    }
        ])
        // Transform into easy-to-use objects
        .map(vals => vals.map(val => {
          if(val[0] && val[0].percentile) return {type: "percentile",percentiles:val};
          if(val.count) return {type: "overall", ...val};
          return val;
        }));
    `);
  }
  async runUsersQuery(query: string): Promise<UsersQueryResponse> {
    const rows = await runQuery<
      [
        (
          | {
              type: "byDate";
              dates: {
                date: string;
                users: number;
              }[];
            }
          | {
              type: "overall";
              users: number;
            }
        )[]
      ]
    >(this.params, query);

    const result: UsersQueryResponse = [];

    rows &&
      rows[0] &&
      rows[0].forEach((row) => {
        if (row.type === "overall") {
          result.push({
            date: "",
            users: row.users,
          });
        } else if (row.type === "byDate") {
          row.dates.sort((a, b) => a.date.localeCompare(b.date));
          row.dates.forEach((d) => {
            result.push({
              date: d.date,
              users: d.users,
            });
          });
        }
      });

    return result;
  }
  async runMetricValueQuery(query: string): Promise<MetricValueQueryResponse> {
    const rows = await runQuery<
      [
        (
          | {
              type: "byDate";
              dates: {
                date: string;
                count: number;
                sum: number;
              }[];
            }
          | {
              type: "overall";
              count: number;
              sum: number;
              avg: number;
              stddev: number;
            }
          | {
              type: "percentile";
              percentiles: {
                percentile: number;
                value: number;
              }[];
            }
        )[]
      ]
    >(this.params, query);

    const result: MetricValueQueryResponse = [];
    const overall: MetricValueQueryResponseRow = {
      date: "",
      mean: 0,
      stddev: 0,
      count: 0,
    };

    rows &&
      rows[0] &&
      rows[0].forEach((row) => {
        if (row.type === "overall") {
          overall.count = row.count;
          overall.mean = row.avg;
          overall.stddev = row.stddev;
        } else if (row.type === "byDate") {
          row.dates.sort((a, b) => a.date.localeCompare(b.date));
          row.dates.forEach(({ date, count, sum }) => {
            result.push({
              date,
              count,
              mean: count > 0 ? sum / count : 0,
              stddev: 0,
            });
          });
        } else if (row.type === "percentile") {
          row.percentiles.forEach(({ percentile, value }) => {
            overall["p" + percentile] = value;
          });
        }
      });

    return [overall, ...result];
  }
  getPastExperimentQuery(): string {
    throw new Error("Method not implemented.");
  }
  async runPastExperimentQuery(query: string): Promise<PastExperimentResponse> {
    console.log(query);
    throw new Error("Method not implemented.");
  }
  getSensitiveParamKeys(): string[] {
    return ["secret"];
  }

  private getMetricValueCode(
    metric: MetricInterface,
    eventVar: string = "events[i]"
  ) {
    return metric.column
      ? this.getPropertyColumn(metric.column, eventVar) + "||0"
      : "1";
  }
  private getMetricAggregationCode(
    metric: MetricInterface,
    value: string,
    destVar: string = "state.metricValue"
  ) {
    const cap = metric.type === "binomial" ? 1 : metric.cap;
    return `${destVar} = ${
      cap ? `Math.min(${cap},` : ""
    }(${destVar} || 0) + ${value}${cap ? ")" : ""};`;
  }
  private getConversionWindowCheck(
    conversionWindowHours: number = DEFAULT_CONVERSION_WINDOW_HOURS,
    startVar: string,
    eventTimeVar: string = "events[i].time",
    onFail: string = "continue;"
  ) {
    return `// Check conversion window (${conversionWindowHours} hours)
    if(${eventTimeVar} - ${startVar} > ${
      conversionWindowHours * 60 * 60 * 1000
    }) {
      ${onFail}
    }`;
  }

  private getEvents(from: Date, to: Date) {
    return `Events({from_date: "${from
      .toISOString()
      .substr(0, 10)}", to_date: "${to.toISOString().substr(0, 10)}"})`;
  }
  private getValidPageCondition(urlRegex?: string, event: string = "event") {
    if (urlRegex && urlRegex !== ".*") {
      const urlCol = this.settings.events.urlProperty;
      return `${event}.name === "${
        this.settings.events.pageviewEvent || "Page view"
      }" && ${event}.properties["${urlCol}"] && ${event}.properties["${urlCol}"].match(/${urlRegex}/)`;
    } else {
      return `${event}.name === "${
        this.settings.events.pageviewEvent || "Page view"
      }"`;
    }
  }
  private getPropertyColumn(col: string, event: string = "e") {
    const colAccess = col.split(".").map((part) => {
      if (part.substr(0, 1) !== "[") return `["${part}"]`;
      return part;
    });
    return `${event}.properties${colAccess}`;
  }
  private getValidMetricCondition(
    metric: MetricInterface,
    event: string = "e",
    conversionWindowStart: string = ""
  ) {
    const checks: string[] = [];
    // Right event name
    checks.push(`${event}.name === "${metric.table}"`);

    // Within conversion window
    if (conversionWindowStart) {
      checks.push(
        `${event}.time - ${conversionWindowStart} < ${
          (metric.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS) *
          60 *
          60 *
          1000
        }`
      );
    }

    if (metric.conditions) {
      metric.conditions.forEach((cond) => {
        const check = ["~", "!~"].includes(cond.operator)
          ? `.match(/${cond.value}/)`
          : ` ${cond.operator} ${JSON.stringify(cond.value)}`;

        checks.push(
          `${cond.operator === "!~" ? "!" : ""}${this.getPropertyColumn(
            cond.column,
            event
          )}${check}`
        );
      });
    }

    return checks.join(" && ");
  }
  private getValidExperimentCondition(
    id: string,
    event: string = "e",
    start: Date,
    end?: Date
  ) {
    const experimentEvent =
      this.settings.events.experimentEvent || "$experiment_started";
    const experimentIdCol = this.getPropertyColumn(
      this.settings.events.experimentIdProperty || "Experiment name",
      event
    );
    let timeCheck = `${event}.time >= ${start.getTime()}`;
    if (end) {
      timeCheck += ` && ${event}.time <= ${end.getTime()}`;
    }
    return `${event}.name === "${experimentEvent}" && ${experimentIdCol} === "${id}" && ${timeCheck}`;
  }
}
