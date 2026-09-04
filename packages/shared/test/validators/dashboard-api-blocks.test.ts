import {
  apiCreateDashboardBody,
  apiUpdateDashboardBody,
} from "../../src/enterprise/validators/dashboard";

// The payload an agent produces by reading a dashboard, appending a tile, and
// PUTting the whole thing back. Every server-owned key here came from the GET.
const newBlockFromRoundTrip = {
  organization: "org_1",
  type: "metric-exploration",
  title: "Revenue per User — past 1 year",
  description: "",
  layout: { x: 0, y: 24, w: 24, h: 8 },
  config: {
    datasource: "ds_1",
    dimensions: [
      { dimensionType: "date", column: null, dateGranularity: "auto" },
    ],
    chartType: "bar",
    dateRange: { predefined: "last12Months" },
    type: "metric",
    dataset: {
      type: "metric",
      values: [
        {
          type: "metric",
          name: "Revenue per User",
          metricId: "fact__1",
          unit: "user_id",
          denominatorUnit: null,
          rowFilters: [],
        },
      ],
    },
  },
};

const existingBlock = {
  ...newBlockFromRoundTrip,
  id: "dshblk_1",
  uid: "abc123",
  explorerAnalysisId: "ae_1",
};

describe("dashboard API block validation", () => {
  it("accepts a new block that still carries server-owned keys", () => {
    const result = apiUpdateDashboardBody.safeParse({
      blocks: [newBlockFromRoundTrip],
    });
    expect(result.success).toBe(true);
  });

  it("strips those keys rather than passing them through", () => {
    const parsed = apiUpdateDashboardBody.parse({
      blocks: [newBlockFromRoundTrip],
    });
    expect(parsed.blocks?.[0]).not.toHaveProperty("organization");
    expect(parsed.blocks?.[0]).not.toHaveProperty("uid");
  });

  it("leaves an existing block's ids intact", () => {
    const parsed = apiUpdateDashboardBody.parse({ blocks: [existingBlock] });
    expect(parsed.blocks?.[0]).toMatchObject({
      id: "dshblk_1",
      uid: "abc123",
      organization: "org_1",
    });
  });

  it("strips them on create too, where no block can be pre-existing", () => {
    const result = apiCreateDashboardBody.safeParse({
      title: "D",
      editLevel: "private",
      shareLevel: "private",
      enableAutoUpdates: false,
      blocks: [existingBlock],
    });
    expect(result.success).toBe(true);
    expect(result.data?.blocks?.[0]).not.toHaveProperty("id");
  });

  it("rejects globalControlSettings misplaced inside config", () => {
    const result = apiUpdateDashboardBody.safeParse({
      blocks: [
        {
          ...newBlockFromRoundTrip,
          config: {
            ...newBlockFromRoundTrip.config,
            globalControlSettings: { dateRange: true },
          },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a body round-tripped from a GET, server-owned fields and all", () => {
    const result = apiUpdateDashboardBody.safeParse({
      id: "dash_1",
      uid: "u1",
      organization: "org_1",
      userId: "u_1",
      isDefault: false,
      isDeleted: false,
      experimentId: "exp_1",
      dateCreated: "2026-09-03T16:40:36.685Z",
      dateUpdated: "2026-09-03T22:16:01.623Z",
      title: "Nhat's KPI Dashboard",
      editLevel: "private",
      shareLevel: "private",
      enableAutoUpdates: false,
      blocks: [newBlockFromRoundTrip],
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("organization");
    expect(result.data).not.toHaveProperty("experimentId");
    expect(result.data?.title).toBe("Nhat's KPI Dashboard");
  });

  it("takes a bare { id } as a reference to a saved block", () => {
    const result = apiUpdateDashboardBody.safeParse({
      blocks: [{ id: "dshblk_1" }, newBlockFromRoundTrip],
    });
    expect(result.success).toBe(true);
    expect(result.data?.blocks?.[0]).toEqual({ id: "dshblk_1" });
  });

  it("reads a block with an id and other fields as a full block, not a reference", () => {
    const parsed = apiUpdateDashboardBody.parse({ blocks: [existingBlock] });
    expect(parsed.blocks?.[0]).toMatchObject({
      id: "dshblk_1",
      title: existingBlock.title,
    });
  });

  it("still rejects a key that is not merely server-owned", () => {
    const result = apiUpdateDashboardBody.safeParse({
      title: "D",
      titel: "typo",
    });
    expect(result.success).toBe(false);
  });

  it("takes comparison at the top level, not inside globalControls", () => {
    const globalControls = {
      dateRange: { predefined: "last30Days" },
      dateGranularity: "auto",
    };
    expect(
      apiUpdateDashboardBody.safeParse({
        globalControls,
        comparison: { enabled: true, mode: "previousPeriod" },
      }).success,
    ).toBe(true);
    expect(
      apiUpdateDashboardBody.safeParse({
        globalControls: {
          ...globalControls,
          comparison: { enabled: true, mode: "previousPeriod" },
        },
      }).success,
    ).toBe(false);
  });
});
