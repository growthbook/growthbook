import { PostMetricResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postMetricValidator } from "../../validators/openapi";
import { createMetric, toMetricApiInterface } from "../../services/experiments";
import { getDataSourceById } from "../../models/DataSourceModel";

export const postMetric = createApiRequestHandler(postMetricValidator)(
  async (req): Promise<PostMetricResponse> => {
    const {
      datasourceId,
      name,
      description,
      type,
      behavior,
      sql,
      sqlBuilder,
      mixpanel,

      tags = [],
      projects = [],

      // TODO: find out where these go
      userIdColumns,
      userIdColumn,
      userIdTypes,
      anonymousIdColumn,
    } = req.body;

    // TODO: xor between 3 values: sql, sqlBuilder, mixpanel
    // TODO: queryFormat = 'builder' | 'sql' | 'mixpanel' // ??? or maybe no mixpanel
    const queryFormat: null | "builder" | "sql" = null;
    // const queryFormat = builder ? "builder" : "sql";

    const datasource = await getDataSourceById(
      datasourceId,
      req.organization.id
    );
    if (!datasource) {
      throw new Error(`Invalid data source: ${datasourceId}`);
    }

    if (behavior) {
      const {
        cap,
        conversionWindowEnd,
        conversionWindowStart,
        goal: inverse,
        maxPercentChange,
        minPercentChange,
        riskThresholdDanger: loseRisk, // loseRisk
        riskThresholdSuccess: winRisk, // winRisk
        minSampleSize,
      } = behavior;
    }

    if (mixpanel) {
      const { conditions, userAggregation, eventName, eventValue } = mixpanel;
    }

    if (sql) {
      const {
        denominatorMetricId,
        conversionSQL,
        identifierTypes,
        userAggregationSQL,
      } = sql;
    }

    if (sqlBuilder) {
      const {
        conditions,
        identifierTypeColumns: userIdTypes,
        timestampColumnName,
        valueColumnName,
        tableName,
      } = sqlBuilder;
    }

    // TODO: There's also a bunch of hidden logic in this interface (e.g. you shouldnt be able to set mixpanel and sql fields; binomial metrics can't have userAggregationSQL)

    const metric = await createMetric(/* */);

    return {
      metric: toMetricApiInterface(req.organization, metric, datasource),
    };
  }
);
