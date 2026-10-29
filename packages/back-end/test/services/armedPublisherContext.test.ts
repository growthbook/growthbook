import mongoose from "mongoose";
import type { OrganizationInterface } from "shared/types/organization";
import {
  getContextForApiKeyIdInOrg,
  getContextForArmedPublisherInOrg,
} from "back-end/src/services/organizations";
import {
  decodeArmingApiKeyId,
  encodeArmingApiKeyId,
} from "back-end/src/util/armingApiKeyId";
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

  it("fires a User key armed for a member with only what both of them hold", async () => {
    await keys().insertOne(key({ actAs: "user" }));
    await seedUser();
    const readerOrg = {
      ...memberOrg,
      members: [{ ...memberOrg.members[0], role: "readonly" }],
    } as unknown as OrganizationInterface;
    const run = async (armer: string) =>
      (
        await getContextForApiKeyIdInOrg(readerOrg, armer)
      )?.permissions.canRunExperiment({ project: "" }, ["dev"]);
    // Canary: the key alone could run it, so `false` below isn't vacuous.
    expect(await run("key_ci")).toBe(true);
    expect(await run("key_ci:u_1")).toBe(false);
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
    ["an expired key", { expiresAt: new Date(Date.now() - 60_000) }],
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

  describe("an OAuth sign-in's armed work", () => {
    // Client ids are the client's to choose, so the armer id escapes them.
    const clientId = "https://agent.example/client:1@a";
    const grants = () => mongoose.connection.collection("oauthgrants");
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const seedGrant = (fields: Record<string, unknown> = {}) =>
      grants().insertOne({
        id: "oag_armed",
        organization: ORG_ID,
        clientId,
        userId: "u_1",
        revoked: false,
        permissions: {
          scopedRole: "experimenter",
          limitAccessByEnvironment: true,
          environments: ["dev"],
        },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        dateCreated: hourAgo,
        dateUpdated: hourAgo,
        ...fields,
      });
    // Armed half an hour ago, by a token that has since lapsed.
    const armer = encodeArmingApiKeyId("key_oauth", undefined, {
      clientId,
      userId: "u_1",
      armedAt: Date.now() - 30 * 60 * 1000,
    });

    it("fires on its grant, with the grant's permissions", async () => {
      await seedUser();
      await seedGrant();
      const context = await getContextForApiKeyIdInOrg(memberOrg, armer);
      expect(context?.apiKey).toBe("key_oauth");
      expect(
        context?.permissions.canRunExperiment({ project: "" }, ["dev"]),
      ).toBe(true);
      expect(
        context?.permissions.canRunExperiment({ project: "" }, ["production"]),
      ).toBe(false);
      // Work it arms in turn names the same sign-in.
      expect(decodeArmingApiKeyId(context?.armerId ?? "").oauth).toMatchObject({
        clientId,
        userId: "u_1",
      });
    });

    it.each([
      ["once the grant is revoked", { revoked: true, revokedAt: new Date() }],
      [
        "after a revoke, even once the user signs in again",
        { revokedAt: new Date() },
      ],
      ["on a grant made after it was armed", { dateCreated: new Date() }],
    ])("fires nothing %s", async (_label, fields) => {
      await seedUser();
      await seedGrant(fields);
      expect(await getContextForApiKeyIdInOrg(memberOrg, armer)).toBeNull();
    });

    it("still fires when a revoke came before it was armed", async () => {
      await seedUser();
      await seedGrant({ revokedAt: new Date(Date.now() - 45 * 60 * 1000) });
      expect(await getContextForApiKeyIdInOrg(memberOrg, armer)).not.toBeNull();
    });
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
