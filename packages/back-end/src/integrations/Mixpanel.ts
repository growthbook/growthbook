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

    const rollups = metrics
      .map((m, i) => this.getMetricRollupCode(m, `m${i}`, true))
      .filter(Boolean);

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
          if(event.time - state.start > ${
            (metric.conversionDelayHours || 0) * 60 * 60 * 1000
          } && ${this.getValidMetricCondition(metric)}) {
            ${this.getMetricAggregationCode(metric, `state.m${i}`)}
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
        .filter(function(event) {
          if(${this.getValidExperimentCondition(
            experiment.trackingKey,
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
      hasEarlyStartMetrics ? "\nqueuedEvents: []" : ""
    }
          };
          for(var i=0; i<events.length; i++) {
            const event = events[i];
            // User is put into the experiment
            if(!state.inExperiment && ${this.getValidExperimentCondition(
              experiment.trackingKey,
              phase.dateStarted,
              phase.dateEnded
            )}) {
              state.inExperiment = true;
              state.variation = ${this.getPropertyColumn(
                this.settings.events?.variationIdProperty || "Variant name"
              )};
              ${
                dimension
                  ? `state.dimension = ${this.getPropertyColumn(
                      dimension.sql
                    )} || null;`
                  : ""
              }
              ${activationMetric ? "" : onActivate}
              continue;
            }
  
            // Not in the experiment yet
            if(!state.inExperiment) {
              ${hasEarlyStartMetrics ? "state.queuedEvents.push(event);" : ""}
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
              if(${this.getValidMetricCondition(metric, "state.start")}) {
                ${this.getMetricAggregationCode(metric, `state.m${i}`)}
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
        })${
          rollups.length
            ? `
        // Post-process metric values
        .map(function(row) {
          ${rollups.join("\n          ")}
          return row;
        })`
            : ""
        }
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
      countDistinct: true,
    };
  }

  getMetricValueQuery(params: MetricValueParams): string {
    const metric = params.metric;

    const rollup = this.getMetricRollupCode(metric, "metricValue", false);

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
          if(${this.getValidMetricCondition(metric)}) return true;
          return false;
        })
        // Metric value per user
        .groupByUser(function(state, events) {
          state = state || {date: null, metricValue: null};
          for(var i=0; i<events.length; i++) {
            state.date = state.date || events[i].time;
            const event = events[i];
            if(${this.getValidMetricCondition(metric)}) {
              ${this.getMetricAggregationCode(metric)}
            }
          }
          return state;
        })
        // Remove users that did not convert
        .filter(function(ev) {
          return ev.value.date && ev.value.metricValue !== null;
        })${
          rollup
            ? `
        // Post-process metric value
        .map(function(row) {
          ${rollup}
          return row;
        })`
            : ""
        }
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
  async runPastExperimentQuery(query: string): Promise<PastExperimentResponse> {
    console.log(query);
    throw new Error("Method not implemented.");
  }
  getSensitiveParamKeys(): string[] {
    return ["secret"];
  }

  private getMetricRollupCode(
    metric: MetricInterface,
    property: string,
    maybeNull: boolean
  ) {
    // Doing a distinct count
    const ret: string[] = [];
    if (metric.type === "count" && metric.column && metric.countDistinct) {
      ret.push(`// Distinct count - ${metric.name}`);
      ret.push(`row.value.${property} = row.value.${property}.size;`);
    }
    if (metric.cap && metric.cap > 0) {
      ret.push(`// Capped value - ${metric.name}`);
      ret.push(
        `row.value.${property} = Math.min(row.value.${property}, ${metric.cap})`
      );
    }

    if (!ret.length) return "";

    if (!maybeNull) {
      return ret.join("\n");
    }

    return `if(row.value.${property} !== null) {\n${ret.join("\n")}\n}`;
  }
  private getMetricAggregationCode(
    metric: MetricInterface,
    destVar: string = "state.metricValue"
  ) {
    // Distinct count
    if (metric.type === "count" && metric.column && metric.countDistinct) {
      return `${destVar} = ${destVar} || new Set();\n${destVar}.add(${metric.column});`;
    }

    // Simple binomial metric
    if (metric.type === "binomial") {
      return `${destVar} = 1;`;
    }

    // Sum the value together
    return `${destVar} = (${destVar} || 0) + ${this.getMetricValueExpression(
      metric.column
    )}`;
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

    return this.getPropertyColumn(col);
  }

  private getEvents(from: Date, to: Date) {
    return `Events({from_date: "${from
      .toISOString()
      .substr(0, 10)}", to_date: "${to.toISOString().substr(0, 10)}"})`;
  }
  private getPropertyColumn(col: string) {
    const colAccess = col.split(".").map((part) => {
      if (part.substr(0, 1) !== "[") return `["${part}"]`;
      return part;
    });
    return `event.properties${colAccess}`;
  }
  private getValidMetricCondition(
    metric: MetricInterface,
    conversionWindowStart: string = ""
  ) {
    const checks: string[] = [];
    // Right event name
    checks.push(`event.name === "${metric.table}"`);

    // Within conversion window
    if (conversionWindowStart) {
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
    }

    if (metric.conditions) {
      metric.conditions.forEach(({ operator, value, column }) => {
        const col = this.getPropertyColumn(column);
        const encoded = JSON.stringify(value);

        // Some operators map to special javascript syntax
        if (operator === "~") {
          checks.push(`${col}.match(/${value}/)`);
        } else if (operator === "!~") {
          checks.push(`!${col}.match(/${value}/)`);
        } else if (operator === "=") {
          checks.push(`${col} === ${encoded}`);
        } else {
          // All the other operators exactly match the javascript syntax so we can use them directly
          checks.push(`${col} ${operator} ${encoded}`);
        }
      });
    }

    return checks.join(" && ");
  }
  private getValidExperimentCondition(id: string, start: Date, end?: Date) {
    const experimentEvent =
      this.settings.events?.experimentEvent || "$experiment_started";
    const experimentIdCol = this.getPropertyColumn(
      this.settings.events?.experimentIdProperty || "Experiment name"
    );
    let timeCheck = `event.time >= ${start.getTime()}`;
    if (end) {
      timeCheck += ` && event.time <= ${end.getTime()}`;
    }
    return `event.name === "${experimentEvent}" && ${experimentIdCol} === "${id}" && ${timeCheck}`;
  }
}
