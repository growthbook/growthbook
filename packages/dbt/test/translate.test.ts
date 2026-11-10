import { postBulkImportFactsValidator } from "shared/validators";
import { translate } from "../src/translate";
import { DbtManifest, TranslateOptions } from "../src/types";
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

  it("keeps a metric's fact table when another metric adds a join", () => {
    const filter = (dims: string[]) => ({
      where_filters: dims.map((d) => ({
        where_sql_template: `{{ Dimension('${d}') }} = 'x'`,
      })),
    });
    const manifest = {
      ...legacy,
      semantic_models: {
        ...legacy.semantic_models,
        locations: {
          name: "locations",
          node_relation: { relation_name: "locations" },
          defaults: { agg_time_dimension: "opened_at" },
          entities: [{ name: "location", type: "primary" }],
          dimensions: [
            { name: "opened_at", type: "time" },
            { name: "city", type: "categorical" },
          ],
        },
      },
      metrics: {
        ...legacy.metrics,
        wider: {
          name: "wider",
          type: "simple",
          type_params: { measure: { name: "order_count" } },
          filter: filter(["customer__region", "location__city"]),
        },
      },
    };
    const factTableOf = (p: typeof payload, id: string) =>
      byId(p.factMetrics, id).numerator?.factTableId;
    const after = run(manifest).payload;
    expect(factTableOf(after, "orders_from_west")).toBe("orders__customer");
    expect(factTableOf(after, "wider")).toBe("orders__customer__location");
  });

  it("gives each (model, join set) its own fact table", () => {
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

  it("keeps date comparisons as sql_expr, since GrowthBook compares date columns by day", () => {
    const manifest = {
      ...legacy,
      metrics: {
        ...legacy.metrics,
        recent_orders: {
          name: "recent_orders",
          type: "simple",
          type_params: { measure: { name: "order_count" } },
          filter: {
            where_filters: [
              {
                where_sql_template:
                  "{{ Dimension('order_id__ordered_at') }} > '2024-01-01'",
              },
              {
                where_sql_template:
                  "{{ Dimension('order_id__ordered_at') }} IN ('2024-01-01', '2024-02-01')",
              },
            ],
          },
        },
      },
    };
    const { payload } = run(manifest);
    expect(byId(payload.factMetrics, "recent_orders").numerator).toEqual({
      factTableId: "orders",
      column: "$$count",
      rowFilters: [
        { operator: "sql_expr", values: ["ordered_at > '2024-01-01'"] },
        {
          operator: "sql_expr",
          values: ["ordered_at IN ('2024-01-01', '2024-02-01')"],
        },
      ],
    });
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

  it("sends an empty userIdColumns, so a mapping removed in dbt is cleared", () => {
    expect(table("visits").userIdColumns).toEqual({});
  });

  it("drops metrics that join a disabled model", () => {
    const customers = legacy.semantic_models["semantic_model.jaffle.customers"];
    const manifest = {
      ...legacy,
      semantic_models: {
        ...legacy.semantic_models,
        "semantic_model.jaffle.customers": {
          ...customers,
          config: { meta: { growthbook: { enabled: false } } },
        },
      },
    };
    const { payload, warnings } = run(manifest);
    expect(
      warnings.find((w) => w.resource === "metric orders_from_west")?.message,
    ).toMatch(/"customers", which is excluded/);
    expect(
      payload.factTables.find((t) => t.id === "orders__customer"),
    ).toBeUndefined();
    expect(
      byId(payload.factMetrics, "order_total").numerator?.factTableId,
    ).toBe("orders");
  });

  it("skips percentiles GrowthBook cannot store", () => {
    const orders = legacy.semantic_models["semantic_model.jaffle.orders"];
    const manifest = {
      ...legacy,
      semantic_models: {
        ...legacy.semantic_models,
        "semantic_model.jaffle.orders": {
          ...orders,
          measures: orders.measures.map((m) =>
            m.name === "order_total_p90"
              ? { ...m, agg_params: { ...m.agg_params, percentile: 0.9999 } }
              : m,
          ),
        },
      },
    };
    const { payload, warnings } = run(manifest);
    expect(
      warnings.find((w) => w.resource === "metric order_total_p90")?.message,
    ).toMatch(/0\.9999 is outside the 0\.001 to 0\.999 range/);
    expect(
      payload.factMetrics.find((m) => m.id === "order_total_p90"),
    ).toBeUndefined();
  });

  it("refuses two tables that would share an id", () => {
    const manifest = {
      ...legacy,
      nodes: {
        ...legacy.nodes,
        "model.jaffle.orders__customer": {
          name: "orders__customer",
          resource_type: "model",
          relation_name: "orders_customer",
          config: { meta: { growthbook: { userIdTypes: ["user_id"] } } },
        },
      },
    };
    const plain = run(manifest);
    expect(
      plain.warnings.find((w) => w.resource === "fact table orders__customer")
        ?.message,
    ).toMatch(/generated from a semantic model already has this id/);
    expect(byId(plain.payload.factTables, "orders__customer").sql).toMatch(
      /LEFT JOIN/,
    );

    // Semantic names can't contain "__" in dbt, but nothing here relies on that.
    const semantic = run({
      ...legacy,
      semantic_models: {
        ...legacy.semantic_models,
        collider: {
          name: "orders__customer",
          node_relation: { relation_name: "collider" },
          defaults: { agg_time_dimension: "at" },
          entities: [
            { name: "customer", type: "primary", expr: "customer_id" },
          ],
          dimensions: [{ name: "at", type: "time" }],
          measures: [{ name: "collider_count", agg: "count", expr: "x" }],
        },
      },
      metrics: {
        ...legacy.metrics,
        collider: {
          name: "collider",
          type: "simple",
          type_params: { measure: { name: "collider_count" } },
        },
      },
    });
    expect(
      semantic.warnings.find(
        (w) => w.resource === "fact table orders__customer",
      )?.message,
    ).toMatch(/more than one semantic model/);
    for (const id of ["collider", "orders_from_west"]) {
      expect(
        semantic.payload.factMetrics.find((m) => m.id === id),
      ).toBeUndefined();
    }
  });

  const pageViews = legacy.nodes["model.jaffle.page_views"];
  const withPlainMetrics = (metrics: unknown[]) => ({
    ...legacy,
    nodes: {
      ...legacy.nodes,
      "model.jaffle.page_views": {
        ...pageViews,
        config: {
          ...pageViews.config,
          meta: {
            growthbook: { ...pageViews.config.meta.growthbook, metrics },
          },
        },
      },
    },
  });

  it("skips a plain-model metric whose id the API would merge with another", () => {
    const { payload, warnings } = run(
      withPlainMetrics([
        {
          id: "fact__order_total",
          name: "Dup",
          metricType: "mean",
          numerator: { column: "$$count" },
        },
      ]),
    );
    expect(
      warnings.find((w) => w.resource === "metric fact__order_total")?.message,
    ).toMatch(/already has the id "fact__order_total"/);
    expect(
      payload.factMetrics.filter((m) => m.id.endsWith("order_total")),
    ).toHaveLength(1);
  });

  it("declares typed columns for plain-model metrics", () => {
    const { payload } = run(
      withPlainMetrics([
        {
          id: "time_on_page",
          name: "Time on page",
          metricType: "mean",
          numerator: { column: "seconds" },
        },
        {
          id: "pages",
          name: "Pages",
          metricType: "mean",
          numerator: { column: "url", aggregation: "count distinct" },
        },
      ]),
    );
    expect(byId(payload.factTables, "page_views").columns).toEqual(
      expect.arrayContaining([
        { column: "seconds", datatype: "number" },
        { column: "url", datatype: "string" },
      ]),
    );
  });

  it("skips a metric whose column means something else on the same table", () => {
    const orders = legacy.semantic_models["semantic_model.jaffle.orders"];
    const manifest = {
      ...legacy,
      semantic_models: {
        ...legacy.semantic_models,
        "semantic_model.jaffle.orders": {
          ...orders,
          measures: [
            ...orders.measures,
            { name: "physical_vc", agg: "sum", expr: "net_revenue_vc" },
          ],
        },
      },
      metrics: {
        ...legacy.metrics,
        physical_vc: {
          name: "physical_vc",
          type: "simple",
          type_params: { measure: { name: "physical_vc" } },
        },
      },
    };
    const { payload, warnings } = run(manifest);
    expect(
      warnings.find((w) => w.resource === "metric physical_vc")?.message,
    ).toMatch(
      /"net_revenue_vc" is used as number column here but as number expression/,
    );
    expect(
      payload.factMetrics.find((m) => m.id === "physical_vc"),
    ).toBeUndefined();
    expect(byId(payload.factMetrics, "net_revenue")).toBeDefined();
  });

  it("skips a joined table whose column names collide with the base model", () => {
    const orders = legacy.semantic_models["semantic_model.jaffle.orders"];
    const manifest = {
      ...legacy,
      semantic_models: {
        ...legacy.semantic_models,
        "semantic_model.jaffle.orders": {
          ...orders,
          dimensions: [
            ...orders.dimensions,
            {
              name: "local_region",
              type: "categorical",
              expr: "customer__region",
            },
          ],
        },
      },
    };
    const { payload, warnings } = run(manifest);
    expect(
      warnings.find((w) => w.resource === "fact table orders__customer")
        ?.message,
    ).toMatch(/"customer__region" has the same name as a column on "orders"/);
    expect(
      payload.factTables.find((t) => t.id === "orders__customer"),
    ).toBeUndefined();
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

  it("reads config.tags when dbt also writes an empty top-level tags", () => {
    const manifest = {
      ...legacy,
      metrics: {
        ...legacy.metrics,
        "metric.jaffle.orders_from_west": {
          ...legacy.metrics["metric.jaffle.orders_from_west"],
          tags: [],
          config: { meta: {}, tags: ["config_only"] },
        },
      },
    };
    const { payload } = run(manifest, { select: ["tag:config_only"] });
    expect(payload.factMetrics.map((m) => m.id)).toEqual(["orders_from_west"]);
    expect(byId(payload.factMetrics, "orders_from_west").tags).toEqual([
      "config_only",
    ]);
  });

  it("rejects an entity mapping that names no entity or identifier type", () => {
    expect(() => run(legacy, { entities: { custmer: "user_id" } })).toThrow(
      /no semantic model has an entity named "custmer"/,
    );
    expect(() => run(legacy, { entities: { customer: "userid" } })).toThrow(
      /"userid" is not an identifier type on this Data Source/,
    );
  });

  it("notes selectors that match nothing", () => {
    const { payload, warnings } = run(legacy, { select: ["revnue"] });
    expect(payload.factMetrics).toEqual([]);
    expect(warnings).toEqual([
      {
        level: "note",
        resource: "--select",
        message: '"revnue" matched no metric or model',
      },
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
  const { payload, warnings } = run(newSpec, {
    entities: { customer: "user_id" },
  });
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
