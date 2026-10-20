import { postBulkImportFactsValidator } from "shared/validators";
import { translate, DbtManifest, TranslateOptions } from "../src/translate";
import legacy from "./fixtures/legacy-manifest.json";
import newSpec from "./fixtures/new-spec-manifest.json";

const opts: TranslateOptions = {
  datasource: "ds_test",
  entities: { customer: "user_id", user: "user_id" },
  idTypes: ["user_id", "anonymous_id"],
};

const run = (manifest: unknown, extra: Partial<TranslateOptions> = {}) =>
  translate(manifest as DbtManifest, { ...opts, ...extra });

const byId = <T extends { id: string }>(items: T[], id: string) => {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found.data;
};

describe("translate (legacy spec)", () => {
  const { payload, warnings } = run(legacy);
  const table = (id: string) => byId(payload.factTables, id);
  const metric = (id: string) => byId(payload.factMetrics, id);
  const skipped = (id: string) =>
    warnings.find((w) => w.level === "skipped" && w.resource === id)?.message;

  it("produces a payload the bulk import API accepts", () => {
    expect(() =>
      postBulkImportFactsValidator.bodySchema.parse(payload),
    ).not.toThrow();
    expect(payload.defaultManagedBy).toBe("dbt");
  });

  it("groups metrics into the fewest fact tables", () => {
    expect(payload.factTables.map((t) => t.id)).toEqual([
      "orders",
      "orders__customer",
      "orders__delivered_at",
      "page_views",
      "visits",
    ]);
  });

  it("maps a semantic model onto SELECT * with remapped id and timestamp columns", () => {
    const orders = table("orders");
    expect(orders.sql).toBe('SELECT * FROM "analytics"."jaffle"."orders"');
    expect(orders.userIdTypes).toEqual(["user_id"]);
    expect(orders.userIdColumns).toEqual({ user_id: "customer_id" });
    expect(orders.timestampColumn).toBe("ordered_at");
    expect(orders.name).toBe("Orders");
    expect(orders.description).toBe("One row per order");
    expect(orders.tags).toEqual(["core"]);
    expect(orders.projects).toEqual(["prj_abc"]);
    expect(orders.columns).toEqual(
      expect.arrayContaining([
        { column: "ordered_at", datatype: "date" },
        { column: "order_total", datatype: "number" },
        { column: "customer_id", datatype: "string" },
        { column: "status", datatype: "" },
        {
          column: "net_revenue_vc",
          datatype: "number",
          isVirtual: true,
          sql: "order_total - discount_amount",
        },
        {
          column: "large_orders_vc",
          datatype: "number",
          isVirtual: true,
          sql: "CASE WHEN order_total > 50 THEN 1 ELSE 0 END",
        },
      ]),
    );
  });

  it("joins one hop through a prefixed subquery for filters on another model's dimension", () => {
    const joined = table("orders__customer");
    expect(joined.sql).toBe(
      // A dimension named "key" would collide with the join key alias, so the alias gets a suffix.
      'SELECT t.*, j_customer.customer__country, j_customer.customer__key, j_customer.customer__region FROM "analytics"."jaffle"."orders" t LEFT JOIN (SELECT customer_id AS customer__key_, upper(country_code) AS customer__country, account_key AS customer__key, region AS customer__region FROM "analytics"."jaffle"."customers") j_customer ON t.customer_id = j_customer.customer__key_',
    );
    expect(joined.name).toBe("Orders + customer");
    expect(metric("keyed_revenue").numerator?.rowFilters).toEqual([
      { operator: "=", column: "customer__key", values: ["k1"] },
    ]);
    for (const id of ["orders_from_west", "west_food_revenue", "us_revenue"]) {
      expect(metric(id).numerator?.factTableId).toBe("orders__customer");
    }
    expect(metric("west_food_revenue").numerator?.rowFilters).toEqual([
      { operator: "=", column: "customer__region", values: ["west"] },
      { operator: "is_true", column: "is_food_order" },
    ]);
  });

  it("parses simple comparisons into structured row filters", () => {
    expect(metric("food_orders").numerator).toEqual({
      factTableId: "orders",
      column: "$$count",
      rowFilters: [{ operator: "is_true", column: "is_food_order" }],
    });
    expect(metric("completed_orders").numerator?.rowFilters).toEqual([
      { operator: "=", column: "status", values: ["completed"] },
    ]);
    expect(metric("multi_item_orders").numerator?.rowFilters).toEqual([
      { operator: ">", column: "item_count", values: ["1"] },
    ]);
    expect(metric("priority_orders").numerator?.rowFilters).toEqual([
      { operator: "in", column: "status", values: ["rush", "it's urgent"] },
      { operator: "is_false", column: "is_food_order" },
    ]);
    expect(metric("unshipped_orders").numerator?.rowFilters).toEqual([
      { operator: "is_null", column: "delivered_at" },
    ]);
    // Numeric and boolean literals type the column so values aren't quoted.
    expect(table("orders").columns).toEqual(
      expect.arrayContaining([
        { column: "item_count", datatype: "number" },
        { column: "is_food_order", datatype: "boolean" },
      ]),
    );
  });

  it("falls back to sql_expr for anything else", () => {
    expect(metric("web_or_food_orders").numerator?.rowFilters).toEqual([
      {
        operator: "sql_expr",
        values: ["(lower(source)) = 'web' OR is_food_order = true"],
      },
      { operator: "sql_expr", values: ["(lower(source)) = 'web'"] },
    ]);
  });

  it("maps aggregations", () => {
    expect(metric("order_total")).toMatchObject({
      name: "Order total",
      description: "Sum of order totals",
      metricType: "mean",
      numerator: { factTableId: "orders", column: "order_total" },
      tags: ["finance"],
      cappingSettings: { type: "percentile", value: 0.99 },
      windowSettings: { type: "none" },
    });
    // COUNT(order_id) counts a key, so no null filter is needed.
    expect(metric("order_count").numerator).toEqual({
      factTableId: "orders",
      column: "$$count",
    });
    expect(metric("customers_with_orders").numerator).toEqual({
      factTableId: "orders",
      column: "customer_id",
      aggregation: "count distinct",
    });
    // AVG skips nulls, so the denominator only counts rows with a value.
    expect(metric("avg_order_value")).toMatchObject({
      metricType: "ratio",
      numerator: { factTableId: "orders", column: "order_total" },
      denominator: {
        factTableId: "orders",
        column: "$$count",
        rowFilters: [{ operator: "not_null", column: "order_total" }],
      },
    });
    expect(metric("order_total_p90")).toMatchObject({
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
    });
    expect(metric("large_orders").numerator?.column).toBe("large_orders_vc");
    expect(metric("order_total_by_delivery").numerator?.factTableId).toBe(
      "orders__delivered_at",
    );
    expect(table("orders__delivered_at").timestampColumn).toBe("delivered_at");
  });

  it("maps ratio, cumulative, conversion and a/b derived metrics", () => {
    expect(metric("food_order_share")).toMatchObject({
      metricType: "ratio",
      numerator: {
        column: "$$count",
        rowFilters: [{ operator: "is_true", column: "is_food_order" }],
      },
      denominator: { column: "$$count" },
    });
    expect(metric("revenue_7d").windowSettings).toEqual({
      type: "lookback",
      windowValue: 7,
      windowUnit: "days",
    });
    expect(metric("revenue_3m").windowSettings).toEqual({
      type: "lookback",
      windowValue: 90,
      windowUnit: "days",
    });
    expect(
      warnings.find(
        (w) => w.level === "note" && w.resource === "metric revenue_3m",
      )?.message,
    ).toMatch(/synced as 90 days/);
    // Removing a window in dbt must remove it in GrowthBook on the next sync.
    expect(metric("revenue_all_time").windowSettings).toEqual({ type: "none" });
    expect(metric("visit_to_buy_7d")).toMatchObject({
      metricType: "funnel",
      funnelSettings: {
        steps: [
          {
            name: "visits",
            factTableId: "visits",
            rowFilters: [
              { operator: "=", column: "referrer", values: ["facebook"] },
            ],
            optional: false,
          },
          {
            // COUNT(purchase_id) only counts visits with a purchase.
            name: "buys",
            factTableId: "visits",
            rowFilters: [{ operator: "not_null", column: "purchase_id" }],
            optional: false,
            conversionWindow: { unit: "days", value: 7 },
          },
        ],
      },
    });
    expect(metric("visit_to_buy_7d").numerator).toBeUndefined();
    expect(metric("visit_to_buy_7d").windowSettings).toBeUndefined();
    expect(metric("cost_ratio")).toMatchObject({
      metricType: "ratio",
      numerator: { factTableId: "orders", column: "cost_amount" },
      denominator: { factTableId: "orders", column: "order_total" },
    });
  });

  it("imports plain models annotated with meta.growthbook", () => {
    expect(table("page_views")).toMatchObject({
      sql: 'SELECT * FROM "analytics"."jaffle"."page_views"',
      userIdTypes: ["anonymous_id"],
      timestampColumn: "viewed_at",
      columns: [
        { column: "viewed_at", datatype: "date" },
        { column: "anonymous_id", datatype: "" },
      ],
    });
    expect(metric("page_views_per_user").numerator).toEqual({
      factTableId: "page_views",
      column: "$$count",
    });
    expect(metric("viewed_any_page")).toMatchObject({
      metricType: "proportion",
      numerator: { factTableId: "page_views" },
    });
  });

  it("skips what GrowthBook cannot express, with a reason", () => {
    expect(skipped("metric min_order_total")).toMatch(/min/);
    expect(skipped("metric orders_with_discount")).toMatch(/non_additive/);
    expect(skipped("metric revenue_mtd")).toMatch(/grain_to_date/);
    expect(skipped("metric visit_to_buy_same_product")).toMatch(
      /constant_properties/,
    );
    expect(skipped("metric visit_to_buy_by_visit")).toMatch(/identifier type/);
    expect(skipped("metric gross_profit")).toMatch(/derived/);
    expect(skipped("metric wau")).toMatch(/TimeDimension/);
    expect(skipped("metric orders_by_country")).toMatch(/location/);
    expect(skipped("metric refund_rate")).toMatch(/refunds.*excluded/);
    expect(skipped("metric distinct_order_totals")).toMatch(
      /order_total.*string.*number/,
    );
    for (const id of [
      "min_order_total",
      "gross_profit",
      "refund_rate",
      "refund_count",
      "disabled_metric",
      "distinct_order_totals",
    ]) {
      expect(payload.factMetrics.find((m) => m.id === id)).toBeUndefined();
    }
    expect(skipped("metric refund_count")).toBeUndefined();
    expect(skipped("metric disabled_metric")).toBeUndefined();
    expect(payload.factTables.find((t) => t.id === "refunds")).toBeUndefined();
  });

  it("selects by tag, name glob and model, before translating anything", () => {
    const tagged = run(legacy, { select: ["tag:growthbook"] });
    expect(tagged.payload.factMetrics.map((m) => m.id)).toEqual([
      "tagged_metric",
    ]);
    expect(tagged.payload.factTables.map((t) => t.id)).toEqual(["orders"]);
    // Unselected metrics must not produce warnings (they'd fail --strict).
    expect(tagged.warnings).toEqual([]);

    const glob = run(legacy, { select: ["revenue_*"] });
    expect(glob.payload.factMetrics.map((m) => m.id)).toEqual([
      "revenue_3m",
      "revenue_7d",
      "revenue_all_time",
    ]);

    const model = run(legacy, { select: ["visits"] });
    expect(model.payload.factMetrics.map((m) => m.id)).toEqual([
      "visit_to_buy_7d",
    ]);

    const excluded = run(legacy, { exclude: ["orders", "tag:web"] });
    expect(excluded.payload.factTables.map((t) => t.id)).toEqual(["visits"]);
    expect(excluded.payload.factMetrics.map((m) => m.id)).toEqual([
      "visit_to_buy_7d",
    ]);
  });

  it("applies selectors to plain-model metrics too", () => {
    const excluded = run(legacy, { exclude: ["page_views_per_user"] });
    expect(
      excluded.payload.factMetrics
        .filter((m) => m.data.numerator?.factTableId === "page_views")
        .map((m) => m.id),
    ).toEqual(["viewed_any_page"]);

    const selected = run(legacy, { select: ["page_views_per_user"] });
    expect(selected.payload.factTables.map((t) => t.id)).toEqual([
      "page_views",
    ]);
    expect(selected.payload.factMetrics.map((m) => m.id)).toEqual([
      "page_views_per_user",
    ]);
  });

  it("falls back to entity names when the Data Source id types are unknown", () => {
    const { payload } = run(legacy, {
      entities: undefined,
      idTypes: undefined,
    });
    expect(byId(payload.factTables, "orders").userIdTypes).toEqual([
      "order_id",
      "customer",
      "location",
    ]);
  });

  it("skips tables with no usable entity", () => {
    const { payload, warnings } = run(legacy, {
      entities: {},
      idTypes: ["user_id"],
    });
    expect(payload.factTables.map((t) => t.id)).toEqual(["page_views"]);
    expect(
      warnings.find((w) => w.resource === "fact table orders")?.message,
    ).toMatch(/--entities/);
  });
});

