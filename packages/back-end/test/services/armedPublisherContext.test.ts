import mongoose from "mongoose";
import type { OrganizationInterface } from "shared/types/organization";
import {
  getContextForApiKeyIdInOrg,
  getContextForArmedPublisherInOrg,
} from "back-end/src/services/organizations";
import { setupApp } from "../api/api.setup";

// An org API key that armed a deferred change runs it as itself: its own role,
// environment limits and project roles. Anything that is not a live org key
// resolves to nobody rather than to somebody else.

const ORG_ID = "org_armed_key";
const org = {
  id: ORG_ID,
  name: "Armed key",
  ownerEmail: "o@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }, { id: "dev" }] },
} as unknown as OrganizationInterface;

const key = (fields: Record<string, unknown>) => ({
  id: "key_ci",
  organization: ORG_ID,
  key: "secret_ci",
  secret: true,
  description: "CI",
  role: "experimenter",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  ...fields,
});

describe("getContextForApiKeyIdInOrg", () => {
  setupApp();
  const keys = () => mongoose.connection.collection("apikeys");

  it("builds the key's own context, environment limits included", async () => {
    await keys().insertOne(
      key({ limitAccessByEnvironment: true, environments: ["dev"] }),
    );
    const context = await getContextForApiKeyIdInOrg(org, "key_ci");
    expect(context?.apiKey).toBe("key_ci");
    expect(context?.auditUser).toMatchObject({ type: "api_key", name: "CI" });
    expect(
      context?.permissions.canRunExperiment({ project: "" }, ["dev"]),
    ).toBe(true);
    expect(
      context?.permissions.canRunExperiment({ project: "" }, ["production"]),
    ).toBe(false);
  });

  it.each([
    ["a missing key", null],
    ["a disabled key", { disabled: true }],
    ["a user-bound key", { userId: "u_1" }],
  ])("resolves %s to nobody", async (_label, fields) => {
    if (fields) await keys().insertOne(key(fields));
    expect(await getContextForApiKeyIdInOrg(org, "key_ci")).toBeNull();
  });

  it("dispatches a stored armer id by its prefix", async () => {
    await keys().insertOne(key({}));
    expect(
      (await getContextForArmedPublisherInOrg(org, "key_ci"))?.apiKey,
    ).toBe("key_ci");
    expect(await getContextForArmedPublisherInOrg(org, "u_nobody")).toBeNull();
  });
});
