import { Client } from "pg";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";
import { getContextualBanditDimensionSql } from "back-end/src/integrations/sql/queries/contextual-bandit-dimension-query";

const params = {
  query:
    "SELECT user_id, variation_id, main_metric, country, device, age FROM cb_assignments",
  userIdColumn: "user_id",
  variationIdColumn: "variation_id",
  metricValueColumn: "main_metric",
  maxContexts: 4,
  attributes: [
    {
      attribute: "country",
      kind: "categorical" as const,
      topValues: ["US", "CA", "GB"],
    },
    {
      attribute: "device",
      kind: "categorical" as const,
      topValues: ["desktop", "mobile"],
    },
    {
      attribute: "age",
      kind: "quantitative" as const,
      bucketEdges: [18, 25, 40, 65],
    },
  ],
};

describe("contextual bandit SQL", () => {
  it("matches the generated Postgres SQL snapshot", () => {
    const sql = getContextualBanditDimensionSql(postgresDialect, params);

    expect(sql).toMatchSnapshot();
  });

  const localWarehouseUrl =
    process.env.CB_LOCAL_WAREHOUSE_URL || process.env.POSTGRES_TEST_URL;
  const localWarehouseIt = localWarehouseUrl ? it : it.skip;

  localWarehouseIt(
    "folds residual contexts into other against a local Postgres warehouse",
    async () => {
      if (!localWarehouseUrl) return;

      const client = new Client({ connectionString: localWarehouseUrl });
      await client.connect();

      try {
        await client.query(`
          CREATE TEMP TABLE cb_assignments (
            user_id TEXT,
            variation_id TEXT,
            main_metric DOUBLE PRECISION,
            country TEXT,
            device TEXT,
            age DOUBLE PRECISION
          )
        `);
        await client.query(`
          INSERT INTO cb_assignments
          SELECT
            'u' || g AS user_id,
            (g % 2)::TEXT AS variation_id,
            (g % 5)::DOUBLE PRECISION AS main_metric,
            ('{US,CA,GB,DE,FR,JP}'::TEXT[])[(g % 6) + 1] AS country,
            ('{desktop,mobile,tablet}'::TEXT[])[(g % 3) + 1] AS device,
            18 + (g % 60) AS age
          FROM generate_series(1, 6000) AS g
        `);

        const sql = getContextualBanditDimensionSql(postgresDialect, {
          ...params,
          query:
            "SELECT user_id, variation_id, main_metric, country, device, age FROM cb_assignments",
          maxContexts: 5,
        });
        const result = await client.query<{
          variation: string;
          context_id: string;
          main_sum: string;
          main_sum_squares: string;
          n: string;
        }>(sql);
        const contexts = new Set(result.rows.map((row) => row.context_id));
        const nonOtherContexts = new Set(
          result.rows
            .map((row) => row.context_id)
            .filter((contextId) => contextId !== "other"),
        );

        expect(nonOtherContexts.size).toBeLessThanOrEqual(5);
        expect(contexts.has("other")).toBe(true);
      } finally {
        await client.end();
      }
    },
  );
});
