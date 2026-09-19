import { SAFE_ROLLOUT_TRACKING_KEY_PREFIX } from "shared/constants";
import { format } from "shared/sql";
import {
  getExposureQueryExperimentIdColumn,
  getExposureQueryIdentifierColumn,
  getExposureQueryTimestampColumn,
  getExposureQueryVariationIdColumn,
} from "shared/util";
import type { ExposureQuery } from "shared/types/datasource";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

export const MAX_ROWS_PAST_EXPERIMENTS_QUERY = 3000;

export function getPastExperimentQuery(
  dialect: SqlDialect,
  experimentQueries: ExposureQuery[],
  from: Date,
  end: Date,
): string {
  return format(
    `-- Past Experiments
    WITH
      ${experimentQueries
        .map((q, i) => {
          const hasNameCol = q.hasNameCol || false;
          const expIdCol = getExposureQueryExperimentIdColumn(q);
          const varIdCol = getExposureQueryVariationIdColumn(q);
          const tsCol = getExposureQueryTimestampColumn(q);
          const idCol = getExposureQueryIdentifierColumn(q, q.userIdType);
          const userCountColumn = dialect.hasCountDistinctHLL()
            ? dialect.hllCardinality(dialect.hllAggregate(idCol))
            : `COUNT(distinct ${idCol})`;
          return `
        __exposures${i} as (
          SELECT
            ${dialect.castToString(`'${q.id}'`)} as exposure_query,
            ${expIdCol} as experiment_id,
            ${
              hasNameCol ? "MIN(experiment_name)" : expIdCol
            } as experiment_name,
            ${dialect.castToString(varIdCol)} as variation_id,
            ${
              hasNameCol
                ? "MIN(variation_name)"
                : dialect.castToString(varIdCol)
            } as variation_name,
            ${dialect.dateTrunc(dialect.castUserDateCol(tsCol), "day")} as date,
            ${userCountColumn} as users,
            MAX(${dialect.castUserDateCol(tsCol)}) as latest_data
          FROM
            (
              ${compileSqlTemplate(q.query, { startDate: from }, dialect)}
            ) e${i}
          WHERE
            ${tsCol} > ${dialect.toTimestamp(from)}
            AND ${tsCol} <= ${dialect.toTimestamp(end)}
            AND SUBSTRING(${expIdCol}, 1, ${
              SAFE_ROLLOUT_TRACKING_KEY_PREFIX.length
            }) != '${SAFE_ROLLOUT_TRACKING_KEY_PREFIX}'
            AND ${expIdCol} IS NOT NULL
            AND ${varIdCol} IS NOT NULL
          GROUP BY
            ${expIdCol},
            ${varIdCol},
            ${dialect.dateTrunc(dialect.castUserDateCol(tsCol), "day")}
        ),`;
        })
        .join("\n")}
      __experiments as (
        ${experimentQueries
          .map((q, i) => `SELECT * FROM __exposures${i}`)
          .join("\nUNION ALL\n")}
      ),
      __userThresholds as (
        SELECT
          exposure_query,
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
        exposure_query, experiment_id, variation_id
      ),
      __variations as (
        SELECT
          d.exposure_query,
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
            AND d.experiment_id = u.experiment_id
            AND d.variation_id = u.variation_id
          )
        WHERE
          d.users > u.threshold
        GROUP BY
          d.exposure_query, d.experiment_id, d.variation_id
      )
    ${dialect.selectStarLimit(
      `__variations`,
      MAX_ROWS_PAST_EXPERIMENTS_QUERY,
      `ORDER BY start_date DESC, experiment_id ASC, variation_id ASC`,
    )}`,
    dialect.formatDialect,
  );
}
