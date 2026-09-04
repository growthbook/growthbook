import mongoose from "mongoose";
import request from "supertest";
import { ApiKeyInterface } from "shared/types/apikey";
import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";
import { setupApp } from "./api.setup";

const organization: OrganizationInterface = {
  id: "org_auto_slice_cleanup",
  name: "Auto-slice cleanup",
  ownerEmail: "owner@example.com",
  url: "",
  dateCreated: new Date("2026-01-01"),
  invites: [],
  members: [],
  settings: { environments: [] },
};

const columns: ColumnInterface[] = [
  {
    column: "amount",
    name: "Amount",
    description: "",
    numberFormat: "",
    datatype: "number",
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-01-01"),
    deleted: false,
  },
  {
    column: "country",
    name: "Country",
    description: "",
    numberFormat: "",
    datatype: "string",
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-01-01"),
    deleted: false,
    isAutoSliceColumn: true,
  },
];

const factTable: FactTableInterface = {
  organization: organization.id,
  id: "ftb_auto_slice_cleanup",
  managedBy: "",
  dateCreated: new Date("2026-01-01"),
  dateUpdated: new Date("2026-01-01"),
  name: "Fact Table",
  description: "",
  owner: "",
  projects: [],
  tags: [],
  datasource: "ds_auto_slice_cleanup",
  userIdTypes: [],
  sql: "SELECT amount, country FROM events",
  eventName: "",
  columns,
  filters: [],
  columnRefreshPending: false,
};

function makeMetric(id: string): FactMetricInterface {
  return factMetricFactory.build({
    id,
    organization: organization.id,
    datasource: factTable.datasource,
    owner: "",
    managedBy: "",
    name: id,
    numerator: {
      factTableId: factTable.id,
      column: "amount",
      aggregation: "sum",
      rowFilters: [],
    },
    metricAutoSlices: ["country"],
    loseRisk: 0.5,
  });
}

const { app, setReqContext } = setupApp();

function useContext() {
  const apiKeyData: ApiKeyInterface = {
    id: "key_admin",
    key: "test-key",
    organization: organization.id,
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-01-01"),
    secret: true,
    role: "admin",
    limitAccessByEnvironment: false,
    environments: [],
  };
  const context = new ReqContextClass({
    org: organization,
    auditUser: { type: "api_key", apiKey: "test-key" },
    role: "admin",
    apiKey: "test-key",
    apiKeyData,
  });
  setReqContext(context);
  return context;
}

async function seed(metrics: FactMetricInterface[]) {
  await mongoose.connection.db!.collection("facttables").insertOne({
    ...factTable,
    columns: factTable.columns.map((column) => ({ ...column })),
  });
  await mongoose.connection.db!.collection("factmetrics").insertMany(metrics);
}

async function updateColumns() {
  return request(app)
    .post(`/api/v1/fact-tables/${factTable.id}`)
    .send({ columns: [{ column: "country", isAutoSliceColumn: false }] })
    .set("Authorization", "Bearer test-key");
}

it("checks every affected metric before writing cleanup changes", async () => {
  const allowed = makeMetric("fact__a_allowed");
  const denied = makeMetric("fact__z_denied");
  await seed([allowed, denied]);
  const context = useContext();
  context.permissions.canUpdateFactMetric = (metric) => metric.id !== denied.id;

  const response = await updateColumns();

  expect(response.status).toBe(403);
  const storedMetrics = await mongoose.connection
    .db!.collection("factmetrics")
    .find({ organization: organization.id })
    .sort({ id: 1 })
    .toArray();
  expect(storedMetrics.map((metric) => metric.metricAutoSlices)).toEqual([
    ["country"],
    ["country"],
  ]);
  expect(
    await mongoose.connection
      .db!.collection("facttables")
      .findOne({ id: factTable.id }),
  ).toMatchObject({
    columns: [
      { column: "amount" },
      { column: "country", isAutoSliceColumn: true },
    ],
  });
});

it("restores earlier cleanup when a later metric changes concurrently", async () => {
  const firstMetric = makeMetric("fact__a_first_cleanup");
  const metric = makeMetric("fact__concurrent_update");
  await seed([firstMetric, metric]);
  const context = useContext();
  const factMetrics = context.models.factMetrics;
  const updateIfUnchanged = factMetrics.updateIfUnchanged.bind(factMetrics);

  jest
    .spyOn(factMetrics, "updateIfUnchanged")
    .mockImplementation(async (existing, updates, writeOptions, options) => {
      if (existing.id === metric.id) {
        await mongoose.connection.db!.collection("factmetrics").updateOne(
          { id: metric.id, organization: organization.id },
          {
            $set: {
              name: "Concurrent update",
              metricAutoSlices: ["country", "device"],
              dateUpdated: new Date(metric.dateUpdated.getTime() + 1_000),
            },
          },
        );
      }
      return updateIfUnchanged(existing, updates, writeOptions, options);
    });

  const response = await updateColumns();

  expect(response.status).toBe(409);
  expect(
    await mongoose.connection
      .db!.collection("factmetrics")
      .findOne({ id: firstMetric.id }),
  ).toMatchObject({
    metricAutoSlices: ["country"],
  });
  expect(
    await mongoose.connection
      .db!.collection("factmetrics")
      .findOne({ id: metric.id }),
  ).toMatchObject({
    name: "Concurrent update",
    metricAutoSlices: ["country", "device"],
  });
});
