import {
  // Projects
  listProjectsValidator,
  postProjectValidator,
  getProjectValidator,
  putProjectValidator,
  deleteProjectValidator,
  // Environments
  listEnvironmentsValidator,
  postEnvironmentValidator,
  putEnvironmentValidator,
  deleteEnvironmentValidator,
  // Attributes
  listAttributesValidator,
  postAttributeValidator,
  putAttributeValidator,
  deleteAttributeValidator,
  // Archetypes
  listArchetypesValidator,
  postArchetypeValidator,
  getArchetypeValidator,
  putArchetypeValidator,
  deleteArchetypeValidator,
  // Saved Groups
  listSavedGroupsValidator,
  postSavedGroupValidator,
  getSavedGroupValidator,
  updateSavedGroupValidator,
  deleteSavedGroupValidator,
  // SDK Connections
  listSdkConnectionsValidator,
  postSdkConnectionValidator,
  getSdkConnectionValidator,
  putSdkConnectionValidator,
  deleteSdkConnectionValidator,
  // Features
  listFeaturesValidator,
  postFeatureValidator,
  getFeatureValidator,
  updateFeatureValidator,
  deleteFeatureValidator,
  // Metrics
  listMetricsValidator,
  postMetricValidator,
  getMetricValidator,
  putMetricValidator,
  deleteMetricValidator,
  // Dimensions
  listDimensionsValidator,
  postDimensionValidator,
  getDimensionValidator,
  updateDimensionValidator,
  deleteDimensionValidator,
  // Segments
  listSegmentsValidator,
  postSegmentValidator,
  getSegmentValidator,
  updateSegmentValidator,
  deleteSegmentValidator,
  // Experiments
  listExperimentsValidator,
  postExperimentValidator,
  getExperimentValidator,
  updateExperimentValidator,
  // Data Sources
  listDataSourcesValidator,
  // Fact Tables
  deleteFactMetricValidator,
  deleteFactTableFilterValidator,
  deleteFactTableValidator,
  getFactMetricValidator,
  getFactTableFilterValidator,
  getFactTableValidator,
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

let passed = 0;
let failed = 0;

// Rate limiting: track request timestamps to avoid 429s
const requestTimestamps: number[] = [];
const RATE_LIMIT = 55; // stay under the 60/min limit
const RATE_WINDOW = 60_000;

async function throttle() {
  const now = Date.now();
  // Remove timestamps outside the window
  while (requestTimestamps.length && requestTimestamps[0] < now - RATE_WINDOW) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT) {
    const waitMs = requestTimestamps[0] + RATE_WINDOW - now + 100;
    console.log(`  (rate limit pause: ${waitMs}ms)`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  requestTimestamps.push(Date.now());
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    failed++;
    console.error(`  FAIL: ${message}`);
  } else {
    passed++;
  }
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

  await throttle();
  console.log(`  ${validator.method.toUpperCase()} ${url}`);

  const res = await fetch(url, {
    method: validator.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();

  if (!res.ok) {
    console.error(`    ${res.status}: ${JSON.stringify(json)}`);
  }

  return json as z.infer<T["responseSchema"]>;
}

// ---------------------------------------------------------------------------
// Phase 1: Standalone resources (no dependencies)
// ---------------------------------------------------------------------------

async function testProjects() {
  console.log("\n--- Projects ---");

  const project = (
    await req(postProjectValidator, {
      body: { name: "Integration Test Project" },
    })
  ).project;
  assert(!!project, "create project");

  const projects = (await req(listProjectsValidator)).projects;
  assert(
    projects.some((p: { id: string }) => p.id === project.id),
    "list projects includes created",
  );

  const fetched = (
    await req(getProjectValidator, { params: { id: project.id } })
  ).project;
  assert(fetched.id === project.id, "get project by id");

  const updated = (
    await req(putProjectValidator, {
      params: { id: project.id },
      body: { name: "Integration Test Project (updated)" },
    })
  ).project;
  assert(
    updated.name === "Integration Test Project (updated)",
    "update project",
  );

  const deletedId = (
    await req(deleteProjectValidator, { params: { id: project.id } })
  ).deletedId;
  assert(deletedId === project.id, "delete project");
}

async function testEnvironments() {
  console.log("\n--- Environments ---");

  const env = (
    await req(postEnvironmentValidator, {
      body: { id: "integration-test-env", description: "Test environment" },
    })
  ).environment;
  assert(!!env, "create environment");

  const envs = (await req(listEnvironmentsValidator)).environments;
  assert(
    envs.some((e: { id: string }) => e.id === "integration-test-env"),
    "list environments includes created",
  );

  const updated = (
    await req(putEnvironmentValidator, {
      params: { id: "integration-test-env" },
      body: { description: "Updated description" },
    })
  ).environment;
  assert(updated.description === "Updated description", "update environment");

  const deletedId = (
    await req(deleteEnvironmentValidator, {
      params: { id: "integration-test-env" },
    })
  ).deletedId;
  assert(deletedId === "integration-test-env", "delete environment");
}

async function testAttributes() {
  console.log("\n--- Attributes ---");

  const attr = (
    await req(postAttributeValidator, {
      body: { property: "integration_test_attr", datatype: "string" },
    })
  ).attribute;
  assert(!!attr, "create attribute");

  const attrs = (await req(listAttributesValidator)).attributes;
  assert(
    attrs.some(
      (a: { property: string }) => a.property === "integration_test_attr",
    ),
    "list attributes includes created",
  );

  const updated = (
    await req(putAttributeValidator, {
      params: { property: "integration_test_attr" },
      body: { datatype: "number" },
    })
  ).attribute;
  assert(updated.datatype === "number", "update attribute");

  await req(deleteAttributeValidator, {
    params: { property: "integration_test_attr" },
  });
  passed++;
  // Verify deletion
  const attrsAfter = (await req(listAttributesValidator)).attributes;
  assert(
    !attrsAfter.some(
      (a: { property: string }) => a.property === "integration_test_attr",
    ),
    "delete attribute",
  );
}

async function testArchetypes() {
  console.log("\n--- Archetypes ---");

  const archetype = (
    await req(postArchetypeValidator, {
      body: {
        name: "Integration Test Archetype",
        isPublic: true,
        attributes: {},
      },
    })
  ).archetype;
  assert(!!archetype, "create archetype");

  const archetypes = (await req(listArchetypesValidator)).archetypes;
  assert(
    archetypes.some((a: { id: string }) => a.id === archetype.id),
    "list archetypes includes created",
  );

  const fetched = (
    await req(getArchetypeValidator, { params: { id: archetype.id } })
  ).archetype;
  assert(fetched.id === archetype.id, "get archetype by id");

  const updated = (
    await req(putArchetypeValidator, {
      params: { id: archetype.id },
      body: { name: "Integration Test Archetype (updated)" },
    })
  ).archetype;
  assert(
    updated.name === "Integration Test Archetype (updated)",
    "update archetype",
  );

  const deletedId = (
    await req(deleteArchetypeValidator, { params: { id: archetype.id } })
  ).deletedId;
  assert(deletedId === archetype.id, "delete archetype");
}

// ---------------------------------------------------------------------------
// Phase 2: Light dependencies
// ---------------------------------------------------------------------------

async function testSavedGroups() {
  console.log("\n--- Saved Groups ---");

  const group = (
    await req(postSavedGroupValidator, {
      body: {
        name: "Integration Test Group",
        type: "list",
        attributeKey: "id",
        values: ["a", "b", "c"],
      },
    })
  ).savedGroup;
  assert(!!group, "create saved group");

  const groups = (await req(listSavedGroupsValidator)).savedGroups;
  assert(
    groups.some((g: { id: string }) => g.id === group.id),
    "list saved groups includes created",
  );

  const fetched = (
    await req(getSavedGroupValidator, { params: { id: group.id } })
  ).savedGroup;
  assert(fetched.id === group.id, "get saved group by id");

  const updated = (
    await req(updateSavedGroupValidator, {
      params: { id: group.id },
      body: { name: "Integration Test Group (updated)" },
    })
  ).savedGroup;
  assert(
    updated.name === "Integration Test Group (updated)",
    "update saved group",
  );

  const deletedId = (
    await req(deleteSavedGroupValidator, { params: { id: group.id } })
  ).deletedId;
  assert(deletedId === group.id, "delete saved group");
}

async function testSdkConnections() {
  console.log("\n--- SDK Connections ---");

  // Create a temporary environment for the SDK connection
  await req(postEnvironmentValidator, {
    body: { id: "sdk-test-env", description: "Temp env for SDK test" },
  });

  const conn = (
    await req(postSdkConnectionValidator, {
      body: {
        name: "Integration Test SDK",
        language: "javascript",
        environment: "sdk-test-env",
      },
    })
  ).sdkConnection;
  assert(!!conn, "create sdk connection");

  const conns = (await req(listSdkConnectionsValidator)).connections;
  assert(
    conns.some((c: { id: string }) => c.id === conn.id),
    "list sdk connections includes created",
  );

  const fetched = (
    await req(getSdkConnectionValidator, { params: { id: conn.id } })
  ).sdkConnection;
  assert(fetched.id === conn.id, "get sdk connection by id");

  const updated = (
    await req(putSdkConnectionValidator, {
      params: { id: conn.id },
      body: { name: "Integration Test SDK (updated)" },
    })
  ).sdkConnection;
  assert(
    updated.name === "Integration Test SDK (updated)",
    "update sdk connection",
  );

  const deletedId = (
    await req(deleteSdkConnectionValidator, { params: { id: conn.id } })
  ).deletedId;
  assert(deletedId === conn.id, "delete sdk connection");

  // Cleanup temp environment
  await req(deleteEnvironmentValidator, { params: { id: "sdk-test-env" } });
}

async function testFeatures() {
  console.log("\n--- Features ---");

  const feature = (
    await req(postFeatureValidator, {
      body: {
        id: "integration-test-feature",
        valueType: "boolean",
        defaultValue: "false",
        owner: "integration-test",
      },
    })
  ).feature;
  assert(!!feature, "create feature");

  const features = (await req(listFeaturesValidator)).features;
  assert(
    features.some((f: { id: string }) => f.id === "integration-test-feature"),
    "list features includes created",
  );

  const fetched = (
    await req(getFeatureValidator, {
      params: { id: "integration-test-feature" },
    })
  ).feature;
  assert(fetched.id === "integration-test-feature", "get feature by id");

  const updated = (
    await req(updateFeatureValidator, {
      params: { id: "integration-test-feature" },
      body: { description: "Updated via integration test" },
    })
  ).feature;
  assert(
    updated.description === "Updated via integration test",
    "update feature",
  );

  const deletedId = (
    await req(deleteFeatureValidator, {
      params: { id: "integration-test-feature" },
    })
  ).deletedId;
  assert(deletedId === "integration-test-feature", "delete feature");
}

// ---------------------------------------------------------------------------
// Phase 3: Datasource-dependent
// ---------------------------------------------------------------------------

async function testMetrics(datasourceId: string, identifierType: string) {
  console.log("\n--- Metrics ---");

  const metric = (
    await req(postMetricValidator, {
      body: {
        datasourceId,
        name: "Integration Test Metric",
        type: "binomial",
        sql: {
          identifierTypes: [identifierType],
          conversionSQL: `SELECT ${identifierType} as ${identifierType}, '2026-01-01' as timestamp`,
        },
      },
    })
  ).metric;
  assert(!!metric, "create metric");

  const metrics = (await req(listMetricsValidator)).metrics;
  assert(
    metrics.some((m: { id: string }) => m.id === metric.id),
    "list metrics includes created",
  );

  const fetched = (await req(getMetricValidator, { params: { id: metric.id } }))
    .metric;
  assert(fetched.id === metric.id, "get metric by id");

  const updateRes = await req(putMetricValidator, {
    params: { id: metric.id },
    body: { name: "Integration Test Metric (updated)" },
  });
  assert(updateRes.updatedId === metric.id, "update metric");

  const deletedId = (
    await req(deleteMetricValidator, { params: { id: metric.id } })
  ).deletedId;
  assert(deletedId === metric.id, "delete metric");
}

async function testDimensions(datasourceId: string, identifierType: string) {
  console.log("\n--- Dimensions ---");

  const dimension = (
    await req(postDimensionValidator, {
      body: {
        datasourceId,
        name: "Integration Test Dimension",
        identifierType,
        query: `SELECT ${identifierType} as ${identifierType}, 'test' as value`,
      },
    })
  ).dimension;
  assert(!!dimension, "create dimension");

  const dimensions = (await req(listDimensionsValidator)).dimensions;
  assert(
    dimensions.some((d: { id: string }) => d.id === dimension.id),
    "list dimensions includes created",
  );

  const fetched = (
    await req(getDimensionValidator, { params: { id: dimension.id } })
  ).dimension;
  assert(fetched.id === dimension.id, "get dimension by id");

  const updated = (
    await req(updateDimensionValidator, {
      params: { id: dimension.id },
      body: { name: "Integration Test Dimension (updated)" },
    })
  ).dimension;
  assert(
    updated.name === "Integration Test Dimension (updated)",
    "update dimension",
  );

  const deletedId = (
    await req(deleteDimensionValidator, { params: { id: dimension.id } })
  ).deletedId;
  assert(deletedId === dimension.id, "delete dimension");
}

async function testSegments(datasourceId: string, identifierType: string) {
  console.log("\n--- Segments ---");

  const segment = (
    await req(postSegmentValidator, {
      body: {
        datasourceId,
        name: "Integration Test Segment",
        identifierType,
        type: "SQL",
        query: `SELECT ${identifierType} as ${identifierType}`,
      },
    })
  ).segment;
  assert(!!segment, "create segment");

  const segments = (await req(listSegmentsValidator)).segments;
  assert(
    segments.some((s: { id: string }) => s.id === segment.id),
    "list segments includes created",
  );

  const fetched = (
    await req(getSegmentValidator, { params: { id: segment.id } })
  ).segment;
  assert(fetched.id === segment.id, "get segment by id");

  const updated = (
    await req(updateSegmentValidator, {
      params: { id: segment.id },
      body: { name: "Integration Test Segment (updated)", owner: "" },
    })
  ).segment;
  assert(
    updated.name === "Integration Test Segment (updated)",
    "update segment",
  );

  const deletedId = (
    await req(deleteSegmentValidator, { params: { id: segment.id } })
  ).deletedId;
  assert(deletedId === segment.id, "delete segment");
}

// ---------------------------------------------------------------------------
// Phase 4: Complex resources
// ---------------------------------------------------------------------------

async function testExperiments(
  datasourceId?: string,
  assignmentQueryId?: string,
) {
  console.log("\n--- Experiments ---");

  const experiment = (
    await req(postExperimentValidator, {
      body: {
        name: "Integration Test Experiment",
        trackingKey: "integration-test-exp",
        variations: [
          { name: "Control", key: "0" },
          { name: "Treatment", key: "1" },
        ],
        ...(datasourceId && assignmentQueryId
          ? { datasourceId, assignmentQueryId }
          : {}),
      },
    })
  ).experiment;
  assert(!!experiment, "create experiment");
  if (!experiment) return;

  const experiments = (await req(listExperimentsValidator)).experiments;
  assert(
    experiments.some((e: { id: string }) => e.id === experiment.id),
    "list experiments includes created",
  );

  const fetched = (
    await req(getExperimentValidator, { params: { id: experiment.id } })
  ).experiment;
  assert(fetched.id === experiment.id, "get experiment by id");

  const updated = (
    await req(updateExperimentValidator, {
      params: { id: experiment.id },
      body: { description: "Updated via integration test" },
    })
  ).experiment;
  assert(
    updated.description === "Updated via integration test",
    "update experiment",
  );

  // Experiments don't have a delete endpoint — archive instead
  const archived = (
    await req(updateExperimentValidator, {
      params: { id: experiment.id },
      body: { archived: true },
    })
  ).experiment;
  assert(archived.archived === true, "archive experiment");
}

// ---------------------------------------------------------------------------
// Fact Tables, Fact Metrics, Bulk Import (existing tests, preserved)
// ---------------------------------------------------------------------------

async function testFactTablesAndMetrics(
  datasourceId: string,
  userIdTypes: string[],
) {
  console.log("\n--- Fact Tables ---");

  const sql = `SELECT ${userIdTypes.map((t) => `'${t}' as ${t},`).join(" ")} 10 as amount, '2026-01-01 00:00:00' as timestamp`;

  // Create a fact table
  const factTable = (
    await req(postFactTableValidator, {
      body: {
        name: "My Fact Table",
        datasource: datasourceId,
        userIdTypes,
        sql,
      },
    })
  ).factTable;
  assert(!!factTable, "create fact table");

  // List all fact tables
  const factTables = (await req(listFactTablesValidator)).factTables;
  assert(
    factTables.some((f: { id: string }) => f.id === factTable.id),
    "list fact tables includes created",
  );

  // Get a single fact table
  const factTableById = (
    await req(getFactTableValidator, { params: { id: factTable.id } })
  ).factTable;
  assert(!!factTableById, "get fact table by id");

  // Update a fact table
  const updatedFactTable = (
    await req(updateFactTableValidator, {
      params: { id: factTable.id },
      body: { name: "My Fact Table (updated)" },
    })
  ).factTable;
  assert(
    updatedFactTable?.name === "My Fact Table (updated)",
    "update fact table",
  );

  console.log("\n--- Fact Table Filters ---");

  // Create a fact table filter
  const factTableFilter = (
    await req(postFactTableFilterValidator, {
      params: { factTableId: factTable.id },
      body: { name: "Expensive", value: "amount > 10" },
    })
  ).factTableFilter;
  assert(!!factTableFilter, "create fact table filter");

  // List all fact table filters
  const factTableFilters = (
    await req(listFactTableFiltersValidator, {
      params: { factTableId: factTable.id },
    })
  ).factTableFilters;
  assert(
    factTableFilters.some((f: { id: string }) => f.id === factTableFilter.id),
    "list fact table filters includes created",
  );

  // Get a single fact table filter
  const factTableFilterById = (
    await req(getFactTableFilterValidator, {
      params: { factTableId: factTable.id, id: factTableFilter.id },
    })
  ).factTableFilter;
  assert(!!factTableFilterById, "get fact table filter by id");

  // Update a fact table filter
  const updatedFactTableFilter = (
    await req(updateFactTableFilterValidator, {
      params: { factTableId: factTable.id, id: factTableFilter.id },
      body: { name: "Expensive (updated)" },
    })
  ).factTableFilter;
  assert(
    updatedFactTableFilter?.name === "Expensive (updated)",
    "update fact table filter",
  );

  console.log("\n--- Fact Metrics ---");

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
  assert(!!factMetric, "create fact metric");

  // List all fact metrics
  const factMetrics = (await req(listFactMetricsValidator)).factMetrics;
  assert(
    factMetrics.some((f: { id: string }) => f.id === factMetric.id),
    "list fact metrics includes created",
  );

  // Get a single fact metric
  const factMetricById = (
    await req(getFactMetricValidator, { params: { id: factMetric.id } })
  ).factMetric;
  assert(!!factMetricById, "get fact metric by id");

  // Update a fact metric
  const updatedFactMetric = (
    await req(updateFactMetricValidator, {
      params: { id: factMetric.id },
      body: { name: "Revenue (updated)" },
    })
  ).factMetric;
  assert(updatedFactMetric?.name === "Revenue (updated)", "update fact metric");

  // Delete fact metric
  const deletedFactMetric = (
    await req(deleteFactMetricValidator, { params: { id: factMetric.id } })
  ).deletedId;
  assert(deletedFactMetric === factMetric.id, "delete fact metric");

  // Delete fact table filter
  const deletedFactTableFilter = (
    await req(deleteFactTableFilterValidator, {
      params: { factTableId: factTable.id, id: factTableFilter.id },
    })
  ).deletedId;
  assert(
    deletedFactTableFilter === factTableFilter.id,
    "delete fact table filter",
  );

  // Delete fact table
  const deletedFactTable = (
    await req(deleteFactTableValidator, { params: { id: factTable.id } })
  ).deletedId;
  assert(deletedFactTable === factTable.id, "delete fact table");

  console.log("\n--- Bulk Import ---");

  // Bulk Import (insert)
  const bulkRes = await req(postBulkImportFactsValidator, {
    body: {
      factTables: [
        {
          id: "orders",
          data: {
            name: "My Orders",
            datasource: datasourceId,
            userIdTypes,
            sql,
          },
        },
      ],
      factTableFilters: [
        {
          id: "high_value",
          factTableId: "orders",
          data: { name: "High Value", value: "amount > 120" },
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
            denominator: { factTableId: "orders", column: "$$COUNT" },
          },
        },
      ],
    },
  });
  assert(!!bulkRes.success, "bulk import insert");

  // Bulk Import (update)
  const bulkUpdateRes = await req(postBulkImportFactsValidator, {
    body: {
      factTables: [
        {
          id: "orders",
          data: {
            name: "My Orders (updated)",
            datasource: datasourceId,
            userIdTypes,
            sql,
          },
        },
      ],
      factTableFilters: [
        {
          id: "high_value",
          factTableId: "orders",
          data: { name: "High Value (updated)", value: "amount > 120" },
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
            denominator: { factTableId: "orders", column: "$$COUNT" },
          },
        },
      ],
    },
  });
  assert(!!bulkUpdateRes.success, "bulk import update");

  // Verify that the bulk import worked
  const orders = (
    await req(getFactTableValidator, { params: { id: "orders" } })
  ).factTable;
  assert(orders?.name === "My Orders (updated)", "bulk import verify table");

  const highValue = (
    await req(getFactTableFilterValidator, {
      params: { factTableId: "orders", id: "high_value" },
    })
  ).factTableFilter;
  assert(
    highValue?.name === "High Value (updated)",
    "bulk import verify filter",
  );

  const revenuePerUser = (
    await req(getFactMetricValidator, { params: { id: "revenue_per_user" } })
  ).factMetric;
  assert(
    revenuePerUser?.name === "Average Order Value (updated)",
    "bulk import verify metric",
  );

  // Cleanup bulk imported data
  await req(deleteFactMetricValidator, { params: { id: "revenue_per_user" } });
  await req(deleteFactTableFilterValidator, {
    params: { factTableId: "orders", id: "high_value" },
  });
  await req(deleteFactTableValidator, { params: { id: "orders" } });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log(`Testing REST API at ${host}\n`);

  const tests: Array<{ name: string; fn: () => Promise<void> }> = [];

  // Phase 1: Standalone resources
  tests.push({ name: "Projects", fn: testProjects });
  tests.push({ name: "Environments", fn: testEnvironments });
  tests.push({ name: "Attributes", fn: testAttributes });
  tests.push({ name: "Archetypes", fn: testArchetypes });

  // Phase 2: Light dependencies
  tests.push({ name: "Saved Groups", fn: testSavedGroups });
  tests.push({ name: "SDK Connections", fn: testSdkConnections });
  tests.push({ name: "Features", fn: testFeatures });

  // Phase 3: Datasource-dependent
  const dataSources = (await req(listDataSourcesValidator)).dataSources;
  const datasource = dataSources[0];
  if (datasource) {
    console.log(`\nUsing data source: ${datasource.name} (${datasource.id})`);
    const userIdTypes = datasource.identifierTypes.map(
      (t: { id: string }) => t.id,
    );

    tests.push({
      name: "Metrics",
      fn: () => testMetrics(datasource.id, userIdTypes[0]),
    });
    tests.push({
      name: "Dimensions",
      fn: () => testDimensions(datasource.id, userIdTypes[0]),
    });
    tests.push({
      name: "Segments",
      fn: () => testSegments(datasource.id, userIdTypes[0]),
    });
    tests.push({
      name: "Fact Tables & Metrics",
      fn: () => testFactTablesAndMetrics(datasource.id, userIdTypes),
    });
  } else {
    console.log(
      "\nNo data sources found — skipping datasource-dependent tests",
    );
  }

  // Phase 4: Complex resources
  if (datasource) {
    const assignmentQuery = datasource.assignmentQueries?.[0];
    tests.push({
      name: "Experiments",
      fn: () => testExperiments(datasource.id, assignmentQuery?.id),
    });
  } else {
    tests.push({ name: "Experiments", fn: () => testExperiments() });
  }

  for (const test of tests) {
    try {
      await test.fn();
    } catch (err) {
      failed++;
      console.error(`  CRASH in ${test.name}: ${err}`);
    }
  }

  // Summary
  console.log(`\n${"=".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
