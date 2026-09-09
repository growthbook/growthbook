import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  ColumnInterface,
  FactTableInterface,
  UpdateFactTableProps,
} from "shared/types/fact-table";
import {
  authorizeAndPersistFactTableUpdate,
  needsColumnRefresh,
} from "back-end/src/api/fact-tables/updateFactTable";
import { columnsNeedDetection } from "back-end/src/util/factTable";
import { ReqContext } from "back-end/types/request";

const existing: Pick<FactTableInterface, "sql" | "eventName"> = {
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
  let mongod: MongoMemoryServer;
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
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
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
