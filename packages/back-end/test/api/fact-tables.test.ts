import mongoose from "mongoose";
import {
  ColumnInterface,
  FactTableInterface,
  UpdateFactTableProps,
} from "shared/types/fact-table";
import { updateFactTableValidator } from "shared/validators";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";
import {
  authorizeAndPersistFactTableUpdate,
  isUnchangedColumn,
  needsColumnRefresh,
} from "back-end/src/api/fact-tables/updateFactTable";
import { toFactTableColumnApiInterface } from "back-end/src/models/FactTableModel";
import { columnsNeedDetection } from "back-end/src/util/factTable";
import { ReqContext } from "back-end/types/request";

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

describe("authorizeAndPersistFactTableUpdate", () => {
  const organization = {
    id: "org_fact_table_update",
    settings: {},
    members: [],
  };
  const factTable: FactTableInterface = {
    organization: organization.id,
    id: "ftb_update",
    managedBy: "",
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-01-01"),
    name: "Fact Table",
    description: "",
    owner: "",
    projects: [],
    tags: [],
    datasource: "ds_update",
    userIdTypes: [],
    sql: "SELECT 1",
    eventName: "",
    columns: [],
    filters: [],
    columnRefreshPending: false,
  };

  const context = {
    org: organization,
    permissions: {
      canUpdateFactTable: () => false,
      throwPermissionError: () => {
        throw new Error("Permission denied");
      },
    },
  } as unknown as ReqContext;

  beforeAll(async () => {
    await connectTestMongo();
  });

  afterAll(async () => {
    await disconnectTestMongo();
  });

  it("does not persist columns when the parent update is denied", async () => {
    await mongoose.connection.db!.collection("facttables").insertOne(factTable);

    await expect(
      authorizeAndPersistFactTableUpdate({
        context,
        factTable,
        parentUpdateData: {},
        incomingColumns: [
          { column: "country", name: "Country", datatype: "string" },
        ],
      }),
    ).rejects.toThrow("Permission denied");

    expect(
      await mongoose.connection
        .db!.collection("facttables")
        .findOne({ id: factTable.id }),
    ).toMatchObject({ columns: [] });
    expect(
      await mongoose.connection
        .db!.collection("definitionsversions")
        .countDocuments({ organization: organization.id }),
    ).toBe(0);
  });
});

describe("isUnchangedColumn", () => {
  const virtualColumn: ColumnInterface = {
    column: "amount_x2",
    name: "amount_x2",
    description: "",
    numberFormat: "",
    datatype: "number",
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-01-01"),
    deleted: false,
    isVirtual: true,
    sql: "amount * 2",
  };
  // What a client sends back after a GET, through the request validator.
  const roundTripped = () => {
    const got = JSON.parse(
      JSON.stringify(toFactTableColumnApiInterface(virtualColumn)),
    );
    return updateFactTableValidator.bodySchema.parse({ columns: [got] })
      .columns![0];
  };

  it("treats a GET -> PUT round-trip as unchanged", () => {
    expect(isUnchangedColumn(virtualColumn, roundTripped())).toBe(true);
  });

  it("treats a column with only its key as unchanged", () => {
    expect(isUnchangedColumn(virtualColumn, { column: "amount_x2" })).toBe(
      true,
    );
  });

  it("detects a changed expression or metadata", () => {
    expect(
      isUnchangedColumn(virtualColumn, { ...roundTripped(), sql: "amount" }),
    ).toBe(false);
    expect(
      isUnchangedColumn(virtualColumn, { ...roundTripped(), name: "Double" }),
    ).toBe(false);
  });
});
