import mongoose from "mongoose";
import request from "supertest";
import { OrganizationInterface } from "shared/types/organization";
import { ContextualBanditInterface } from "shared/validators";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "./api.setup";

const organization = {
  id: "org_cb_update_permission",
  name: "Contextual bandit update permission",
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
  id: "cb_update_permission",
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

const { app, setReqContext } = setupApp();

function useRole(role: string) {
  const context = new ReqContextClass({
    org: organization,
    auditUser: { type: "api_key", apiKey: `key_${role}` },
    role,
    apiKey: `key_${role}`,
  });
  context.hasPremiumFeature = () => true;
  setReqContext(context);
}

async function storedStatus() {
  const doc = await mongoose.connection
    .db!.collection("contextualbandits")
    .findOne({ id: contextualBandit.id });
  return doc?.status;
}

beforeEach(async () => {
  await mongoose.connection
    .db!.collection("contextualbandits")
    .insertOne(structuredClone(contextualBandit));
});

// api.setup's afterEach only clears mongoose-registered collections; this
// model writes through the native driver.
afterEach(async () => {
  await mongoose.connection.db!.collection("contextualbandits").deleteMany({});
});

describe("PUT /api/v1/contextual-bandits/:id", () => {
  it("refuses a status change from a role without the run permission", async () => {
    useRole("analyst");

    const response = await request(app)
      .put(`/api/v1/contextual-bandits/${contextualBandit.id}`)
      .send({ status: "stopped" })
      .set("Authorization", "Bearer key_analyst");

    expect(response.status).toBe(403);
    expect(await storedStatus()).toBe("running");
  });

  it("still lets that role make other edits and resend the current status", async () => {
    useRole("analyst");

    const response = await request(app)
      .put(`/api/v1/contextual-bandits/${contextualBandit.id}`)
      .send({ description: "Larger buttons on mobile", status: "running" })
      .set("Authorization", "Bearer key_analyst");

    expect(response.status).toBe(200);
    expect(response.body.contextualBandit.description).toBe(
      "Larger buttons on mobile",
    );
  });

  it("treats resending only the current status as a permitted no-op for that role", async () => {
    useRole("analyst");

    const response = await request(app)
      .put(`/api/v1/contextual-bandits/${contextualBandit.id}`)
      .send({ status: "running" })
      .set("Authorization", "Bearer key_analyst");

    expect(response.status).toBe(200);
    expect(await storedStatus()).toBe("running");
  });

  it("allows a status change from a role with the run permission", async () => {
    useRole("experimenter");

    const response = await request(app)
      .put(`/api/v1/contextual-bandits/${contextualBandit.id}`)
      .send({ status: "stopped" })
      .set("Authorization", "Bearer key_experimenter");

    expect(response.status).toBe(200);
    expect(await storedStatus()).toBe("stopped");
  });
});
