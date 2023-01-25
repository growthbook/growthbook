import {
  DataSourceProperties,
  DataSourceSettings,
} from "../../types/datasource";
import { DimensionInterface } from "../../types/dimension";
import { ExperimentInterface, ExperimentPhase } from "../../types/experiment";
import { MixpanelConnectionParams } from "../../types/integrations/mixpanel";
import { MetricInterface } from "../../types/metric";
import { decryptDataSourceParams } from "../services/datasource";
import { formatQuery, runQuery } from "../services/mixpanel";
import {
  ExperimentMetricQueryResponse,
  ExperimentQueryResponses,
  MetricValueParams,
  MetricValueQueryResponse,
  MetricValueQueryResponseRow,
  PastExperimentResponse,
  SourceIntegrationInterface,
} from "../types/Integration";
import { DEFAULT_CONVERSION_WINDOW_HOURS } from "../util/secrets";
import {
  conditionToJavascript,
  getAggregateFunctions,
  getMixpanelPropertyColumn,
} from "../util/mixpanel";
import { replaceSQLVars } from "../util/sql";

export default class Mixpanel implements SourceIntegrationInterface {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  datasource: string;
  params: MixpanelConnectionParams;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  organization: string;
  settings: DataSourceSettings;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  decryptionError: boolean;
  constructor(encryptedParams: string, settings: DataSourceSettings) {
    try {
      this.params = decryptDataSourceParams<MixpanelConnectionParams>(
        encryptedParams
      );
    } catch (e) {
      this.params = { projectId: "", secret: "", username: "" };
      this.decryptionError = true;
    }
    this.settings = {
      events: {
        experimentEvent: "$experiment_started",
        experimentIdProperty: "Experiment name",
        variationIdProperty: "Variant name",
        ...settings.events,
      },
    };
  }
  getExperimentMetricQuery(): string {
    throw new Error("Method not implemented.");
  }
  runExperimentMetricQuery(): Promise<ExperimentMetricQueryResponse> {
    throw new Error("Method not implemented.");
  }

  private getMetricAggregationExpression(metric: MetricInterface) {
    if (metric.aggregation) {
      return `${metric.aggregation}`;
    }
    if (metric.type === "count" && !metric.column) {
      return "values.length";
    }
    return `sum(values)`;
  }
  private aggregateMetricValues(metric: MetricInterface, destVar: string) {
    if (metric.type === "binomial") {
      return `// Metric - ${metric.name}
      ${destVar} = ${destVar}.length ? 1 : 0;`;
    }

    return `// Metric - ${metric.name}
    ${destVar} = !${destVar}.length ? 0 : (
      (values => ${this.getMetricAggregationExpression(metric)})(${destVar})
    );${
      metric.cap && metric.cap > 0
        ? `\n${destVar} = ${destVar} && Math.min(${destVar}, ${metric.cap});`
        : ""
    }
    `;
  }

