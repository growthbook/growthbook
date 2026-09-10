import mongoose from "mongoose";
import request from "supertest";
import { ApiKeyInterface } from "shared/types/apikey";
import { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";
import { setupApp } from "./api.setup";

const organization: OrganizationInterface = {
  id: "org_noop_update_permissions",
  name: "No-op update permissions",
  ownerEmail: "owner@example.com",
  url: "",
  dateCreated: new Date("2026-01-01"),
  invites: [],
  members: [],
  settings: { environments: [] },
};

const datasource = {
  id: "ds_noop_update_permissions",
  organization: organization.id,
  name: "No-op update data source",
  description: "",
  type: "postgres",
  params: "",
  projects: [],
  settings: {},
  dateCreated: new Date("2026-01-01"),
  dateUpdated: new Date("2026-01-01"),
};

const factMetric = factMetricFactory.build({
  id: "fact__noop_update",
  organization: organization.id,
  datasource: datasource.id,
  owner: "",
  managedBy: "",
  name: "No-op metric",
  funnelSettings: null,
});

const { app, setReqContext } = setupApp();

beforeEach(async () => {
  const apiKeyData: ApiKeyInterface = {
    id: "key_readonly",
    key: "test-key",
    organization: organization.id,
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-01-01"),
    secret: true,
    role: "readonly",
    limitAccessByEnvironment: false,
    environments: [],
  };
  setReqContext(
    new ReqContextClass({
      org: organization,
      auditUser: { type: "api_key", apiKey: "test-key" },
      role: "readonly",
      apiKey: "test-key",
      apiKeyData,
    }),
  );
  await mongoose.connection
    .db!.collection("datasources")
    .insertOne(structuredClone(datasource));
  await mongoose.connection
    .db!.collection("factmetrics")
    .insertOne(structuredClone(factMetric));
});

it("checks update permissions for no-op payloads", async () => {
  for (const body of [{}, { name: factMetric.name }]) {
    const response = await request(app)
      .post(`/api/v1/fact-metrics/${factMetric.id}`)
      .send(body)
      .set("Authorization", "Bearer test-key");

    expect(response.status).toBe(403);
    expect(response.body.message).toBe(
      "You do not have access to update this resource",
    );
  }
});
