import { getDashboardBlockResourceRefs } from "shared/enterprise";
import type { DashboardBlockInterface } from "shared/enterprise";

// Minimal block fixtures — getDashboardBlockResourceRefs only inspects the
// discriminant `type` and the resource id fields, so partial objects are enough.
function block(fields: Record<string, unknown>): DashboardBlockInterface {
  return {
    organization: "org_1",
    id: "block_1",
    uid: "uid_1",
    title: "",
    description: "",
    ...fields,
  } as unknown as DashboardBlockInterface;
}

describe("getDashboardBlockResourceRefs", () => {
  it("returns no refs for a markdown block", () => {
    expect(
      getDashboardBlockResourceRefs(
        block({ type: "markdown", content: "hello" }),
      ),
    ).toEqual([]);
  });

  it("extracts the experiment ref from experiment blocks", () => {
    expect(
      getDashboardBlockResourceRefs(
        block({ type: "experiment-metadata", experimentId: "exp_1" }),
      ),
    ).toEqual([{ type: "experiment", id: "exp_1" }]);
  });

  it("extracts the saved query ref from a sql-explorer block", () => {
    expect(
      getDashboardBlockResourceRefs(
        block({ type: "sql-explorer", savedQueryId: "sq_1" }),
      ),
    ).toEqual([{ type: "savedQuery", id: "sq_1" }]);
  });

  it("extracts the fact metric ref from a metric-explorer block", () => {
    expect(
      getDashboardBlockResourceRefs(
        block({ type: "metric-explorer", factMetricId: "fmet_1" }),
      ),
    ).toEqual([{ type: "factMetric", id: "fmet_1" }]);
  });

  it("extracts the datasource ref from a metric-exploration block", () => {
    expect(
      getDashboardBlockResourceRefs(
        block({
          type: "metric-exploration",
          config: { datasource: "ds_1" },
        }),
      ),
    ).toEqual([{ type: "datasource", id: "ds_1" }]);
  });

  it("extracts datasource and fact table refs from a fact-table-exploration block", () => {
    expect(
      getDashboardBlockResourceRefs(
        block({
          type: "fact-table-exploration",
          config: { datasource: "ds_1", dataset: { factTableId: "ftbl_1" } },
        }),
      ),
    ).toEqual([
      { type: "datasource", id: "ds_1" },
      { type: "factTable", id: "ftbl_1" },
    ]);
  });

  it("extracts only the datasource ref from a data-source-exploration block", () => {
    expect(
      getDashboardBlockResourceRefs(
        block({
          type: "data-source-exploration",
          config: { datasource: "ds_1" },
        }),
      ),
    ).toEqual([{ type: "datasource", id: "ds_1" }]);
  });

  it("skips empty ids", () => {
    expect(
      getDashboardBlockResourceRefs(
        block({ type: "experiment-metadata", experimentId: "" }),
      ),
    ).toEqual([]);
  });

  it("skips a null fact table id", () => {
    expect(
      getDashboardBlockResourceRefs(
        block({
          type: "fact-table-exploration",
          config: { datasource: "ds_1", dataset: { factTableId: null } },
        }),
      ),
    ).toEqual([{ type: "datasource", id: "ds_1" }]);
  });
});