describe("translate (v1.12 spec)", () => {
  const { payload, warnings } = run(newSpec);
  const metric = (id: string) => byId(payload.factMetrics, id);

  it("reads metric_aggregation_params and metric-based inputs", () => {
    expect(warnings).toEqual([]);
    expect(() =>
      postBulkImportFactsValidator.bodySchema.parse(payload),
    ).not.toThrow();
    expect(payload.factTables.map((t) => t.id)).toEqual(["orders", "visits"]);
    expect(metric("order_total").numerator).toEqual({
      factTableId: "orders",
      column: "order_total",
    });
    // order_id isn't declared as an entity here, so the null filter stays.
    expect(metric("food_orders").numerator?.rowFilters).toEqual([
      { operator: "is_true", column: "is_food_order" },
      { operator: "not_null", column: "order_id" },
    ]);
    expect(metric("aov")).toMatchObject({
      metricType: "ratio",
      numerator: { column: "order_total" },
      denominator: { column: "$$count" },
    });
    expect(metric("revenue_30d").windowSettings).toEqual({
      type: "lookback",
      windowValue: 30,
      windowUnit: "days",
    });
    expect(metric("visit_to_order").funnelSettings?.steps[1]).toMatchObject({
      factTableId: "orders",
      conversionWindow: { unit: "weeks", value: 2 },
    });
  });
});
