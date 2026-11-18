import {
  getDimensionNullValue,
  getDimensionRequiredColumns,
  getDimensionTimestampColumns,
  getDimensionTiming,
  isTimedDimension,
} from "shared/experiments";

describe("dimension timing", () => {
  it("treats a missing timing as none", () => {
    expect(getDimensionTiming({})).toBe("none");
    expect(isTimedDimension({})).toBe(false);
    expect(isTimedDimension({ timing: "none" })).toBe(false);
    expect(isTimedDimension({ timing: "rowTimestamp" })).toBe(true);
    expect(isTimedDimension({ timing: "validityRange" })).toBe(true);
  });

  it("lists the timestamp columns each timing requires", () => {
    expect(getDimensionTimestampColumns("none")).toEqual([]);
    expect(getDimensionTimestampColumns("rowTimestamp")).toEqual(["timestamp"]);
    expect(getDimensionTimestampColumns("validityRange")).toEqual([
      "start_timestamp",
      "end_timestamp",
    ]);
  });

  it("builds the required column list from identifier, value and timing", () => {
    expect(getDimensionRequiredColumns({ userIdType: "user_id" })).toEqual([
      "user_id",
      "value",
    ]);
    expect(
      getDimensionRequiredColumns({
        userIdType: "anonymous_id",
        timing: "rowTimestamp",
      }),
    ).toEqual(["anonymous_id", "value", "timestamp"]);
    expect(
      getDimensionRequiredColumns({
        userIdType: "user_id",
        timing: "validityRange",
      }),
    ).toEqual(["user_id", "value", "start_timestamp", "end_timestamp"]);
    expect(getDimensionRequiredColumns({ userIdType: "" })[0]).toBe("user_id");
  });

  it("uses the null label when set and the fallback otherwise", () => {
    expect(getDimensionNullValue({}, "__NULL")).toBe("__NULL");
    expect(getDimensionNullValue({ nullLabel: "  " }, "__NULL")).toBe("__NULL");
    expect(getDimensionNullValue({ nullLabel: " Free " }, "__NULL")).toBe(
      "Free",
    );
  });
});
