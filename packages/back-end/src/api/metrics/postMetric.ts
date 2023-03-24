import { ApiMetric, PostMetricResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postMetricValidator } from "../../validators/openapi";
import {
  createMetric,
  partialFromMetricApiInterface,
  toMetricApiInterface,
} from "../../services/experiments";
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
    } = req.body;

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

    const datasource = await getDataSourceById(
      datasourceId,
      req.organization.id
    );
    if (!datasource) {
      throw new Error(`Invalid data source: ${datasourceId}`);
    }

    // Build API metric
    const apiMetric: Partial<ApiMetric> = {
      datasourceId,
      name,
      description,
      type,
      behavior,
      tags,
      projects,
    };

    const metric = partialFromMetricApiInterface(
      req.organization,
      apiMetric,
      datasource
    );

    // if (behavior) {
    //   const {
    //     cap,
    //     conversionWindowEnd,
    //     conversionWindowStart,
    //     goal: inverse,
    //     maxPercentChange,
    //     minPercentChange,
    //     riskThresholdDanger: loseRisk, // loseRisk
    //     riskThresholdSuccess: winRisk, // winRisk
    //     minSampleSize,
    //   } = behavior;
    // }

    // if (mixpanel) {
    //   const { conditions, userAggregation, eventName, eventValue } = mixpanel;
    // }

    // if (sql) {
    //   const {
    //     denominatorMetricId,
    //     conversionSQL,
    //     identifierTypes,
    //     userAggregationSQL,
    //   } = sql;
    // }

    // if (sqlBuilder) {
    //   const {
    //     conditions,
    //     identifierTypeColumns: userIdTypes,
    //     timestampColumnName,
    //     valueColumnName,
    //     tableName,
    //   } = sqlBuilder;
    // }

    // TODO: Validate: binomial metrics can't have userAggregationSQL

    const createdMetric = await createMetric(metric);

    return {
      metric: toMetricApiInterface(req.organization, createdMetric, datasource),
    };
  }
);
