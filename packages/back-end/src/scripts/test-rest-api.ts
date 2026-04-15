import {
  deleteFactMetricValidator,
  deleteFactTableFilterValidator,
  deleteFactTableValidator,
  getFactMetricValidator,
  getFactTableFilterValidator,
  getFactTableValidator,
  listDataSourcesValidator,
  listFactMetricsValidator,
  listFactTableFiltersValidator,
  listFactTablesValidator,
  postBulkImportFactsValidator,
  postFactMetricValidator,
  postFactTableFilterValidator,
  postFactTableValidator,
  updateFactMetricValidator,
  updateFactTableFilterValidator,
  updateFactTableValidator,
} from "shared/validators";
import { z } from "zod";
import { ApiEndpointSpec } from "back-end/src/util/handler";

// Fill these with actual values for your GrowthBook instance
const secret = process.env.API_KEY;
const host = process.env.API_HOST || "http://localhost:3100";

if (!secret) {
  throw new Error("API_KEY is not set");
}

async function req<
  T extends ApiEndpointSpec<
    z.ZodTypeAny,
    z.ZodTypeAny,
    z.ZodTypeAny,
    z.ZodTypeAny
  >,
>(
  validator: T,
  {
    params,
    body,
    query,
  }: {
    params?: z.infer<T["paramsSchema"]>;
    body?: z.infer<T["bodySchema"]>;
    query?: z.infer<T["querySchema"]>;
  } = {},
): Promise<z.infer<T["responseSchema"]>> {
  const paramsObj = params
    ? Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v + ""]))
    : {};

  let url = `${host}/api/v1${validator.path.replace(/:(\w+)/g, (_, p) => paramsObj[p] ?? "")}`;
  if (query) {
    url += `?${new URLSearchParams(query).toString()}`;
  }

  console.log(`${validator.method} ${url}`);

  const res = await fetch(url, {
    method: validator.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return json as z.infer<T["responseSchema"]>;
}

async function run() {
  // Get data source
  const dataSources = (await req(listDataSourcesValidator)).dataSources;
  const datasource = dataSources[0];
  if (!datasource) {
    throw new Error("No data sources found");
  }

  console.log(`Using data source: ${datasource.name} (${datasource.id})`);

  const userIdTypes = datasource.identifierTypes.map((t) => t.id);
  const sql = `SELECT ${userIdTypes.map((t) => `'${t}' as ${t},`).join(" ")} 10 as amount, '2026-01-01 00:00:00' as timestamp`;

  // Create a fact table
  const factTable = (
    await req(postFactTableValidator, {
      body: {
        name: "My Fact Table",
        datasource: datasource.id,
        userIdTypes,
        sql,
      },
    })
  ).factTable;
  if (!factTable) {
    throw new Error("POST /fact-tables error");
  }

  // List all fact tables
  const factTables = (await req(listFactTablesValidator)).factTables;
  if (!factTables.some((f) => f.id === factTable.id)) {
    throw new Error("GET /fact-tables error");
  }

  // Get a single fact table
  const factTableById = (
    await req(getFactTableValidator, { params: { id: factTable.id } })
  ).factTable;
  if (!factTableById) {
    throw new Error("GET /fact-tables/:id error");
  }

  // Update a fact table
  const updatedFactTable = (
    await req(updateFactTableValidator, {
      params: { id: factTable.id },
      body: { name: "My Fact Table (updated)" },
    })
  ).factTable;
  if (
    !updatedFactTable ||
    updatedFactTable.name !== "My Fact Table (updated)"
  ) {
    throw new Error("POST /fact-tables/:id error");
  }

  // Create a fact table filter
  const factTableFilter = (
    await req(postFactTableFilterValidator, {
      params: { factTableId: factTable.id },
      body: {
        name: "Expensive",
        value: "amount > 10",
      },
    })
  ).factTableFilter;
  if (!factTableFilter) {
    throw new Error("POST /fact-tables/:id/filters error");
  }

  // List all fact table filters
  const factTableFilters = (
    await req(listFactTableFiltersValidator, {
      params: { factTableId: factTable.id },
    })
  ).factTableFilters;
  if (!factTableFilters.some((f) => f.id === factTableFilter.id)) {
    throw new Error("GET /fact-tables/:id/filters error");
  }

  // Get a single fact table filter
  const factTableFilterById = (
    await req(getFactTableFilterValidator, {
      params: { factTableId: factTable.id, id: factTableFilter.id },
    })
  ).factTableFilter;
  if (!factTableFilterById) {
    throw new Error("GET /fact-tables/:id/filters/:id error");
  }

  // Update a fact table filter
  const updatedFactTableFilter = (
    await req(updateFactTableFilterValidator, {
      params: { factTableId: factTable.id, id: factTableFilter.id },
      body: { name: "Expensive (updated)" },
    })
  ).factTableFilter;
  if (
    !updatedFactTableFilter ||
    updatedFactTableFilter.name !== "Expensive (updated)"
  ) {
    throw new Error("POST /fact-tables/:id/filters/:id error");
  }

  // Create a fact metric
  const factMetric = (
    await req(postFactMetricValidator, {
      body: {
        name: "Revenue",
        metricType: "mean",
        numerator: {
          factTableId: factTable.id,
          column: "amount",
          filters: [factTableFilter.id],
        },
      },
    })
  ).factMetric;
  if (!factMetric) {
    throw new Error("POST /fact-metrics error");
  }

  // List all fact metrics
  const factMetrics = (await req(listFactMetricsValidator)).factMetrics;
  if (!factMetrics.some((f) => f.id === factMetric.id)) {
    throw new Error("GET /fact-metrics error");
  }

  // Get a single fact metric
  const factMetricById = (
    await req(getFactMetricValidator, { params: { id: factMetric.id } })
  ).factMetric;
  if (!factMetricById) {
    throw new Error("GET /fact-metrics/:id error");
  }

  // Update a fact metric
  const updatedFactMetric = (
    await req(updateFactMetricValidator, {
      params: { id: factMetric.id },
      body: { name: "Revenue (updated)" },
    })
  ).factMetric;
  if (!updatedFactMetric || updatedFactMetric.name !== "Revenue (updated)") {
    throw new Error("POST /fact-metrics/:id error");
  }

  // Delete a fact metric
  const deletedFactMetric = (
    await req(deleteFactMetricValidator, { params: { id: factMetric.id } })
  ).deletedId;
  if (!deletedFactMetric || deletedFactMetric !== factMetric.id) {
    throw new Error("DELETE /fact-metrics/:id error");
  }

  // Delete a fact table filter
  const deletedFactTableFilter = (
    await req(deleteFactTableFilterValidator, {
      params: { factTableId: factTable.id, id: factTableFilter.id },
    })
  ).deletedId;
  if (
    !deletedFactTableFilter ||
    deletedFactTableFilter !== factTableFilter.id
  ) {
    throw new Error("DELETE /fact-tables/:id/filters/:id error");
  }

  // Delete a fact table
  const deletedFactTable = (
    await req(deleteFactTableValidator, { params: { id: factTable.id } })
  ).deletedId;
  if (!deletedFactTable || deletedFactTable !== factTable.id) {
    throw new Error("DELETE /fact-tables/:id error");
  }

  // Bulk Import (insert)
  const bulkRes = await req(postBulkImportFactsValidator, {
    body: {
      factTables: [
        {
          id: "orders",
          data: {
            name: "My Orders",
            datasource: datasource.id,
            userIdTypes,
            sql,
          },
        },
      ],
      factTableFilters: [
        {
          id: "high_value",
          factTableId: "orders",
          data: {
            name: "High Value",
            value: "amount > 120",
          },
        },
      ],
      factMetrics: [
        {
          id: "revenue_per_user",
          data: {
            name: "Average Order Value",
            metricType: "ratio",
            numerator: {
              factTableId: "orders",
              column: "amount",
              filters: ["high_value"],
            },
            denominator: {
              factTableId: "orders",
              column: "$$COUNT",
            },
          },
        },
      ],
    },
  });
  if (!bulkRes.success) {
    throw new Error("POST /bulk-import/facts error");
  }

  // Bulk Import (update)
  const bulkUpdateRes = await req(postBulkImportFactsValidator, {
    body: {
      factTables: [
        {
          id: "orders",
          data: {
            name: "My Orders (updated)",
            datasource: datasource.id,
            userIdTypes,
            sql,
          },
        },
      ],
      factTableFilters: [
        {
          id: "high_value",
          factTableId: "orders",
          data: {
            name: "High Value (updated)",
            value: "amount > 120",
          },
        },
      ],
      factMetrics: [
        {
          id: "revenue_per_user",
          data: {
            name: "Average Order Value (updated)",
            metricType: "ratio",
            numerator: {
              factTableId: "orders",
              column: "amount",
              filters: ["high_value"],
            },
            denominator: {
              factTableId: "orders",
              column: "$$COUNT",
            },
          },
        },
      ],
    },
  });
  if (!bulkUpdateRes.success) {
    throw new Error("POST /bulk-import/facts update error");
  }

  // Verify that the bulk import worked
  const orders = (
    await req(getFactTableValidator, { params: { id: "orders" } })
  ).factTable;
  if (!orders || orders.name !== "My Orders (updated)") {
    throw new Error("GET /fact-tables/orders error");
  }
  const highValue = (
    await req(getFactTableFilterValidator, {
      params: { factTableId: "orders", id: "high_value" },
    })
  ).factTableFilter;
  if (!highValue || highValue.name !== "High Value (updated)") {
    throw new Error("GET /fact-tables/orders/filters/high_value error");
  }
  const revenuePerUser = (
    await req(getFactMetricValidator, { params: { id: "revenue_per_user" } })
  ).factMetric;
  if (
    !revenuePerUser ||
    revenuePerUser.name !== "Average Order Value (updated)"
  ) {
    throw new Error("GET /fact-metrics/revenue_per_user error");
  }

  // Cleanup bulk imported data
  await req(deleteFactMetricValidator, { params: { id: "revenue_per_user" } });
  await req(deleteFactTableFilterValidator, {
    params: { factTableId: "orders", id: "high_value" },
  });
  await req(deleteFactTableValidator, { params: { id: "orders" } });
}

run()
  .catch(console.error)
  .then(() => console.log("Done!"));
