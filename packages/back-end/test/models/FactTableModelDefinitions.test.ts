import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Permissions, roleToPermissionMap } from "shared/permissions";
import { OrganizationInterface } from "shared/types/organization";
import { FactTableInterface } from "shared/types/fact-table";
import { getAllFactTablesForDefinitions } from "back-end/src/models/FactTableModel";
import { ReqContext } from "back-end/types/request";

const org: OrganizationInterface = {
  id: "org_1",
  name: "Test",
  url: "",
  ownerEmail: "",
  dateCreated: new Date(),
  members: [],
  invites: [],
  settings: {},
};

const context = {
  org,
  permissions: new Permissions({
    global: {
      permissions: roleToPermissionMap("admin", org),
      limitAccessByEnvironment: false,
      environments: [],
    },
    projects: {},
  }),
} as unknown as ReqContext;

function makeFactTable(
  overrides: Partial<FactTableInterface> = {},
): FactTableInterface {
  return {
    id: "ftb_1",
    organization: "org_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "Test Fact Table",
    description: "",
    owner: "",
    projects: [],
    tags: [],
    datasource: "ds_1",
    userIdTypes: ["user_id"],
    sql: "SELECT user_id, timestamp, value FROM purchases",
    eventName: "purchase",
    columns: [
      {
        column: "value",
        name: "value",
        description: "",
        datatype: "number",
        numberFormat: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        deleted: false,
      },
      {
        column: "attributes",
        name: "attributes",
        description: "",
        datatype: "json",
        numberFormat: "",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        deleted: false,
        jsonFields: { country: { datatype: "string" } },
      },
    ],
    filters: [
      {
        id: "flt_1",
        name: "US only",
        description: "",
        value: "country = 'US'",
        dateCreated: new Date(),
        dateUpdated: new Date(),
      },
    ],
    ...overrides,
  };
}

describe("getAllFactTablesForDefinitions", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await mongoose.connection.db!.collection("facttables").deleteMany({});
  });

  it("excludes sql and column jsonFields but keeps other column and filter values", async () => {
    await mongoose.connection
      .db!.collection("facttables")
      .insertMany([
        makeFactTable(),
        makeFactTable({ id: "ftb_2", name: "Other" }),
      ]);

    const factTables = await getAllFactTablesForDefinitions(context);

    expect(factTables).toHaveLength(2);
    factTables.forEach((f) => {
      expect(f).not.toHaveProperty("sql");
      f.columns.forEach((c) => {
        expect(c).not.toHaveProperty("jsonFields");
      });
    });
    // Column skeleton (name/datatype) is preserved even though jsonFields is not
    expect(factTables[0].columns).toHaveLength(2);
    expect(factTables[0].columns[1].column).toEqual("attributes");
    expect(factTables[0].columns[1].datatype).toEqual("json");
    expect(factTables[0].filters[0].value).toEqual("country = 'US'");
  });

  it("does not return fact tables from other organizations", async () => {
    await mongoose.connection
      .db!.collection("facttables")
      .insertMany([
        makeFactTable(),
        makeFactTable({ id: "ftb_other", organization: "org_2" }),
      ]);

    const factTables = await getAllFactTablesForDefinitions(context);

    expect(factTables.map((f) => f.id)).toEqual(["ftb_1"]);
  });
});
