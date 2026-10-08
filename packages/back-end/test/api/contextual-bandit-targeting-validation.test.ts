import mongoose from "mongoose";
import request from "supertest";
import { OrganizationInterface } from "shared/types/organization";
import { ContextualBanditInterface } from "shared/validators";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "./api.setup";

const organization = {
  id: "org_cb_targeting_validation",
  name: "Contextual bandit targeting validation",
  ownerEmail: "owner@example.com",
  url: "",
  dateCreated: new Date("2026-01-01"),
  invites: [],
  members: [],
  settings: {
    environments: [{ id: "production", description: "" }],
    attributeSchema: [{ property: "country", datatype: "string" }],
  },
} as unknown as OrganizationInterface;

const contextualBandit: ContextualBanditInterface = {
  id: "cb_targeting_validation",
  organization: organization.id,
  dateCreated: new Date("2026-01-01"),
  dateUpdated: new Date("2026-01-01"),
  name: "Checkout layout",
  description: "",
  project: "",
  owner: "",
  tags: [],
  archived: false,
  status: "running",
  trackingKey: "checkout-layout",
  hashAttribute: "id",
  variations: [
    { id: "v0", key: "0", name: "Control", screenshots: [] },
    { id: "v1", key: "1", name: "Treatment", screenshots: [] },
  ],
  datasource: "",
  contextualBanditQueryId: "",
  coverage: 1,
  condition: "",
  savedGroups: [],
  prerequisites: [],
  seed: "checkout-layout",
  variationWeights: [
    { variationId: "v0", weight: 0.5 },
    { variationId: "v1", weight: 0.5 },
  ],
  currentLeafWeights: [],
  banditVersion: 0,
  contextualAttributes: ["country"],
  minUsersPerLeaf: 100,
  maxLeaves: 12,
  holdoutPercent: 0,
  banditModelVersion: 1,
};

const savedGroup = {
  id: "grp_beta_users",
  organization: organization.id,
  groupName: "Beta users",
  owner: "",
  type: "list",
  attributeKey: "id",
  values: ["u_1", "u_2"],
  dateCreated: new Date("2026-01-01"),
  dateUpdated: new Date("2026-01-01"),
};

const { app, setReqContext } = setupApp();

function useAdmin() {
  const context = new ReqContextClass({
    org: organization,
    auditUser: { type: "api_key", apiKey: "key_admin" },
    role: "admin",
    apiKey: "key_admin",
  });
  context.hasPremiumFeature = () => true;
  setReqContext(context);
}

async function stored() {
  return mongoose.connection
    .db!.collection("contextualbandits")
    .findOne({ id: contextualBandit.id });
}

function put(body: Record<string, unknown>) {
  return request(app)
    .put(`/api/v1/contextual-bandits/${contextualBandit.id}`)
    .send(body)
    .set("Authorization", "Bearer key_admin");
}

beforeEach(async () => {
  useAdmin();
  await mongoose.connection
    .db!.collection("contextualbandits")
    .insertOne(structuredClone(contextualBandit));
  await mongoose.connection
    .db!.collection("savedgroups")
    .insertOne(structuredClone(savedGroup));
});

// api.setup's afterEach only clears mongoose-registered collections; these
// models write through the native driver.
afterEach(async () => {
  await mongoose.connection.db!.collection("contextualbandits").deleteMany({});
  await mongoose.connection.db!.collection("savedgroups").deleteMany({});
});

describe("PUT /api/v1/contextual-bandits/:id targeting references", () => {
  it("rejects a condition that does not parse and leaves the bandit unchanged", async () => {
    const response = await put({ condition: "{not json" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Invalid rule condition/);
    expect((await stored())?.condition).toBe("");
  });

  it("rejects a condition that references a saved group that does not exist", async () => {
    const response = await put({
      condition: JSON.stringify({ id: { $inGroup: "grp_missing" } }),
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/grp_missing/);
    expect((await stored())?.condition).toBe("");
  });

  it("rejects saved-group targeting that names a group that does not exist", async () => {
    const response = await put({
      savedGroups: [{ match: "any", ids: ["grp_missing"] }],
    });

    expect(response.status).toBe(404);
    expect(response.body.message).toMatch(/grp_missing/);
    expect((await stored())?.savedGroups).toEqual([]);
  });

  it("rejects a prerequisite whose condition does not parse", async () => {
    const response = await put({
      prerequisites: [{ id: "parent_flag", condition: "{oops" }],
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/parent_flag/);
    expect((await stored())?.prerequisites).toEqual([]);
  });

  it("rejects a prerequisite whose parent flag does not exist", async () => {
    const response = await put({
      prerequisites: [{ id: "missing_flag", condition: '{"value": true}' }],
    });

    expect(response.status).toBe(404);
    expect(response.body.message).toMatch(/missing_flag/);
    expect((await stored())?.prerequisites).toEqual([]);
  });

  it("accepts a prerequisite on an existing flag", async () => {
    await mongoose.connection.collection("features").insertOne({
      id: "parent_flag",
      organization: organization.id,
      valueType: "boolean",
      defaultValue: "false",
      archived: false,
      environmentSettings: { production: { enabled: true, rules: [] } },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    const prerequisites = [{ id: "parent_flag", condition: '{"value": true}' }];

    const response = await put({ prerequisites });

    expect(response.status).toBe(200);
    expect((await stored())?.prerequisites).toEqual(prerequisites);
  });

  it("rejects unregistered attributes when the org requires registration", async () => {
    const context = new ReqContextClass({
      org: {
        ...organization,
        settings: {
          ...organization.settings,
          requireRegisteredAttributes: true,
        },
      },
      auditUser: { type: "api_key", apiKey: "key_admin" },
      role: "admin",
      apiKey: "key_admin",
    });
    context.hasPremiumFeature = () => true;
    setReqContext(context);

    const response = await put({
      condition: JSON.stringify({ region: "west" }),
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Unknown attribute key.*"region"/);
    expect((await stored())?.condition).toBe("");
  });

  it("accepts a valid condition and existing saved groups", async () => {
    const response = await put({
      condition: JSON.stringify({ country: "US" }),
      savedGroups: [{ match: "all", ids: ["grp_beta_users"] }],
    });

    expect(response.status).toBe(200);
    const doc = await stored();
    expect(doc?.condition).toBe(JSON.stringify({ country: "US" }));
    expect(doc?.savedGroups).toEqual([
      { match: "all", ids: ["grp_beta_users"] },
    ]);
  });

  it("re-checks only the targeting field that changed", async () => {
    await mongoose.connection.db!.collection("contextualbandits").updateOne(
      { id: contextualBandit.id },
      {
        $set: { savedGroups: [{ match: "any", ids: ["grp_deleted_since"] }] },
      },
    );

    const response = await put({
      condition: JSON.stringify({ country: "CA" }),
    });

    expect(response.status).toBe(200);
    const doc = await stored();
    expect(doc?.condition).toBe(JSON.stringify({ country: "CA" }));
    expect(doc?.savedGroups).toEqual([
      { match: "any", ids: ["grp_deleted_since"] },
    ]);
  });

  it("does not re-check targeting an unrelated edit leaves untouched", async () => {
    await mongoose.connection.db!.collection("contextualbandits").updateOne(
      { id: contextualBandit.id },
      {
        $set: {
          condition: "{stale",
          savedGroups: [{ match: "any", ids: ["grp_deleted_since"] }],
        },
      },
    );

    const response = await put({ description: "Larger buttons on mobile" });

    expect(response.status).toBe(200);
    expect(response.body.contextualBandit.description).toBe(
      "Larger buttons on mobile",
    );
  });
});
