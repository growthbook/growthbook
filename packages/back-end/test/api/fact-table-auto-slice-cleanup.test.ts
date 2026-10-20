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
import { updateFactTableColumns } from "back-end/src/models/FactTableModel";
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

function makeMetric(
  id: string,
  overrides: Partial<FactMetricInterface> = {},
): FactMetricInterface {
  return {
    ...factMetricFactory.build({
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
      metricAutoSlices: ["country", "device"],
      loseRisk: 0.5,
    }),
    ...overrides,
  } as FactMetricInterface;
}

const { app, setReqContext } = setupApp();

// factmetrics is not a mongoose-registered collection, so the shared afterEach
// leaves it alone.
afterEach(async () => {
  await mongoose.connection
    .db!.collection("factmetrics")
    .deleteMany({ organization: organization.id });
});

function makeContext(auth: { role: string; auditUser: unknown }) {
  const apiKeyData: ApiKeyInterface = {
    id: "key_test",
    key: "test-key",
    organization: organization.id,
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-01-01"),
    secret: true,
    role: auth.role,
    limitAccessByEnvironment: false,
    environments: [],
  };
  const context = new ReqContextClass({
    org: organization,
    auditUser: auth.auditUser as ReqContextClass["auditUser"],
    role: auth.role,
    apiKey: "test-key",
    apiKeyData,
  });
  setReqContext(context);
  return context;
}

const apiKeyContext = () =>
  makeContext({
    role: "admin",
    auditUser: { type: "api_key", apiKey: "test-key" },
  });

async function seed(metrics: FactMetricInterface[]) {
  await mongoose.connection.db!.collection("facttables").insertOne({
    ...factTable,
    columns: factTable.columns.map((column) => ({ ...column })),
  });
  await mongoose.connection.db!.collection("factmetrics").insertMany(metrics);
}

async function storedMetric(id: string) {
  return mongoose.connection.db!.collection("factmetrics").findOne({ id });
}

async function disableCountrySlices() {
  return request(app)
    .post(`/api/v1/fact-tables/${factTable.id}`)
    .send({ columns: [{ column: "country", isAutoSliceColumn: false }] })
    .set("Authorization", "Bearer test-key");
}

it("cleans metrics the caller is not allowed to update", async () => {
  const metric = makeMetric("fact__not_updatable");
  await seed([metric]);
  const context = apiKeyContext();
  context.permissions.canUpdateFactMetric = () => false;

  const response = await disableCountrySlices();

  expect(response.status).toBe(200);
  expect(await storedMetric(metric.id)).toMatchObject({
    metricAutoSlices: ["device"],
  });
  expect(
    await mongoose.connection
      .db!.collection("facttables")
      .findOne({ id: factTable.id }),
  ).toMatchObject({
    columns: [
      { column: "amount" },
      { column: "country", isAutoSliceColumn: false },
    ],
  });
});

it("preserves a concurrent metric edit and still removes the slice", async () => {
  const metric = makeMetric("fact__concurrent_edit");
  await seed([metric]);
  const context = apiKeyContext();
  const factMetrics = context.models.factMetrics;
  const updateIfUnchanged = factMetrics.updateIfUnchanged.bind(factMetrics);

  // Slip a concurrent write in between the cascade's read and its CAS write.
  let injected = false;
  jest
    .spyOn(factMetrics, "updateIfUnchanged")
    .mockImplementation(async (existing, updates, writeOptions, options) => {
      if (!injected) {
        injected = true;
        await mongoose.connection.db!.collection("factmetrics").updateOne(
          { id: metric.id, organization: organization.id },
          {
            $set: {
              name: "Concurrent update",
              dateUpdated: new Date(metric.dateUpdated.getTime() + 1_000),
            },
          },
        );
      }
      return updateIfUnchanged(existing, updates, writeOptions, options);
    });

  const response = await disableCountrySlices();

  expect(response.status).toBe(200);
  expect(await storedMetric(metric.id)).toMatchObject({
    name: "Concurrent update",
    metricAutoSlices: ["device"],
  });
});

it("background column refresh cleans API-managed metrics and still lands", async () => {
  const metric = makeMetric("fact__api_managed", { managedBy: "api" });
  await seed([metric]);
  // Mirrors getContextForAgendaJobByOrgObject: admin role, no audit user.
  const context = makeContext({ role: "admin", auditUser: null });

  await updateFactTableColumns(
    { ...factTable, columns: factTable.columns.map((c) => ({ ...c })) },
    {
      columns: [columns[0], { ...columns[1], deleted: true }],
      columnsError: null,
      columnRefreshPending: false,
    },
    context,
  );

  expect(
    await mongoose.connection
      .db!.collection("facttables")
      .findOne({ id: factTable.id }),
  ).toMatchObject({
    columnRefreshPending: false,
    columns: [{ column: "amount" }, { column: "country", deleted: true }],
  });
  expect(await storedMetric(metric.id)).toMatchObject({
    metricAutoSlices: ["device"],
  });
});