  getExperimentResultsQuery(
    experiment: ExperimentInterface,
    phase: ExperimentPhase,
    metrics: MetricInterface[],
    activationMetric: MetricInterface,
    dimension: DimensionInterface
  ): string {
    const hasEarlyStartMetrics =
      metrics.filter(
        (m) => m.conversionDelayHours && m.conversionDelayHours < 0
      ).length > 0;

    const onActivate = `
        ${activationMetric ? "state.activated = true;" : ""}
        state.start = event.time;
        ${
          hasEarlyStartMetrics
            ? ` // Process queued values
        state.queuedEvents.forEach((event) => {
          ${metrics
            .filter((m) => m.conversionDelayHours && m.conversionDelayHours < 0)
            .map(
              (metric, i) => `// Metric - ${metric.name}
          if(isMetric${i}(event) && event.time - state.start > ${
                (metric.conversionDelayHours || 0) * 60 * 60 * 1000
              }) {
            state.m${i}.push(${this.getMetricValueExpression(metric.column)});
          }`
            )
            .join("\n")}
        });
        state.queuedEvents = [];`
            : ""
        }`;

    const query = formatQuery(`${this.getMathHelperFunctions()}
        // Experiment exposure event
        function isExposureEvent(event) {
          return ${this.getValidExperimentCondition(
            experiment.trackingKey,
            phase.dateStarted,
            phase.dateEnded
          )};
        }
        ${
          activationMetric
            ? this.getMetricFunction(activationMetric, "ActivationMetric")
            : ""
        }
        ${metrics
          .map((m, i) => this.getMetricFunction(m, `Metric${i}`))
          .join("")}

        return ${this.getEvents(
          phase.dateStarted,
          phase.dateEnded || new Date(),
          [
            ...metrics.map((m) => m.table),
            activationMetric?.table,
            this.getExperimentEventName(),
          ]
        )}
        .filter(function(event) {
          // Experiment exposure event
          if(isExposureEvent(event)) return true;
          ${
            activationMetric
              ? `// ${activationMetric.name}
              if(isActivationMetric(event)) return true;`
              : ""
          }
          ${metrics
            .map(
              (metric, i) => `// ${metric.name}
          if(isMetric${i}(event)) return true;`
            )
            .join("\n")}
          // Otherwise, ignore the event
          return false;
        })
        // Array of metric values for each user
        .groupByUser(${this.getGroupByUserFields()}function(state, events) {
          state = state || {
            inExperiment: false,
            multipleVariants: false,
            ${dimension ? "dimension: null," : ""}
            ${activationMetric ? "activated: false," : ""}
            start: null,
            variation: null,
            ${metrics.map((m, i) => `m${i}: [],`).join("\n")} ${
      hasEarlyStartMetrics ? "\nqueuedEvents: []" : ""
    }
          };
          for(var i=0; i<events.length; i++) {
            const event = events[i];
            // User is put into the experiment
            if(isExposureEvent(event)) {
              if(!state.inExperiment) {
                state.inExperiment = true;
                state.variation = ${getMixpanelPropertyColumn(
                  this.settings.events?.variationIdProperty || "Variant name"
                )};
                ${
                  dimension
                    ? `state.dimension = (${this.getDimensionColumn(
                        dimension.sql,
                        phase.dateStarted,
                        phase.dateEnded,
                        experiment.trackingKey
                      )}) || null;`
                    : ""
                }
                ${activationMetric ? "" : onActivate}
                continue;
              }
              else if(state.variation !== ${getMixpanelPropertyColumn(
                this.settings.events?.variationIdProperty || "Variant name"
              )}) {
                state.multipleVariants = true;
                continue;
              }
              else {
                continue;
              }
            }

            // Not in the experiment yet
            if(!state.inExperiment) {
              ${hasEarlyStartMetrics ? "state.queuedEvents.push(event);" : ""}
              continue;
            }
            // Saw multiple variants so ignore
            if(state.multipleVariants) {
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
                if(isActivationMetric(event)) {
                  ${onActivate}
                }
                else {
                  ${
                    hasEarlyStartMetrics
                      ? "state.queuedEvents.push(event);"
                      : ""
                  }
                  continue;
                }
              }
            `
                : ""
            }

            ${metrics
              .map(
                (metric, i) => `// Metric - ${metric.name}
              if(isMetric${i}(event) && ${this.getConversionWindowCondition(
                  metric,
                  "state.start"
                )}) {
                state.m${i}.push(${this.getMetricValueExpression(
                  metric.column
                )});
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
          if(ev.value.multipleVariants) return false;
          if(ev.value.variation === null || ev.value.variation === undefined) return false;
          ${activationMetric ? "if(!ev.value.activated) return false;" : ""}
          return true;
        })
        // Aggregate the metric value arrays for each user
        .map(function(user) {
          ${metrics
            .map((metric, i) =>
              this.aggregateMetricValues(metric, `user.value.m${i}`)
            )
            .join("\n")}

          return user;
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
          const metricIds = [
            ${metrics
              .map(
                (m) => `
              // ${m.name}
              ${JSON.stringify(m.id)}`
              )
              .join(",")}
          ];
          for(let i=1; i<row.value.length; i++) {
            ret.metrics.push({
              id: metricIds[i-1],
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
          count: number;
          mean: number | null;
          stddev: number | null;
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
            users,
            count: m.count,
            mean: m.mean || 0,
            stddev: m.stddev || 0,
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
      queryLanguage: "javascript",
      metricCaps: true,
      segments: true,
      dimensions: true,
      hasSettings: true,
      events: true,
    };
  }

  getMetricValueQuery(params: MetricValueParams): string {
    const metric = params.metric;

    return formatQuery(`
      ${this.getMathHelperFunctions()}
      ${this.getMetricFunction(metric, "Metric")}

      // ${params.name} - Metric value (${metric.name})
      return ${this.getEvents(params.from, params.to, [metric.table])}
        .filter(function(event) {
          ${
            params.segment
              ? `// Limit to Segment - ${params.segment.name}
          if(!(${params.segment.sql})) return false;`
              : ""
          }
          if(isMetric(event)) return true;
          return false;
        })
        // Metric value per user
        .groupByUser(${this.getGroupByUserFields()}function(state, events) {
          state = state || {date: null, metricValue: []};
          for(var i=0; i<events.length; i++) {
            state.date = state.date || events[i].time;
            const event = events[i];
            if(isMetric(event)) {
              state.metricValue.push(${this.getMetricValueExpression(
                metric.column
              )});
            }
          }
          return state;
        })
        // Remove users that did not convert
        .filter(function(ev) {
          return ev.value.date && ev.value.metricValue.length > 0;
        })
        // Aggregate metric values per user
        .map(function(user) {
          ${this.aggregateMetricValues(metric, "user.value.metricValue")}
          return user;
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
                const date = (new Date(e.value.date)).toISOString().substr(0,10);
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
          }
        ])
        // Transform into easy-to-use objects
        .map(vals => vals.map(val => {
          if(val.count) return {type: "overall", ...val};
          return val;
        }));
        `);
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
                sum: number | null;
              }[];
            }
          | {
              type: "overall";
              count: number;
              sum: number | null;
              avg: number | null;
              stddev: number | null;
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
          overall.mean = row.avg || 0;
          overall.stddev = row.stddev || 0;
        } else if (row.type === "byDate") {
          row.dates.sort((a, b) => a.date.localeCompare(b.date));
          row.dates.forEach(({ date, count, sum }) => {
            result.push({
              date,
              count,
              mean: count > 0 ? (sum || 0) / count : 0,
              stddev: 0,
            });
          });
        }
      });

    return [overall, ...result];
  }
  getPastExperimentQuery(): string {
    throw new Error("Method not implemented.");
  }
  async runPastExperimentQuery(): Promise<PastExperimentResponse> {
    throw new Error("Method not implemented.");
  }
  getSensitiveParamKeys(): string[] {
    return ["secret"];
  }

  private getMetricFunction(metric: MetricInterface, name: string) {
    return `
// ${metric.name}
function is${name}(event) {
  return ${this.getValidMetricCondition(metric)};
}
    `;
  }

  private getMetricValueExpression(col?: string) {
    if (!col) return "1";

    // Use the column directly if it contains a reference to `event`
    if (col.match(/\bevent\b/)) {
      return col;
    }
    // Use the column directly if it's a number
    if (col.match(/^[0-9][0-9.]*/)) {
      return col;
    }

    return getMixpanelPropertyColumn(col);
  }

  private getEventNames(event?: string) {
    if (!event) return [];
    return event
      .split(/ OR /g)
      .map((e) => e.trim())
      .filter(Boolean);
  }

  private getGroupByUserFields() {
    if (this.settings?.events?.extraUserIdProperty) {
      return JSON.stringify([this.settings?.events?.extraUserIdProperty]) + ",";
    }
    return "";
  }

  private getEvents(from: Date, to: Date, events: (string | undefined)[]) {
    const uniqueEvents = new Set<string>();
    events.forEach((event) => {
      const eventNames = this.getEventNames(event);
      eventNames.forEach((name) => uniqueEvents.add(name));
    });

    const filter = {
      from_date: from.toISOString().substr(0, 10),
      to_date: to.toISOString().substr(0, 10),
      event_selectors: Array.from(uniqueEvents).map((e) => {
        return {
          event: e,
        };
      }),
    };

    return `Events(${JSON.stringify(filter, null, 2)})`;
  }
  private getDimensionColumn(
    col: string,
    startDate: Date,
    endDate?: Date,
    experimentId?: string
  ) {
    return replaceSQLVars(getMixpanelPropertyColumn(col), {
      startDate,
      endDate,
      experimentId,
    });
  }

  private getConversionWindowCondition(
    metric: MetricInterface,
    conversionWindowStart: string = ""
  ) {
    const checks: string[] = [];
    const start = (metric.conversionDelayHours || 0) * 60 * 60 * 1000;
    const end =
      start +
      (metric.conversionWindowHours || DEFAULT_CONVERSION_WINDOW_HOURS) *
        60 *
        60 *
        1000;
    if (start) {
      checks.push(`event.time - ${conversionWindowStart} >= ${start}`);
    }
    checks.push(`event.time - ${conversionWindowStart} < ${end}`);
    return checks.join(" && ");
  }

  private getValidMetricCondition(metric: MetricInterface) {
    const checks: string[] = [];
    // Right event name
    const eventNames = this.getEventNames(metric.table);
    if (eventNames.length === 1) {
      checks.push(`event.name === ${JSON.stringify(eventNames[0])}`);
    } else {
      checks.push(`${JSON.stringify(eventNames)}.includes(event.name)`);
    }

    if (metric.conditions) {
      metric.conditions.forEach((condition) => {
        checks.push(conditionToJavascript(condition));
      });
    }

    return checks.join(" && ");
  }
  private getExperimentEventName() {
    return this.settings.events?.experimentEvent || "$experiment_started";
  }
  private getValidExperimentCondition(id: string, start: Date, end?: Date) {
    const experimentEvent = this.getExperimentEventName();
    const experimentIdCol = getMixpanelPropertyColumn(
      this.settings.events?.experimentIdProperty || "Experiment name"
    );
    let timeCheck = `event.time >= ${start.getTime()}`;
    if (end) {
      timeCheck += ` && event.time <= ${end.getTime()}`;
    }
    return `event.name === "${experimentEvent}" && ${experimentIdCol} === "${id}" && ${timeCheck}`;
  }

  private getMathHelperFunctions() {
    return `
// Helper aggregation functions
${getAggregateFunctions()}

    `;
  }
}
