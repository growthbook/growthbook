import { apiUpdateDashboardBody } from "shared/enterprise";

// The payload an agent sends to change one saved tile: the block as the GET
// returned it, minus the two keys that belong to the server. It has to parse —
// rejecting it pushes callers to drop the `id`, which recreates the tile.
const savedBlock: Record<string, unknown> & { id: string } = {
  organization: "org_1",
  id: "dshblk_1",
  uid: "uid_1",
  type: "metric-exploration" as const,
  title: "Revenue per User over time",
  description: "",
  layout: { x: 0, y: 7, w: 12, h: 8 },
  config: {
    datasource: "ds_1",
    dimensions: [
      {
        dimensionType: "date" as const,
        column: null,
        dateGranularity: "auto" as const,
      },
    ],
    chartType: "line" as const,
    dateRange: { predefined: "last30Days" as const },
    type: "metric" as const,
    dataset: {
      type: "metric" as const,
      values: [
        {
          name: "Revenue per User",
          rowFilters: [],
          type: "metric" as const,
          metricId: "fact__a",
          unit: "user_id",
          denominatorUnit: null,
        },
      ],
    },
  },
};

const parse = (block: unknown) =>
  apiUpdateDashboardBody.safeParse({ blocks: [block] });

describe("updating a saved dashboard block", () => {
  it("accepts a full block that carries uid and organization", () => {
    expect(parse(savedBlock).success).toBe(true);
  });

  // What an agent actually sends to change one tile, and what it sent before
  // this parsed: id plus the fields it means to change, no server-owned keys.
  it("accepts an id with a partial block", () => {
    const { uid, organization, ...block } = savedBlock;
    expect(parse(block).success).toBe(true);
    expect([uid, organization]).toHaveLength(2);
  });

  // Dropping the analysis id is how an edit asks for the chart to re-run.
  it("accepts a changed chart with no explorerAnalysisId", () => {
    const block = { ...savedBlock, explorerAnalysisId: undefined };
    expect(parse(block).success).toBe(true);
  });

  it("still accepts a bare ref", () => {
    expect(parse({ id: "dshblk_1" }).success).toBe(true);
  });

  it("still accepts a new block with no id", () => {
    const { id, uid, organization, ...newBlock } = savedBlock;
    expect(parse(newBlock).success).toBe(true);
    expect([id, uid, organization]).toHaveLength(3);
  });
});
