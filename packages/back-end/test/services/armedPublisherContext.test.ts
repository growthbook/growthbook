import mongoose from "mongoose";
import type { OrganizationInterface } from "shared/types/organization";
import {
  getContextForApiKeyIdInOrg,
  getContextForArmedPublisherInOrg,
} from "back-end/src/services/organizations";
import { setupApp } from "../api/api.setup";

// An org API key that armed a deferred change runs it as itself: its own role,
// environment limits and project roles. A scoped PAT runs as its user under the
// key's cap. Anything else resolves to nobody rather than to somebody else.

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
const memberOrg = {
  ...org,
  members: [
    {
      id: "u_1",
      role: "admin",
      environments: [],
      limitAccessByEnvironment: false,
      projectRoles: [],
    },
  ],
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
  const seedUser = (fields: Record<string, unknown> = {}) =>
    mongoose.connection
      .collection("users")
      .insertOne({ id: "u_1", email: "u1@test.com", name: "U1", ...fields });

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

  it("runs a scoped PAT as its user under the key's cap, never as a super admin", async () => {
    await seedUser({ superAdmin: true });
    await keys().insertOne(
      key({
        userId: "u_1",
        scoped: true,
        limitAccessByEnvironment: true,
        environments: ["dev"],
      }),
    );
    const context = await getContextForApiKeyIdInOrg(memberOrg, "key_ci");
    expect(context?.userId).toBe("u_1");
    expect(context?.superAdmin).toBe(false);
    expect(context?.armerId).toBe("key_ci");
    expect(context?.auditUser).toMatchObject({
      type: "api_key",
      apiKey: "key_ci",
      id: "u_1",
    });
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
    ["an unscoped user-bound key", { userId: "u_1", role: "user" }],
    [
      "a scoped key whose user has left the org",
      { userId: "u_1", scoped: true },
    ],
  ])("resolves %s to nobody", async (_label, fields) => {
    await seedUser();
    if (fields) await keys().insertOne(key(fields));
    expect(await getContextForApiKeyIdInOrg(org, "key_ci")).toBeNull();
  });

  it("resolves a scoped PAT to nobody once the org disables personal access tokens", async () => {
    await seedUser();
    await keys().insertOne(key({ userId: "u_1", scoped: true }));
    const disabled = {
      ...memberOrg,
      settings: { ...memberOrg.settings, disablePersonalAccessTokens: true },
    };
    expect(await getContextForApiKeyIdInOrg(disabled, "key_ci")).toBeNull();
  });

  it("dispatches a stored armer id by its prefix", async () => {
    await keys().insertOne(key({}));
    expect(
      (await getContextForArmedPublisherInOrg(org, "key_ci"))?.apiKey,
    ).toBe("key_ci");
    expect(await getContextForArmedPublisherInOrg(org, "u_nobody")).toBeNull();
  });
});
