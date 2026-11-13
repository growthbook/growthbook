import type { DataSourceInterface } from "shared/types/datasource";
import type { ReqContext } from "back-end/types/request";
import { validateDimensionBeforeSave } from "back-end/src/services/dimensions";

// A context/datasource that would blow up if the validator tried to build an
// integration or check permissions, so resolving proves the early return.
const context = {} as ReqContext;
const datasource = {} as DataSourceInterface;

const existing = {
  datasource: "ds_1",
  sql: "SELECT user_id, plan AS value FROM plans",
  userIdType: "user_id",
  timing: undefined,
};

describe("validateDimensionBeforeSave", () => {
  it("skips the warehouse check when the query-relevant fields are unchanged", async () => {
    await expect(
      validateDimensionBeforeSave(
        context,
        datasource,
        { ...existing, timing: "none" },
        existing,
      ),
    ).resolves.toBeUndefined();
  });

  it("still validates when the SQL changes", async () => {
    await expect(
      validateDimensionBeforeSave(
        context,
        datasource,
        { ...existing, sql: "SELECT 1" },
        existing,
      ),
    ).rejects.toThrow();
  });

  it("still validates when the timing changes", async () => {
    await expect(
      validateDimensionBeforeSave(
        context,
        datasource,
        { ...existing, timing: "rowTimestamp" },
        existing,
      ),
    ).rejects.toThrow();
  });
});
