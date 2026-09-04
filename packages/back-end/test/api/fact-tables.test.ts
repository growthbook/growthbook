import {
  ColumnInterface,
  FactTableInterface,
  UpdateFactTableProps,
} from "shared/types/fact-table";
import { needsColumnRefresh } from "back-end/src/api/fact-tables/updateFactTable";
import { columnsNeedDetection } from "back-end/src/util/factTable";

const existing: Pick<
  FactTableInterface,
  "sql" | "eventName" | "timestampColumn" | "userIdColumns"
> = {
  sql: "SELECT user_id, timestamp FROM events",
  eventName: "purchase",
};

describe("needsColumnRefresh", () => {
  it("returns false when no sql or eventName is in the changes", () => {
    const changes: UpdateFactTableProps = { name: "Renamed" };
    expect(needsColumnRefresh(existing, changes)).toBe(false);
  });

  it("returns false when sql and eventName are resent unchanged", () => {
    const changes: UpdateFactTableProps = {
      name: "Renamed",
      sql: existing.sql,
      eventName: existing.eventName,
    };
    expect(needsColumnRefresh(existing, changes)).toBe(false);
  });

  it("returns true when sql changes", () => {
    const changes: UpdateFactTableProps = {
      sql: "SELECT user_id, timestamp, country FROM events",
    };
    expect(needsColumnRefresh(existing, changes)).toBe(true);
  });

  it("returns true for a whitespace-only sql edit (over-flags, the safe direction)", () => {
    const changes: UpdateFactTableProps = { sql: existing.sql + "\n" };
    expect(needsColumnRefresh(existing, changes)).toBe(true);
  });

  it("returns true when eventName changes", () => {
    const changes: UpdateFactTableProps = { eventName: "checkout" };
    expect(needsColumnRefresh(existing, changes)).toBe(true);
  });

  it("treats a set value against a missing stored value as a change", () => {
    const blank: Pick<FactTableInterface, "sql" | "eventName"> = {
      sql: "",
      eventName: "",
    };
    const changes: UpdateFactTableProps = { sql: existing.sql };
    expect(needsColumnRefresh(blank, changes)).toBe(true);
  });

  // The refresh is what re-derives userIdTypes from the mapping and re-runs
  // detection with the new date filter, so a real mapping change has to trigger
  // one -- but a resent no-op mustn't ("" and "timestamp" are the same column).
  it("triggers only on a real column mapping change", () => {
    expect(
      needsColumnRefresh(existing, { timestampColumn: "event_time" }),
    ).toBe(true);
    expect(
      needsColumnRefresh(existing, { userIdColumns: { user_id: "userId" } }),
    ).toBe(true);
    expect(needsColumnRefresh(existing, { timestampColumn: "" })).toBe(false);
    expect(needsColumnRefresh(existing, { timestampColumn: "timestamp" })).toBe(
      false,
    );
    expect(
      needsColumnRefresh(
        { ...existing, userIdColumns: { user_id: "userId" } },
        { userIdColumns: { user_id: "userId" } },
      ),
    ).toBe(false);
  });
});

describe("columnsNeedDetection", () => {
  const makeColumn = (
    column: string,
    datatype: ColumnInterface["datatype"],
  ): ColumnInterface => ({
    column,
    name: column,
    description: "",
    numberFormat: "",
    datatype,
    dateCreated: new Date("2020-01-01"),
    dateUpdated: new Date("2020-01-01"),
    deleted: false,
  });

  it("returns false when columns is undefined", () => {
    expect(columnsNeedDetection()).toBe(false);
  });

  it("returns false for an empty array", () => {
    expect(columnsNeedDetection([])).toBe(false);
  });

  it("returns false when every column already has a datatype", () => {
    expect(
      columnsNeedDetection([
        makeColumn("amount", "number"),
        makeColumn("country", "string"),
      ]),
    ).toBe(false);
  });

  it("returns true when a column has an empty datatype (new or reset)", () => {
    expect(
      columnsNeedDetection([
        makeColumn("amount", "number"),
        makeColumn("country", ""),
      ]),
    ).toBe(true);
  });
});
