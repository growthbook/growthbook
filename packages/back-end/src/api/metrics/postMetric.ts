import { ApiMetric, PostMetricResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postMetricValidator } from "../../validators/openapi";
import {
  createMetric,
  partialFromMetricApiInterface,
  RequiredApiMetricFields,
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
      owner,
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

    if (type === "binomial" && sql?.userAggregationSQL) {
      throw new Error("Binomial metrics cannot have userAggregationSQL");
    }

    const datasource = await getDataSourceById(
      datasourceId,
      req.organization.id
    );
    if (!datasource) {
      throw new Error(`Invalid data source: ${datasourceId}`);
    }

    // Build API metric from postMetric request
    const apiMetric: Partial<ApiMetric> & RequiredApiMetricFields = {
      datasourceId,
      name,
      description,
      owner,
      type,
      behavior,
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

    const metric = partialFromMetricApiInterface(req.organization, apiMetric);
    const createdMetric = await createMetric(metric);

    return {
      metric: toMetricApiInterface(req.organization, createdMetric, datasource),
    };
  }
);
