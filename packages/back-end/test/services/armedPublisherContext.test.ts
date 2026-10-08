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

  describe("work armed through an OAuth token", () => {
    const grants = () => mongoose.connection.collection("oauthgrants");
    const apps = () => mongoose.connection.collection("orgoauthclients");
    const seedGrant = (fields: Record<string, unknown> = {}) =>
      grants().insertOne({
        id: "oag_1",
        organization: ORG_ID,
        clientId: "gbapp_1",
        userId: "u_1",
        revoked: false,
        // The member authorized it for dev only.
        permissionLimit: {
          role: "experimenter",
          limitAccessByEnvironment: true,
          environments: ["dev"],
        },
        expiresAt: new Date(Date.now() + 60_000),
        dateCreated: new Date(),
        dateUpdated: new Date(),
        ...fields,
      });
    const seedApp = (fields: Record<string, unknown> = {}) =>
      apps().insertOne({
        id: "gbapp_1",
        organization: ORG_ID,
        clientName: "Internal MCP",
        redirectUris: ["https://mcp.example.com/cb"],
        clientUri: "",
        clientSecretHash: "hash",
        createdBy: "u_1",
        allowDelegation: false,
        // The admin capped the app at engineer, which can't create metrics.
        permissionLimit: {
          role: "engineer",
          limitAccessByEnvironment: false,
          environments: [],
        },
        dateCreated: new Date(),
        dateUpdated: new Date(),
        ...fields,
      });

    it("runs as its member within the app's and the member's limits", async () => {
      await seedUser({ superAdmin: true });
      await seedGrant();
      await seedApp();

      const context = await getContextForArmedPublisherInOrg(
        memberOrg,
        "oag_1",
      );
      expect(context?.userId).toBe("u_1");
      expect(context?.superAdmin).toBe(false);
      expect(context?.armerId).toBe("oag_1");
      expect(context?.auditUser).toMatchObject({
        type: "api_key",
        id: "u_1",
        oauthApp: { id: "gbapp_1", name: "Internal MCP" },
      });
      expect(
        context?.permissions.canRunExperiment({ project: "" }, ["dev"]),
      ).toBe(true);
      expect(
        context?.permissions.canRunExperiment({ project: "" }, ["production"]),
      ).toBe(false);
      // The member and their own limit both allow it; the app's ceiling doesn't.
      expect(context?.permissions.canCreateMetric({ projects: [] })).toBe(
        false,
      );
    });

    it("names the app on the audit rows it writes", async () => {
      await seedUser();
      await seedGrant();
      await seedApp();

      const context = await getContextForArmedPublisherInOrg(
        memberOrg,
        "oag_1",
      );
      await context?.auditLog({
        event: "feature.update",
        entity: { object: "feature", id: "f_audit" },
      });
      const row = await mongoose.connection
        .collection("audits")
        .findOne({ "entity.id": "f_audit" });
      expect(row?.user).toMatchObject({
        id: "u_1",
        oauthApp: { id: "gbapp_1", name: "Internal MCP" },
      });
    });

    it.each([
      ["the grant was revoked", { revoked: true }, {}, memberOrg],
      ["the app was deleted", {}, null, memberOrg],
      [
        "the app belongs to another org",
        {},
        { organization: "org_x" },
        memberOrg,
      ],
      [
        "the org's policy now blocks apps",
        {},
        {},
        {
          ...memberOrg,
          settings: { ...memberOrg.settings, oauthAccess: "none" },
        } as unknown as OrganizationInterface,
      ],
      ["the member left the org", {}, {}, org],
    ])(
      "has nobody to run as once %s",
      async (_label, grantFields, appFields, inOrg) => {
        await seedUser();
        await seedGrant(grantFields);
        if (appFields) await seedApp(appFields);
        expect(
          await getContextForArmedPublisherInOrg(inOrg, "oag_1"),
        ).toBeNull();
      },
    );
  });

  it("dispatches a stored armer id by its prefix", async () => {
    await keys().insertOne(key({}));
    expect(
      (await getContextForArmedPublisherInOrg(org, "key_ci"))?.apiKey,
    ).toBe("key_ci");
    expect(await getContextForArmedPublisherInOrg(org, "u_nobody")).toBeNull();
  });
});
