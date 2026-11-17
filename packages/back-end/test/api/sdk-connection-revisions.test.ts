import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/enterprise/sandbox/sandbox-pool", () => ({
  runInSandbox: jest.fn(),
}));
// An edited webhook is sent once saved, and that outlives the suite.
jest.mock("back-end/src/jobs/sdkWebhooks", () => ({
  __esModule: true,
  ...jest.requireActual("back-end/src/jobs/sdkWebhooks"),
  fireSdkWebhook: jest.fn(async () => undefined),
}));
const mockRunInSandbox = runInSandbox as jest.MockedFunction<
  typeof runInSandbox
>;

const ORG_ID = "org_sdk_revisions";
const BASE = "/api/v1/sdk-connections-revisions";

const orgWith = (settings: Record<string, unknown> = {}) =>
  ({
    id: ORG_ID,
    name: "SDK Revisions",
    ownerEmail: "test@test.com",
    url: "",
    dateCreated: new Date(),
    members: [],
    settings: { environments: [{ id: "production" }], ...settings },
  }) as unknown as OrganizationInterface;

const approvalRule = {
  approvalFlows: {
    sdkConnections: [{ required: true, projects: [], environments: [] }],
  },
};

describe("SDK Connection revision endpoints", () => {
  const { app, setReqContext } = setupApp();
  const auth = { Authorization: "Bearer foo" };

  function useAdmin(
    settings: Record<string, unknown> = {},
    {
      canBypass = true,
      webhooksOnly = false,
      body = {},
    }: {
      canBypass?: boolean;
      webhooksOnly?: boolean;
      // The override flags a request carries are read from the context.
      body?: Record<string, unknown>;
    } = {},
  ) {
    const context = new ReqContextClass({
      org: orgWith(settings),
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {}, body } as unknown as Request,
    });
    context.hasPremiumFeature = () => true;
    if (!canBypass) {
      context.permissions.canBypassSDKConnectionApprovalChecks = () => false;
    }
    if (webhooksOnly) {
      context.permissions.canUpdateSDKConnection = () => false;
      context.permissions.canRevisionAction = () => false;
    }
    setReqContext(context);
  }

  async function createConnection(): Promise<string> {
    const res = await request(app)
      .post("/api/v1/sdk-connections")
      .send({
        name: "Web app",
        language: "javascript",
        environment: "production",
      })
      .set(auth);
    expect(res.status).toBe(200);
    return res.body.sdkConnection.id;
  }

  const liveConnection = (id: string) =>
    mongoose.connection.collection("sdkconnections").findOne({ id });
  const liveWebhooks = (id: string) =>
    mongoose.connection.collection("webhooks").find({ sdks: id }).toArray();

  beforeEach(async () => {
    for (const name of [
      "sdkconnections",
      "webhooks",
      "revisions",
      "customhooks",
    ]) {
      await mongoose.connection
        .collection(name)
        .deleteMany({ organization: ORG_ID });
    }
    mockRunInSandbox.mockReset();
    mockRunInSandbox.mockResolvedValue({ ok: true, warnings: [] });
  });

  it("stages settings and webhooks in one draft and publishes them together", async () => {
    useAdmin();
    const id = await createConnection();

    const staged = await request(app)
      .put(`${BASE}/${id}/new/settings`)
      .send({ includeRuleIds: true, revisionTitle: "Rule ids" })
      .set(auth);
    expect(staged.status).toBe(200);
    const { version } = staged.body.revision;
    expect(staged.body.revision).toMatchObject({
      status: "draft",
      title: "Rule ids",
      baseSdkConnection: { id, name: "Web app" },
      proposedSdkConnection: { includeRuleIds: true },
    });
    expect(staged.body.revision.baseSdkConnection.includeRuleIds).not.toBe(
      true,
    );

    const added = await request(app)
      .post(`${BASE}/${id}/${version}/webhooks`)
      .send({
        name: "Purge",
        endpoint: "https://example.com/purge",
        headers: '{"X-Token":"abc"}',
      })
      .set(auth);
    expect(added.status).toBe(200);
    const [webhook] = added.body.revision.proposedWebhooks;
    expect(webhook).toMatchObject({
      name: "Purge",
      httpMethod: "POST",
      payloadFormat: "standard",
    });
    // A write's response may be shown on a confirmation, so only reads carry
    // the headers.
    expect(webhook).not.toHaveProperty("headers");

    const edited = await request(app)
      .put(`${BASE}/${id}/${version}/webhooks/${webhook.id}`)
      .send({ endpoint: "https://example.com/purge-v2" })
      .set(auth);
    expect(edited.status).toBe(200);
    expect(edited.body.revision.proposedWebhooks).toEqual([
      { ...webhook, endpoint: "https://example.com/purge-v2" },
    ]);
    // Both edits ride the one draft.
    expect(edited.body.revision.proposedSdkConnection.includeRuleIds).toBe(
      true,
    );

    // Nothing is live yet.
    expect((await liveConnection(id))?.includeRuleIds).not.toBe(true);
    expect(await liveWebhooks(id)).toHaveLength(0);

    const latest = await request(app).get(`${BASE}/${id}/latest`).set(auth);
    expect(latest.body.revision.version).toBe(version);
    expect(latest.body.revision.proposedWebhooks[0].headers).toBe(
      '{"X-Token":"abc"}',
    );

    const published = await request(app)
      .post(`${BASE}/${id}/${version}/publish`)
      .set(auth);
    expect(published.status).toBe(200);
    expect(published.body.revision.status).toBe("merged");
    expect(published.body.bypassedGates).toBeUndefined();

    expect((await liveConnection(id))?.includeRuleIds).toBe(true);
    expect(await liveWebhooks(id)).toMatchObject([
      { id: webhook.id, endpoint: "https://example.com/purge-v2" },
    ]);

    const list = await request(app)
      .get(`${BASE}/${id}?status=merged`)
      .set(auth);
    expect(list.body.revisions.map((r) => r.version)).toContain(version);

    // The org-wide list finds it too, alone or among other connections'.
    const other = await createConnection();
    await request(app)
      .put(`${BASE}/${other}/new/settings`)
      .send({ name: "Other" })
      .set(auth);
    const open = await request(app).get(`${BASE}?status=open`).set(auth);
    expect(open.body.revisions).toMatchObject([
      { status: "draft", baseSdkConnection: { id: other } },
    ]);
    const one = await request(app)
      .get(`${BASE}?sdkConnectionId=${id}&status=merged`)
      .set(auth);
    expect(one.body.revisions.length).toBeGreaterThan(0);
    expect(one.body.revisions.every((r) => r.baseSdkConnection.id === id)).toBe(
      true,
    );
  });

  it("refuses to open a draft that changes nothing, or to edit a published one", async () => {
    useAdmin();
    const id = await createConnection();

    const noop = await request(app)
      .put(`${BASE}/${id}/new/settings`)
      .send({ name: "Web app" })
      .set(auth);
    expect(noop.status).toBe(400);
    expect(noop.body.message).toMatch(/Nothing to stage/);

    const staged = await request(app)
      .put(`${BASE}/${id}/new/settings`)
      .send({ name: "Web" })
      .set(auth);
    const { version } = staged.body.revision;
    await request(app).post(`${BASE}/${id}/${version}/publish`).set(auth);

    const late = await request(app)
      .put(`${BASE}/${id}/${version}/settings`)
      .send({ name: "Web again" })
      .set(auth);
    expect(late.status).toBe(400);
    expect(late.body.message).toMatch(/status "merged"/);
  });

  it("lists every publish gate when approval is required, and reports a bypass", async () => {
    useAdmin();
    const id = await createConnection();

    useAdmin(approvalRule, { canBypass: false });
    const direct = await request(app)
      .put(`/api/v1/sdk-connections/${id}`)
      .send({ name: "Web" })
      .set(auth);
    expect(direct.status).toBe(400);
    expect(direct.body.message).toContain(
      `PUT /sdk-connections-revisions/${id}/new/settings`,
    );

    const staged = await request(app)
      .put(`${BASE}/${id}/new/settings`)
      .send({ name: "Web" })
      .set(auth);
    expect(staged.status).toBe(200);
    const { version } = staged.body.revision;

    const blocked = await request(app)
      .post(`${BASE}/${id}/${version}/publish`)
      .set(auth);
    expect(blocked.status).toBe(422);
    expect(blocked.body.gates).toMatchObject([
      {
        type: "approval-required",
        resolution: {
          method: "POST",
          path: `/sdk-connections-revisions/${id}/${version}/request-review`,
        },
      },
    ]);
    expect((await liveConnection(id))?.name).toBe("Web app");

    const review = await request(app)
      .post(`${BASE}/${id}/${version}/request-review`)
      .send({})
      .set(auth);
    expect(review.body.revision.status).toBe("pending-review");

    useAdmin(approvalRule);
    const published = await request(app)
      .post(`${BASE}/${id}/${version}/publish`)
      .set(auth);
    expect(published.status).toBe(200);
    expect(published.body.bypassedGates).toEqual([
      {
        type: "approval-required",
        outcome: "bypassed",
        via: "bypassApprovalPermission",
      },
    ]);
    expect((await liveConnection(id))?.name).toBe("Web");
  });

  it("deletes a connection only once it is archived, unless REST bypasses reviews", async () => {
    // The Bypass approvals permission is no way past, as for Feature Flags.
    useAdmin();
    const id = await createConnection();

    const live = await request(app)
      .delete(`/api/v1/sdk-connections/${id}`)
      .set(auth);
    expect(live.status).toBe(403);
    expect(live.body.message).toMatch(/Archive the SDK Connection first/);

    const staged = await request(app)
      .put(`${BASE}/${id}/new/archive`)
      .send({ archived: true })
      .set(auth);
    expect(staged.status).toBe(200);
    const published = await request(app)
      .post(`${BASE}/${id}/${staged.body.revision.version}/publish`)
      .set(auth);
    expect(published.status).toBe(200);
    expect((await liveConnection(id))?.archived).toBe(true);

    const archived = await request(app)
      .delete(`/api/v1/sdk-connections/${id}`)
      .set(auth);
    expect(archived.status).toBe(200);
    expect(await liveConnection(id)).toBeNull();

    useAdmin({ restApiBypassesReviews: true });
    const other = await createConnection();
    const bypassed = await request(app)
      .delete(`/api/v1/sdk-connections/${other}`)
      .set(auth);
    expect(bypassed.status).toBe(200);
    expect(await liveConnection(other)).toBeNull();
  });

  it("reverts settings and webhooks to what a published revision left", async () => {
    useAdmin();
    const id = await createConnection();
    const publish = async (version: number) => {
      const res = await request(app)
        .post(`${BASE}/${id}/${version}/publish`)
        .set(auth);
      expect(res.status).toBe(200);
    };

    // v2 turns on rule ids and adds a webhook; v3 renames and removes it.
    const second = await request(app)
      .put(`${BASE}/${id}/new/settings`)
      .send({ includeRuleIds: true })
      .set(auth);
    const v2 = second.body.revision.version;
    const added = await request(app)
      .post(`${BASE}/${id}/${v2}/webhooks`)
      .send({ name: "Purge", endpoint: "https://example.com/purge" })
      .set(auth);
    const webhookId = added.body.revision.proposedWebhooks[0].id;
    await publish(v2);
    const [original] = await liveWebhooks(id);

    const third = await request(app)
      .put(`${BASE}/${id}/new/settings`)
      .send({ name: "Web 2" })
      .set(auth);
    const v3 = third.body.revision.version;
    await request(app)
      .delete(`${BASE}/${id}/${v3}/webhooks/${webhookId}`)
      .set(auth);
    await publish(v3);
    expect(await liveWebhooks(id)).toHaveLength(0);

    // A draft by default: nothing lands.
    const drafted = await request(app)
      .post(`${BASE}/${id}/${v2}/revert`)
      .set(auth);
    expect(drafted.status).toBe(200);
    expect(drafted.body).toMatchObject({
      revision: {
        status: "draft",
        proposedSdkConnection: { name: "Web app", includeRuleIds: true },
        proposedWebhooks: [{ id: webhookId }],
      },
      recreatedWebhookIds: [webhookId],
    });
    expect((await liveConnection(id))?.name).toBe("Web 2");
    await request(app)
      .post(`${BASE}/${id}/${drafted.body.revision.version}/discard`)
      .set(auth);

    const landed = await request(app)
      .post(`${BASE}/${id}/${v2}/revert`)
      .send({ strategy: "publish" })
      .set(auth);
    expect(landed.status).toBe(200);
    expect(landed.body.revision.status).toBe("merged");
    expect(await liveConnection(id)).toMatchObject({
      name: "Web app",
      includeRuleIds: true,
    });
    const [restored] = await liveWebhooks(id);
    expect(restored).toMatchObject({ id: webhookId, name: "Purge" });
    expect(restored.signingKey).not.toBe(original.signingKey);

    const again = await request(app)
      .post(`${BASE}/${id}/${v2}/revert`)
      .send({ strategy: "publish" })
      .set(auth);
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/nothing to revert/);

    // The first revision predates rule ids, so going back turns them off.
    const first = await request(app)
      .post(`${BASE}/${id}/1/revert`)
      .send({ strategy: "publish" })
      .set(auth);
    expect(first.status).toBe(200);
    expect((await liveConnection(id))?.includeRuleIds).toBe(false);
    expect(await liveWebhooks(id)).toHaveLength(0);

    // Under an approval rule, landing needs a bypass and leaves no draft.
    useAdmin(approvalRule, { canBypass: false });
    const refused = await request(app)
      .post(`${BASE}/${id}/${v2}/revert`)
      .send({ strategy: "publish" })
      .set(auth);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('strategy: "draft"');
    const open = await request(app).get(`${BASE}/${id}?status=open`).set(auth);
    expect(open.body.revisions).toHaveLength(0);

    // Unless the org lets reverts land without approval, which also makes
    // landing the default.
    useAdmin(
      { ...approvalRule, revertsBypassApproval: true },
      { canBypass: false },
    );
    const allowed = await request(app)
      .post(`${BASE}/${id}/${v2}/revert`)
      .set(auth);
    expect(allowed.status).toBe(200);
    expect(allowed.body.revision.status).toBe("merged");
    expect(allowed.body.bypassedGates).toEqual([
      {
        type: "approval-required",
        outcome: "bypassed",
        via: "revertsBypassApproval",
      },
    ]);
    expect((await liveConnection(id))?.includeRuleIds).toBe(true);
  });

  it("records a direct webhook write as a published revision that can be reverted", async () => {
    useAdmin();
    const id = await createConnection();
    const history = () =>
      mongoose.connection
        .collection("revisions")
        .find({ "target.id": id })
        .sort({ version: 1 })
        .toArray();
    const webhookNames = (revision: { target: { proposedChanges: unknown } }) =>
      (
        revision.target.proposedChanges as {
          value: { name: string }[];
        }[]
      )[0].value.map((wh) => wh.name);

    // A role that manages webhooks but not the connection still leaves a record.
    useAdmin({}, { webhooksOnly: true });
    const created = await request(app)
      .post(`/api/v1/sdk-connections/${id}/webhooks`)
      .send({ name: "Purge", endpoint: "https://example.com/purge" })
      .set(auth);
    expect(created.status).toBe(200);
    const webhookId = created.body.sdkWebhook.id;
    const rename = () =>
      request(app)
        .put(`/api/v1/sdk-webhooks/${webhookId}`)
        .send({ name: "Purge CDN" })
        .set(auth);
    expect((await rename()).status).toBe(200);
    // Nothing changed, so nothing to record.
    expect((await rename()).status).toBe(200);
    const deleted = await request(app)
      .delete(`/api/v1/sdk-webhooks/${webhookId}`)
      .set(auth);
    expect(deleted.status).toBe(200);

    const [baseline, ...writes] = await history();
    expect(baseline.target.proposedChanges).toEqual([]);
    expect(writes.map((r) => r.status)).toEqual(["merged", "merged", "merged"]);
    expect(writes.map(webhookNames)).toEqual([["Purge"], ["Purge CDN"], []]);

    useAdmin();
    const reverted = await request(app)
      .post(`${BASE}/${id}/${writes[1].version}/revert`)
      .send({ strategy: "publish" })
      .set(auth);
    expect(reverted.status).toBe(200);
    expect(reverted.body.recreatedWebhookIds).toEqual([webhookId]);
    expect(await liveWebhooks(id)).toMatchObject([{ name: "Purge CDN" }]);
  });

  it("runs the connection hook on writes and the revision hook on drafts", async () => {
    useAdmin();
    // Behavior comes from the runInSandbox mock, which tells them apart by code.
    const hook = (type: string, code: string) => ({
      id: `hook_${code}`,
      organization: ORG_ID,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      enabled: true,
      projects: [],
      name: code,
      hook: type,
      code,
    });
    await mongoose.connection
      .collection("customhooks")
      .insertMany([
        hook("validateSdkConnection", "connection"),
        hook("validateSdkConnectionRevision", "revision"),
      ]);
    type HookArgs = {
      sdkConnection: { name: string };
      sdkWebhooks: Record<string, unknown>[];
      revision?: Record<string, unknown> & {
        sdkConnection: { name: string };
        sdkWebhooks: Record<string, unknown>[];
      };
    };
    const ranAs = (code: string, hookCode: unknown) =>
      String(hookCode).includes(code);
    mockRunInSandbox.mockImplementation(async (code, args) => {
      const { sdkConnection, revision } = args as HookArgs;
      const error = ranAs("revision", code)
        ? revision?.sdkConnection.name === "Staged bad" && "No bad drafts"
        : sdkConnection.name === "Bad" && "No bad names";
      return error
        ? { ok: false, rejected: true, error, warnings: [] }
        : { ok: true, warnings: [] };
    });
    const lastArgs = (code = "connection") =>
      mockRunInSandbox.mock.calls
        .filter((call) => ranAs(code, call[0]))
        .at(-1)?.[1] as HookArgs;

    const badCreate = await request(app)
      .post("/api/v1/sdk-connections")
      .send({ name: "Bad", language: "javascript", environment: "production" })
      .set(auth);
    expect(badCreate.status).toBe(400);
    expect(badCreate.body.message).toContain("No bad names");

    const id = await createConnection();

    const badUpdate = await request(app)
      .put(`/api/v1/sdk-connections/${id}`)
      .send({ name: "Bad" })
      .set(auth);
    expect(badUpdate.status).toBe(400);
    expect(badUpdate.body.message).toContain("No bad names");
    expect((await liveConnection(id))?.name).toBe("Web app");

    // A direct webhook write is a change to the connection too. Hooks never
    // get the headers, which can hold credentials.
    const webhook = await request(app)
      .post(`/api/v1/sdk-connections/${id}/webhooks`)
      .send({
        name: "Purge",
        endpoint: "https://example.com/purge",
        headers: '{"X-Token":"abc"}',
      })
      .set(auth);
    expect(webhook.status).toBe(200);
    expect(lastArgs().sdkWebhooks).toMatchObject([{ name: "Purge" }]);
    expect(lastArgs().sdkWebhooks[0]).not.toHaveProperty("headers");
    // A direct write lands a revision already published, so both hooks run.
    expect(lastArgs()).not.toHaveProperty("revision");
    expect(lastArgs("revision").revision).toMatchObject({
      status: "merged",
      sdkWebhooks: [{ name: "Purge" }],
    });
    expect(lastArgs("revision").revision?.sdkWebhooks[0]).not.toHaveProperty(
      "headers",
    );

    // The revision hook sees a draft save: live, and what the draft proposes.
    const refused = await request(app)
      .put(`${BASE}/${id}/new/settings`)
      .send({ name: "Staged bad" })
      .set(auth);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("No bad drafts");
    expect(lastArgs("revision")).toMatchObject({
      sdkConnection: { name: "Web app" },
      revision: { status: "draft", sdkConnection: { name: "Staged bad" } },
    });

    const staged = await request(app)
      .put(`${BASE}/${id}/new/settings`)
      .send({ name: "Bad" })
      .set(auth);
    const { version } = staged.body.revision;
    const blocked = await request(app)
      .post(`${BASE}/${id}/${version}/publish`)
      .set(auth);
    expect(blocked.status).toBe(422);
    expect(blocked.body.gates).toMatchObject([
      { type: "custom-hook", override: "skipHooks" },
    ]);
    // Publish runs both. The revision hook gets the draft's details and
    // nothing of the snapshot it stores.
    expect(lastArgs("revision").revision).toMatchObject({
      version,
      status: "draft",
      sdkConnection: { name: "Bad" },
    });
    expect(lastArgs("revision").revision).not.toHaveProperty("target");
    expect((await liveConnection(id))?.name).toBe("Web app");

    // Past a hook too, for someone who can bypass approvals everywhere. The
    // flag is part of every body that runs a hook, and no part of the change.
    useAdmin({}, { body: { skipHooks: true } });
    const direct = await request(app)
      .put(`/api/v1/sdk-connections/${id}`)
      .send({ name: "Bad", skipHooks: true })
      .set(auth);
    expect(direct.status).toBe(200);
    await request(app)
      .put(`/api/v1/sdk-connections/${id}`)
      .send({ name: "Web app" })
      .set(auth);
    const forcedDraft = await request(app)
      .put(`${BASE}/${id}/new/settings`)
      .send({ name: "Staged bad", skipHooks: true })
      .set(auth);
    expect(forcedDraft.status).toBe(200);
    expect(forcedDraft.body.revision.proposedSdkConnection).toMatchObject({
      name: "Staged bad",
    });
    expect(forcedDraft.body.revision.proposedSdkConnection).not.toHaveProperty(
      "skipHooks",
    );

    const calls = mockRunInSandbox.mock.calls.length;
    const forced = await request(app)
      .post(`${BASE}/${id}/${version}/publish`)
      .send({ skipHooks: true })
      .set(auth);
    expect(forced.status).toBe(200);
    expect(forced.body.bypassedGates).toEqual([
      { type: "custom-hook", outcome: "bypassed", via: "skipHooks" },
    ]);
    // Each collected once as a gate, not again inside the publish.
    expect(mockRunInSandbox.mock.calls.length).toBe(calls + 2);
    expect((await liveConnection(id))?.name).toBe("Bad");

    // A rebase rewrites the draft, so the revision hook sees that too.
    useAdmin();
    const behind = await request(app)
      .put(`${BASE}/${id}/new/settings`)
      .send({ includeRuleIds: true })
      .set(auth);
    await request(app)
      .put(`/api/v1/sdk-connections/${id}`)
      .send({ name: "Web app" })
      .set(auth);
    const rebased = await request(app)
      .post(`${BASE}/${id}/${behind.body.revision.version}/rebase`)
      .set(auth);
    expect(rebased.status).toBe(200);
    expect(lastArgs("revision").revision).toMatchObject({
      version: behind.body.revision.version,
      sdkConnection: { name: "Web app", includeRuleIds: true },
    });

    // A revert that publishes at once is a direct landing, not a draft.
    await request(app)
      .put(`/api/v1/sdk-connections/${id}`)
      .send({ name: "Renamed" })
      .set(auth);
    const merged = await request(app)
      .get(`${BASE}/${id}?status=merged`)
      .set(auth);
    const target = merged.body.revisions.find(
      (r: { proposedSdkConnection: { name: string } }) =>
        r.proposedSdkConnection.name === "Web app",
    );
    const reverted = await request(app)
      .post(`${BASE}/${id}/${target.version}/revert`)
      .send({ strategy: "publish" })
      .set(auth);
    expect(reverted.status).toBe(200);
    expect(lastArgs("revision").revision).toMatchObject({
      status: "merged",
      sdkConnection: { name: "Web app" },
    });
  });
});
