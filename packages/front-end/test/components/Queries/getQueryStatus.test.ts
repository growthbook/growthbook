import { Queries } from "shared/types/query";
import { getQueryStatus } from "@/components/Queries/RunQueriesButton";

function queries(...statuses: Queries[number]["status"][]): Queries {
  return statuses.map((status, i) => ({
    query: `qry_${i}`,
    name: `Query ${i}`,
    status,
  }));
}

describe("getQueryStatus", () => {
  it.each(["running", "queued"] as const)(
    "treats a persisted error as terminal with a failed and a %s pointer",
    (pendingStatus) => {
      expect(
        getQueryStatus(queries("failed", pendingStatus), "Warehouse error"),
      ).toEqual({ status: "failed", numFailed: 1, failedNames: ["Query 0"] });
    },
  );

  it("treats a persisted error as terminal when all pointers are running", () => {
    expect(
      getQueryStatus(queries("running", "running"), "Analysis error"),
    ).toEqual({ status: "failed", numFailed: 0, failedNames: [] });
  });

  it.each([undefined, null, ""])(
    "keeps unfinished queries running without an error (%s)",
    (error) => {
      expect(getQueryStatus(queries("failed", "running"), error)).toEqual({
        status: "running",
        numFailed: 1,
        failedNames: ["Query 0"],
      });
    },
  );

  it("fails when half the queries failed", () => {
    expect(getQueryStatus(queries("failed", "succeeded"))).toEqual({
      status: "failed",
      numFailed: 1,
      failedNames: ["Query 0"],
    });
  });

  it("reports partial success and failed names when a minority failed", () => {
    expect(getQueryStatus(queries("failed", "succeeded", "succeeded"))).toEqual(
      {
        status: "partially-succeeded",
        numFailed: 1,
        failedNames: ["Query 0"],
      },
    );
  });
});
