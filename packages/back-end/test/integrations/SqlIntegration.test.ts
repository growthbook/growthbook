import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import { ExperimentFactMetricsQueryParams } from "shared/types/integrations";
import Postgres from "back-end/src/integrations/Postgres";
import { factTableFactory } from "../factories/FactTable.factory";
import { factMetricFactory } from "../factories/FactMetric.factory";

describe("SqlIntegration identity CTE generation", () => {
  let integration: Postgres;

  const exposureQuery: ExposureQuery = {
    id: "exposure",
    name: "Exposure",
    description: "",
    query:
      "SELECT device_id as device_id, timestamp, exp_id as experiment_id, variant_id as variation_id FROM exposures",
    userIdType: "device_id",
    dimensions: [],
  };

  const settings: ExperimentSnapshotSettings = {
    manual: false,
    dimensions: [],
    metricSettings: [],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: "fact_activation",
    defaultMetricPriorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 0,
    },
    regressionAdjustmentEnabled: false,
    attributionModel: "firstExposure",
    experimentId: "exp_1",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "ds_1",
    exposureQueryId: "exposure",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-01-31"),
    variations: [],
  };

  beforeEach(() => {
    // @ts-expect-error -- context/datasource not needed for this unit test
    integration = new Postgres("", {});
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(integration as any, "getExposureQuery")
      .mockReturnValue(exposureQuery);
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(integration as any, "getIdentitiesQuery")
      .mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (_settings: any, baseIdType: string, idType: string) =>
          `SELECT ${baseIdType}, ${idType} FROM identity_map`,
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Repro: when a fact table gains a second identifier that matches another
  // metric's fact table identifier, the identity CTE picked for the activation
  // metric's JOIN can diverge from what's emitted as a CTE, producing a JOIN
  // to a nonexistent `__identities_X` table.
  it("emits every `__identities_X` CTE it references in a JOIN", () => {
    // Events fact table has BOTH visitor_id and rle_nummer.
    // Sales fact table has only rle_nummer.
    const eventsFactTable = factTableFactory.build({
      id: "ft_events",
      name: "Events",
      userIdTypes: ["visitor_id", "rle_nummer"],
      sql: "SELECT visitor_id, rle_nummer, timestamp FROM events",
      columns: [
        {
          column: "timestamp",
          datatype: "date",
          name: "timestamp",
          numberFormat: "",
          deleted: false,
          dateCreated: new Date(),
          dateUpdated: new Date(),
        },
      ],
    });
    const salesFactTable = factTableFactory.build({
      id: "ft_sales",
      name: "Sales",
      userIdTypes: ["rle_nummer"],
      sql: "SELECT rle_nummer, media_type, timestamp FROM sales",
      columns: [
        {
          column: "timestamp",
          datatype: "date",
          name: "timestamp",
          numberFormat: "",
          deleted: false,
          dateCreated: new Date(),
          dateUpdated: new Date(),
        },
      ],
    });
    const factTableMap = new Map([
      ["ft_events", eventsFactTable],
      ["ft_sales", salesFactTable],
    ]);

    // Activation metric: proportion on events (could fire on visitor_id OR rle_nummer).
    const activationMetric = factMetricFactory.build({
      id: "fact_activation",
      name: "activation",
      metricType: "proportion",
      numerator: {
        factTableId: "ft_events",
        column: "$$distinctUsers",
        aggregation: "sum",
        rowFilters: [],
      },
      windowSettings: {
        type: "",
        delayValue: 0,
        delayUnit: "hours",
        windowValue: 0,
        windowUnit: "hours",
      },
    });

    // Guardrail metric: proportion on sales (must join via rle_nummer).
    const guardrailMetric = factMetricFactory.build({
      id: "fact_guardrail",
      name: "guardrail",
      metricType: "proportion",
      numerator: {
        factTableId: "ft_sales",
        column: "$$distinctUsers",
        aggregation: "sum",
        rowFilters: [],
      },
      windowSettings: {
        type: "",
        delayValue: 0,
        delayUnit: "hours",
        windowValue: 0,
        windowUnit: "hours",
      },
    });

    const params: ExperimentFactMetricsQueryParams = {
      settings,
      activationMetric,
      metrics: [guardrailMetric],
      factTableMap,
      dimensions: [],
      segment: null,
      unitsSource: "exposureQuery",
    };

    const sql = integration.getExperimentFactMetricsQuery(params);

    const joinRefs = new Set<string>();
    for (const match of sql.matchAll(/JOIN\s+(__identities_\w+)/gi)) {
      joinRefs.add(match[1]);
    }
    const cteDefs = new Set<string>();
    for (const match of sql.matchAll(/(__identities_\w+)\s+as\s*\(/gi)) {
      cteDefs.add(match[1]);
    }

    // Every `__identities_X` we JOIN to must be declared as a CTE.
    for (const ref of joinRefs) {
      expect(cteDefs).toContain(ref);
    }
  });
});
