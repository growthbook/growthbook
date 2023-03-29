import { PostMetricResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postMetricValidator } from "../../validators/openapi";
import { createMetric, toMetricApiInterface } from "../../services/experiments";
import { getDataSourceById } from "../../models/DataSourceModel";
import { Condition, MetricInterface, Operator } from "../../../types/metric";

export const postMetric = createApiRequestHandler(postMetricValidator)(
  async (req): Promise<PostMetricResponse> => {
    const {
      datasourceId,
      name,
      description = "",
      type,
      behavior,
      owner = "",
      sql,
      sqlBuilder,
      mixpanel,
      tags = [],
      projects = [],
    } = req.body;

    const datasource = await getDataSourceById(
      datasourceId,
      req.organization.id
    );
    if (!datasource) {
      throw new Error(`Invalid data source: ${datasourceId}`);
    }

    let queryFormatCount = 0;
    if (sqlBuilder) {
      queryFormatCount++;
    }
    if (sql) {
      queryFormatCount++;
    }
    if (mixpanel) {
      queryFormatCount++;
    }

    if (queryFormatCount !== 1) {
      throw new Error("Can only specify one of: sql, sqlBuilder, mixpanel");
    }

    if (type === "binomial" && sql?.userAggregationSQL) {
      throw new Error("Binomial metrics cannot have userAggregationSQL");
    }

    const metric: Omit<
      MetricInterface,
      "dateCreated" | "dateUpdated" | "id"
    > = {
      datasource: datasourceId,
      description,
      name,
      organization: req.organization.id,
      owner,
      tags,
      projects,
      inverse: behavior?.goal === "decrease",
      ignoreNulls: false, // todo: ??
      queries: [], // todo: ??
      runStarted: null,
      type,
      userIdColumns: (sqlBuilder?.identifierTypeColumns || []).reduce<
        Record<string, string>
      >((acc, { columnName, identifierType }) => {
        acc[columnName] = identifierType;
        return acc;
      }, {}),
    };

    // Assign all undefined behavior fields to the metric
    if (behavior) {
      if (typeof behavior.cap !== "undefined") {
        metric.cap = behavior.cap;
      }

      if (typeof behavior.conversionDelayHours !== "undefined") {
        metric.conversionDelayHours = behavior.conversionDelayHours;
      }

      if (typeof behavior.conversionWindowHours !== "undefined") {
        metric.conversionWindowHours = behavior.conversionWindowHours;
      }

      if (typeof behavior.maxPercentChange !== "undefined") {
        metric.maxPercentChange = behavior.maxPercentChange;
      }

      if (typeof behavior.minPercentChange !== "undefined") {
        metric.minPercentChange = behavior.minPercentChange;
      }

      if (typeof behavior.minSampleSize !== "undefined") {
        metric.minSampleSize = behavior.minSampleSize;
      }

      if (typeof behavior.riskThresholdDanger !== "undefined") {
        metric.loseRisk = behavior.riskThresholdDanger;
      }

      if (typeof behavior.riskThresholdSuccess !== "undefined") {
        metric.winRisk = behavior.riskThresholdSuccess;
      }
    }

    let queryFormat: undefined | "builder" | "sql" = undefined;
    if (sqlBuilder) {
      queryFormat = "builder";
    } else if (sql) {
      queryFormat = "sql";
    }
    metric.queryFormat = queryFormat;

    // Conditions
    metric.conditions =
      datasource.type == "mixpanel"
        ? (mixpanel?.conditions || []).map(({ operator, property, value }) => ({
            column: property,
            operator: operator as Operator,
            value: value,
          }))
        : ((sqlBuilder?.conditions || []) as Condition[]);

    // TODO: sqlBuilder
    if (sqlBuilder) {
      metric.table = sqlBuilder.tableName;
      metric.aggregation = sql?.userAggregationSQL;
      metric.timestampColumn = sqlBuilder.timestampColumnName;
      metric.column = sqlBuilder.valueColumnName;
    }

    // TODO: sql

    // TODO: mixpanel
    if (mixpanel) {
      metric.aggregation = mixpanel.userAggregation;
      metric.table = mixpanel.eventName;
      metric.column = mixpanel.eventValue;
    }

    /*
    // Build API metric from postMetric request
    const apiMetric: Partial<ApiMetric> & RequiredApiMetricFields = {
      datasourceId,
      name,
      description,
      owner,
      type,
      behavior: behavior
        ? {
            goal: behavior.goal,
            cap: behavior?.cap ?? 0,
            riskThresholdDanger: behavior?.riskThresholdDanger ?? 0,
            riskThresholdSuccess: behavior?.riskThresholdSuccess ?? 0,
            conversionWindowStart: behavior?.conversionWindowStart ?? 0,
            conversionWindowEnd: behavior?.conversionWindowEnd ?? 0,
            minSampleSize: behavior?.minSampleSize ?? 150,
            minPercentChange: behavior?.minPercentChange ?? 0.005,
            maxPercentChange: behavior?.maxPercentChange ?? 0.5,
          }
        : undefined,
      tags,
      projects,
      // We are mapping the request shape for the user to simplify sql, sqlBuilder & mixpanel,
      // which requires us to re-map it here
      // We must add defaults since we are making these fields optional
      sql: sql
        ? {
            ...sql,
            denominatorMetricId: sql.denominatorMetricId || "",
            userAggregationSQL: sql.userAggregationSQL || "",
            identifierTypes: sql.identifierTypes || [],
            builder: sqlBuilder
              ? {
                  ...sqlBuilder,
                  conditions: sqlBuilder.conditions || [],
                  valueColumnName: sqlBuilder.valueColumnName || "",
                }
              : undefined,
          }
        : sqlBuilder
        ? {
            denominatorMetricId: "",
            userAggregationSQL: "",
            identifierTypes: [],
            conversionSQL: "",
            builder: {
              ...sqlBuilder,
              conditions: sqlBuilder.conditions || [],
              valueColumnName: sqlBuilder.valueColumnName || "",
            },
          }
        : undefined,
      mixpanel: mixpanel
        ? {
            ...mixpanel,
            conditions: mixpanel?.conditions || [],
          }
        : undefined,
    };

    const metric = partialFromMetricApiInterface(
      req.organization,
      apiMetric,
      datasource
    );
    */
    const createdMetric = await createMetric(metric);

    return {
      metric: toMetricApiInterface(req.organization, createdMetric, datasource),
    };
  }
);
