import { SAFE_ROLLOUT_TRACKING_KEY_PREFIX } from "shared/constants";
import { format } from "shared/sql";
import type { ExposureQuery } from "shared/types/datasource";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

/** Per identifier counted. */
export const MAX_ROWS_PAST_EXPERIMENTS_QUERY = 3000;

export function getPastExperimentQuery(
  dialect: SqlDialect,
  exposureQuery: ExposureQuery,
  identifierTypes: string[],
  from: Date,
  end: Date,
): string {
  const hasNameCol = exposureQuery.hasNameCol || false;
  const countUnits = (identifierType: string) =>
    dialect.hasCountDistinctHLL()
      ? dialect.hllCardinality(dialect.hllAggregate(identifierType))
      : `COUNT(DISTINCT ${identifierType})`;
  return format(
    `-- Past Experiments
    WITH
      __exposures as (
        SELECT
          experiment_id,
          ${
            hasNameCol ? "MIN(experiment_name)" : "experiment_id"
          } as experiment_name,
          ${dialect.castToString("variation_id")} as variation_id,
          ${
            hasNameCol
              ? "MIN(variation_name)"
              : dialect.castToString("variation_id")
          } as variation_name,
          ${dialect.dateTrunc(dialect.castUserDateCol("timestamp"), "day")} as date,
          ${identifierTypes
            .map(
              (identifierType, i) =>
                `${countUnits(identifierType)} as users_${i},`,
            )
            .join("\n")}
          MAX(${dialect.castUserDateCol("timestamp")}) as latest_data
        FROM
          (
            ${compileSqlTemplate(exposureQuery.query, { startDate: from }, dialect)}
          ) e
        WHERE
          timestamp > ${dialect.toTimestamp(from)}
          AND timestamp <= ${dialect.toTimestamp(end)}
          AND SUBSTRING(experiment_id, 1, ${
            SAFE_ROLLOUT_TRACKING_KEY_PREFIX.length
          }) != '${SAFE_ROLLOUT_TRACKING_KEY_PREFIX}'
          AND experiment_id IS NOT NULL
          AND variation_id IS NOT NULL
        GROUP BY
          experiment_id,
          variation_id,
          ${dialect.dateTrunc(dialect.castUserDateCol("timestamp"), "day")}
      ),
      -- One row per identifier, so each is filtered on its own counts
      __experiments as (
        ${identifierTypes
          .map(
            (identifierType, i) => `SELECT
          ${dialect.castToString(`'${exposureQuery.id}'`)} as exposure_query,
          ${dialect.castToString(`'${identifierType}'`)} as identifier_type,
          experiment_id,
          experiment_name,
          variation_id,
          variation_name,
          date,
          users_${i} as users,
          latest_data
        FROM __exposures`,
          )
          .join("\nUNION ALL\n")}
      ),
      __userThresholds as (
        SELECT
          exposure_query,
          identifier_type,
          experiment_id,
          MIN(experiment_name) as experiment_name,
          variation_id,
          MIN(variation_name) as variation_name,
          -- It's common for a small number of tracking events to continue coming in
          -- long after an experiment ends, so limit to days with enough traffic
          max(users)*0.05 as threshold
        FROM
          __experiments
        WHERE
          -- Skip days where a variation got 5 or fewer visitors since it's probably not real traffic
          users > 5
        GROUP BY
        exposure_query, identifier_type, experiment_id, variation_id
      ),
      __variations as (
        SELECT
          d.exposure_query,
          d.identifier_type,
          d.experiment_id,
          MIN(d.experiment_name) as experiment_name,
          d.variation_id,
          MIN(d.variation_name) as variation_name,
          MIN(d.date) as start_date,
          MAX(d.date) as end_date,
          SUM(d.users) as users,
          MAX(latest_data) as latest_data
        FROM
          __experiments d
          JOIN __userThresholds u ON (
            d.exposure_query = u.exposure_query
            AND d.identifier_type = u.identifier_type
            AND d.experiment_id = u.experiment_id
            AND d.variation_id = u.variation_id
          )
        WHERE
          d.users > u.threshold
        GROUP BY
          d.exposure_query, d.identifier_type, d.experiment_id, d.variation_id
      ),
      __ranked as (
        SELECT
          v.*,
          ROW_NUMBER() OVER (
            PARTITION BY identifier_type
            ORDER BY start_date DESC, experiment_id ASC, variation_id ASC
          ) as rn
        FROM __variations v
      ),
      __limited as (
        SELECT
          exposure_query,
          identifier_type,
          experiment_id,
          experiment_name,
          variation_id,
          variation_name,
          start_date,
          end_date,
          users,
          latest_data
        FROM __ranked
        WHERE rn <= ${MAX_ROWS_PAST_EXPERIMENTS_QUERY}
      )
    ${dialect.selectStarLimit(
      `__limited`,
      MAX_ROWS_PAST_EXPERIMENTS_QUERY * identifierTypes.length,
      `ORDER BY start_date DESC, experiment_id ASC, variation_id ASC, identifier_type ASC`,
    )}`,
    dialect.formatDialect,
  );
}
