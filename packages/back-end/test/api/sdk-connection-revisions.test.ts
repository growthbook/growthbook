import request from "supertest";
import mongoose from "mongoose";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import { sandboxEval } from "back-end/src/enterprise/sandbox/sandbox-core";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { getAdapter } from "back-end/src/revisions";
import { maybePublishScheduledRevision } from "back-end/src/revisions/revisionActions";
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
  const send = (
    method: "get" | "post" | "put" | "delete",
    path: string,
    body?: Record<string, unknown>,
  ) =>
    request(app)[method](path).send(body).set({ Authorization: "Bearer foo" });
  const collection = (name: string) => mongoose.connection.collection(name);

  function useAdmin(
    settings: Record<string, unknown> = {},
    {
      canBypass = true,
      webhooksOnly = false,
      actor = "key_test",
    }: { canBypass?: boolean; webhooksOnly?: boolean; actor?: string } = {},
  ) {
    const context = new ReqContextClass({
      org: orgWith(settings),
      auditUser: { type: "api_key", apiKey: actor },
      role: "admin",
    });
    context.hasPremiumFeature = () => true;
    if (!canBypass) {
      context.permissions.canBypassSDKConnectionApprovalChecks = () => false;
      const can = context.permissions.canRevisionAction.bind(
        context.permissions,
      );
      context.permissions.canRevisionAction = (
        ...args: Parameters<typeof can>
      ) => args[1] !== "bypass" && can(...args);
    }
    if (webhooksOnly) {
      context.permissions.canUpdateSDKConnection = () => false;
      context.permissions.canRevisionAction = () => false;
    }
    setReqContext(context);
  }

  async function createConnection(): Promise<string> {
    const res = await send("post", "/api/v1/sdk-connections", {
      name: "Web app",
      language: "javascript",
      environment: "production",
    });
    expect(res.status).toBe(200);
    return res.body.sdkConnection.id;
  }

  const liveConnection = (id: string) =>
    collection("sdkconnections").findOne({ id });
  const liveWebhooks = (id: string) =>
    collection("webhooks").find({ sdks: id }).toArray();

  beforeEach(async () => {
    for (const name of [
      "sdkconnections",
      "webhooks",
      "revisions",
      "customhooks",
      "webhooksecrets",
      "apikeys",
    ]) {
      await collection(name).deleteMany({ organization: ORG_ID });
    }
    // Hook code runs for real, in an isolate without the worker pool.
    mockRunInSandbox.mockReset();
    mockRunInSandbox.mockImplementation(sandboxEval);
  });

  it("stages settings and webhooks in one draft and publishes them together", async () => {
    useAdmin();
    const id = await createConnection();

    const staged = await send("put", `${BASE}/${id}/new/settings`, {
      includeRuleIds: true,
      revisionTitle: "Rule ids",
    });
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

    const added = await send("post", `${BASE}/${id}/${version}/webhooks`, {
      name: "Purge",
      endpoint: "https://example.com/purge",
      headers: '{"X-Token":"abc"}',
    });
    expect(added.status).toBe(200);
    const [webhook] = added.body.revision.proposedSdkWebhooks;
    expect(webhook).toMatchObject({
      name: "Purge",
      httpMethod: "POST",
      payloadFormat: "standard",
    });
    // A write's response may be shown on a confirmation, so only reads carry
    // the headers.
    expect(webhook).not.toHaveProperty("headers");

    const edited = await send(
      "put",
      `${BASE}/${id}/${version}/webhooks/${webhook.id}`,
      { endpoint: "https://example.com/purge-v2" },
    );
    expect(edited.status).toBe(200);
    expect(edited.body.revision.proposedSdkWebhooks).toEqual([
      { ...webhook, endpoint: "https://example.com/purge-v2" },
    ]);

    // Nothing is live yet.
    expect((await liveConnection(id))?.includeRuleIds).not.toBe(true);
    expect(await liveWebhooks(id)).toHaveLength(0);

    const latest = await send("get", `${BASE}/${id}/latest`);
    expect(latest.body.revision.version).toBe(version);
    expect(latest.body.revision.proposedSdkWebhooks[0].headers).toBe(
      '{"X-Token":"abc"}',
    );

    const published = await send("post", `${BASE}/${id}/${version}/publish`);
    expect(published.status).toBe(200);
    expect(published.body.revision.status).toBe("merged");
    expect(published.body.bypassedGates).toBeUndefined();

    expect((await liveConnection(id))?.includeRuleIds).toBe(true);
    expect(await liveWebhooks(id)).toMatchObject([
      { id: webhook.id, endpoint: "https://example.com/purge-v2" },
    ]);

    const list = await send("get", `${BASE}/${id}?status=merged`);
    expect(list.body.revisions.map((r) => r.version)).toContain(version);

    // The org-wide list finds it too, alone or among other connections'.
    const other = await createConnection();
    await send("put", `${BASE}/${other}/new/settings`, { name: "Other" });
    const open = await send("get", `${BASE}?status=open`);
    expect(open.body.revisions).toMatchObject([
      { status: "draft", baseSdkConnection: { id: other } },
    ]);
    const one = await send(
      "get",
      `${BASE}?sdkConnectionId=${id}&status=merged`,
    );
    expect(one.body.revisions.length).toBeGreaterThan(0);
    expect(one.body.revisions.every((r) => r.baseSdkConnection.id === id)).toBe(
      true,
    );
  });

  it("never lets a revision or a direct write set the proxy on a self-hosted instance", async () => {
    useAdmin();
    const id = await createConnection();
    const proxy = {
      proxyEnabled: true,
      proxyHost: "https://proxy.example.com",
    };
    const live = async () =>
      (await send("get", `/api/v1/sdk-connections/${id}`)).body.sdkConnection;

    const staged = await send("put", `${BASE}/${id}/new/settings`, {
      ...proxy,
      name: "Renamed",
    });
    expect(staged.status).toBe(200);
    const published = await send(
      "post",
      `${BASE}/${id}/${staged.body.revision.version}/publish`,
    );
    expect(published.status).toBe(200);
    await send("put", `/api/v1/sdk-connections/${id}`, proxy);

    // The rename landed. The proxy is the environment's, read and stored.
    expect(await live()).toMatchObject({
      name: "Renamed",
      proxyEnabled: false,
      proxyHost: "",
    });
    expect((await liveConnection(id))?.proxy).toMatchObject({
      enabled: false,
      host: "",
    });
  });

  it("refuses to open a draft that changes nothing, or to edit a published one", async () => {
    useAdmin();
    const id = await createConnection();

    const noop = await send("put", `${BASE}/${id}/new/settings`, {
      name: "Web app",
    });
    expect(noop.status).toBe(400);
    expect(noop.body.message).toMatch(/Nothing to stage/);

    const hook = await send("post", `/api/v1/sdk-connections/${id}/webhooks`, {
      name: "Purge",
      endpoint: "https://example.com/purge",
    });
    const sameWebhook = await send(
      "put",
      `${BASE}/${id}/new/webhooks/${hook.body.sdkWebhook.id}`,
      { name: "Purge" },
    );
    expect(sameWebhook.status).toBe(400);
    expect(sameWebhook.body.message).toMatch(/Nothing to stage/);
    // Refused when staged, not when the publish writes it.
    const slow = await send("post", `${BASE}/${id}/new/webhooks`, {
      name: "Slow",
      endpoint: "https://example.com/slow",
      timeoutSeconds: 100000,
    });
    expect(slow.status).toBe(400);
    expect(slow.body.message).toMatch(/timeout/i);

    const staged = await send("put", `${BASE}/${id}/new/settings`, {
      name: "Web",
    });
    const { version } = staged.body.revision;
    await send("post", `${BASE}/${id}/${version}/publish`);

    const late = await send("put", `${BASE}/${id}/${version}/settings`, {
      name: "Web again",
    });
    expect(late.status).toBe(400);
    expect(late.body.message).toMatch(/status "merged"/);
  });

  it("walks a draft through review, scheduling, a conflict, and discard", async () => {
    useAdmin(approvalRule);
    const id = await createConnection();
    const staged = await send("put", `${BASE}/${id}/new/settings`, {
      name: "Web 2",
    });
    const draft = `${BASE}/${id}/${staged.body.revision.version}`;
    const call = (
      method: "get" | "post",
      path: string,
      body?: Record<string, unknown>,
    ) => send(method, `${draft}${path}`, body);
    const status = async (res: request.Response) => {
      expect(res.status).toBe(200);
      return res.body.revision.status;
    };

    expect(await status(await call("get", ""))).toBe("draft");
    const upToDate = await call("get", "/merge-status");
    expect(upToDate.body).toMatchObject({ hasConflicts: false });
    expect(await status(await call("post", "/request-review"))).toBe(
      "pending-review",
    );
    expect(await status(await call("post", "/recall-review"))).toBe("draft");
    await call("post", "/request-review");

    useAdmin(approvalRule, { actor: "key_reviewer" });
    const approve = () =>
      call("post", "/submit-review", { decision: "approve" });
    expect(await status(await approve())).toBe("approved");
    expect(await status(await call("post", "/undo-review"))).toBe(
      "pending-review",
    );
    await approve();

    useAdmin(approvalRule);
    for (const scheduledPublishAt of ["2099-01-01T00:00:00Z", null]) {
      expect(
        await status(
          await call("post", "/schedule-publish", { scheduledPublishAt }),
        ),
      ).toBe("approved");
    }

    // Live changes the setting the draft changes: a conflict to resolve.
    const bypassed = await send("put", `/api/v1/sdk-connections/${id}`, {
      name: "Live name",
      bypassApproval: true,
    });
    expect(bypassed.status).toBe(200);
    expect(bypassed.body.bypassedGates).toEqual([
      {
        type: "approval-required",
        outcome: "bypassed",
        via: "bypassApprovalPermission",
      },
    ]);
    const behind = await call("get", "/merge-status");
    expect(behind.body).toMatchObject({
      hasConflicts: true,
      conflicts: [{ field: "sdkConnection" }],
    });
    const rebased = await call("post", "/rebase", {
      conflictResolutions: { sdkConnection: "overwrite" },
    });
    expect(rebased.status).toBe(200);
    expect(rebased.body.revision).toMatchObject({
      baseSdkConnection: { name: "Live name" },
      proposedSdkConnection: { name: "Web 2" },
    });

    expect(await status(await call("post", "/discard"))).toBe("discarded");
    expect(await status(await call("post", "/reopen"))).toBe("draft");
  });

  it("warns about a webhook secret that doesn't exist, at publish, when scheduled, and when the schedule fires", async () => {
    useAdmin();
    const id = await createConnection();
    const now = new Date();
    await collection("webhooksecrets").insertOne({
      id: "secret_cdn",
      organization: ORG_ID,
      key: "CDN_TOKEN",
      value: "abc",
      dateCreated: now,
      dateUpdated: now,
    });
    // Whoever scheduled a publish is looked up again when it fires.
    await collection("apikeys").insertOne({
      id: "key_test",
      organization: ORG_ID,
      key: "secret_test",
      secret: true,
      description: "test",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
      dateCreated: now,
      dateUpdated: now,
    });
    const using = (secret: string) => ({
      name: `Uses ${secret}`,
      endpoint: "https://example.com/purge",
      headers: `{"Authorization":"Bearer {{ ${secret} }}"}`,
    });
    const names = async () => (await liveWebhooks(id)).map((w) => w.name);
    const fire = async (version: number) => {
      await collection("revisions").updateOne(
        { "target.id": id, version },
        { $set: { scheduledPublishAt: new Date(Date.now() - 1000) } },
      );
      const job = getContextForAgendaJobByOrgObject(orgWith());
      const revision = await job.models.revisions.getByTargetAndVersion(
        "sdk-connection",
        id,
        version,
      );
      const live = await getAdapter("sdk-connection")
        .getModel(job)
        ?.getById(id);
      await maybePublishScheduledRevision(
        job,
        revision!,
        live as Record<string, unknown>,
      );
      return collection("revisions").findOne({ "target.id": id, version });
    };

    // A direct save asks first.
    const warned = await send(
      "post",
      `/api/v1/sdk-connections/${id}/webhooks`,
      using("NOPE"),
    );
    expect(warned.status).toBe(422);
    expect(warned.body.warnings).toEqual([
      expect.stringContaining('references the secret "NOPE"'),
    ]);
    expect(await names()).toEqual([]);

    // Staging says nothing. Publishing lists it as a gate.
    const staged = await send(
      "post",
      `${BASE}/${id}/new/webhooks`,
      using("NOPE"),
    );
    expect(staged.status).toBe(200);
    const { version } = staged.body.revision;
    const draft = `${BASE}/${id}/${version}`;
    const blocked = await send("post", `${draft}/publish`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.gates).toMatchObject([
      {
        type: "missing-webhook-secret",
        severity: "warning",
        override: "ignoreWarnings",
      },
    ]);

    // Scheduling asks too. What was acknowledged then stands when it fires.
    const scheduledPublishAt = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      (await send("post", `${draft}/schedule-publish`, { scheduledPublishAt }))
        .status,
    ).toBe(422);
    expect(
      (
        await send("post", `${draft}/schedule-publish`, {
          scheduledPublishAt,
          ignoreWarnings: true,
        })
      ).status,
    ).toBe(200);
    expect((await fire(version))?.status).toBe("merged");
    const [webhook] = await liveWebhooks(id);
    expect(webhook.name).toBe("Uses NOPE");

    // A secret that exists raises nothing. Removed after scheduling, it stops
    // the publish.
    const edited = await send(
      "put",
      `${BASE}/${id}/new/webhooks/${webhook.id}`,
      using("CDN_TOKEN"),
    );
    const second = edited.body.revision.version;
    expect(
      (
        await send("post", `${BASE}/${id}/${second}/schedule-publish`, {
          scheduledPublishAt,
        })
      ).status,
    ).toBe(200);
    await collection("webhooksecrets").deleteOne({ id: "secret_cdn" });
    const parked = await fire(second);
    expect(parked).toMatchObject({
      status: "draft",
      scheduledPublishAttempts: 1,
      scheduledPublishGaveUpAt: expect.any(Date),
      scheduledPublishLastError: expect.stringContaining("went missing"),
    });
    expect(await names()).toEqual(["Uses NOPE"]);

    // Each step is announced, and no event carries a webhook's headers.
    const events = await collection("events")
      .find({ "data.event": /^sdkConnection\.revision\./ })
      .sort({ dateCreated: 1 })
      .toArray();
    expect(events.map((e) => e.data.event.split(".")[2])).toEqual([
      "created",
      "publishScheduleChanged",
      "published",
      "created",
      "publishScheduleChanged",
      "publishFailed",
    ]);
    expect(events.at(-1)?.data.data.object).toMatchObject({
      terminal: true,
      failureReason: expect.stringContaining("went missing"),
    });
    expect(JSON.stringify(events)).not.toContain("Bearer");
  });

  it("lists every publish gate when approval is required, and reports a bypass", async () => {
    useAdmin();
    const id = await createConnection();

    useAdmin(approvalRule, { canBypass: false });
    const direct = await send("put", `/api/v1/sdk-connections/${id}`, {
      name: "Web",
    });
    expect(direct.status).toBe(400);
    expect(direct.body.message).toContain(
      `PUT /sdk-connections-revisions/${id}/new/settings`,
    );
    expect(direct.body.message).toContain("bypassApproval");

    const staged = await send("put", `${BASE}/${id}/new/settings`, {
      name: "Web",
    });
    expect(staged.status).toBe(200);
    const { version } = staged.body.revision;

    const blocked = await send("post", `${BASE}/${id}/${version}/publish`);
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

    useAdmin(approvalRule);
    const published = await send("post", `${BASE}/${id}/${version}/publish`);
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

    const live = await send("delete", `/api/v1/sdk-connections/${id}`);
    expect(live.status).toBe(403);
    expect(live.body.message).toMatch(/Archive the SDK Connection first/);

    const staged = await send("put", `${BASE}/${id}/new/archive`, {
      archived: true,
    });
    expect(staged.status).toBe(200);
    const published = await send(
      "post",
      `${BASE}/${id}/${staged.body.revision.version}/publish`,
    );
    expect(published.status).toBe(200);
    expect((await liveConnection(id))?.archived).toBe(true);

    const archived = await send("delete", `/api/v1/sdk-connections/${id}`);
    expect(archived.status).toBe(200);
    expect(archived.body).toEqual({ deletedId: id });
    expect(await liveConnection(id)).toBeNull();

    useAdmin({ restApiBypassesReviews: true });
    const other = await createConnection();
    const bypassed = await send("delete", `/api/v1/sdk-connections/${other}`);
    expect(bypassed.status).toBe(200);
    expect(await liveConnection(other)).toBeNull();
  });

  it("reverts settings and webhooks to what a published revision left", async () => {
    useAdmin();
    const id = await createConnection();
    const publish = async (version: number) => {
      const res = await send("post", `${BASE}/${id}/${version}/publish`);
      expect(res.status).toBe(200);
    };

    // v2 turns on rule ids and adds a webhook; v3 renames and removes it.
    const second = await send("put", `${BASE}/${id}/new/settings`, {
      includeRuleIds: true,
    });
    const v2 = second.body.revision.version;
    const added = await send("post", `${BASE}/${id}/${v2}/webhooks`, {
      name: "Purge",
      endpoint: "https://example.com/purge",
    });
    const webhookId = added.body.revision.proposedSdkWebhooks[0].id;
    await publish(v2);
    const [original] = await liveWebhooks(id);

    const third = await send("put", `${BASE}/${id}/new/settings`, {
      name: "Web 2",
    });
    const v3 = third.body.revision.version;
    await send("delete", `${BASE}/${id}/${v3}/webhooks/${webhookId}`);
    await publish(v3);
    expect(await liveWebhooks(id)).toHaveLength(0);

    // A draft by default: nothing lands.
    const drafted = await send("post", `${BASE}/${id}/${v2}/revert`);
    expect(drafted.status).toBe(200);
    expect(drafted.body).toMatchObject({
      revision: {
        status: "draft",
        proposedSdkConnection: { name: "Web app", includeRuleIds: true },
        proposedSdkWebhooks: [{ id: webhookId }],
      },
    });
    // Nothing is recreated until the revert lands.
    expect(drafted.body).not.toHaveProperty("recreatedWebhookIds");
    expect((await liveConnection(id))?.name).toBe("Web 2");
    await send(
      "post",
      `${BASE}/${id}/${drafted.body.revision.version}/discard`,
    );

    const landed = await send("post", `${BASE}/${id}/${v2}/revert`, {
      strategy: "publish",
    });
    expect(landed.status).toBe(200);
    expect(landed.body.revision.status).toBe("merged");
    expect(landed.body.recreatedWebhookIds).toEqual([webhookId]);
    expect(await liveConnection(id)).toMatchObject({
      name: "Web app",
      includeRuleIds: true,
    });
    const [restored] = await liveWebhooks(id);
    expect(restored).toMatchObject({ id: webhookId, name: "Purge" });
    expect(restored.signingKey).not.toBe(original.signingKey);

    const again = await send("post", `${BASE}/${id}/${v2}/revert`, {
      strategy: "publish",
    });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/nothing to revert/);

    // The first revision predates rule ids, so going back turns them off.
    const first = await send("post", `${BASE}/${id}/1/revert`, {
      strategy: "publish",
    });
    expect(first.status).toBe(200);
    expect((await liveConnection(id))?.includeRuleIds).toBe(false);
    expect(await liveWebhooks(id)).toHaveLength(0);

    // Under an approval rule, landing needs a bypass and leaves no draft.
    useAdmin(approvalRule, { canBypass: false });
    const refused = await send("post", `${BASE}/${id}/${v2}/revert`, {
      strategy: "publish",
    });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('strategy: "draft"');
    const open = await send("get", `${BASE}/${id}?status=open`);
    expect(open.body.revisions).toHaveLength(0);

    // Unless the org lets reverts land without approval, which also makes
    // landing the default.
    useAdmin(
      { ...approvalRule, revertsBypassApproval: true },
      { canBypass: false },
    );
    const allowed = await send("post", `${BASE}/${id}/${v2}/revert`);
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

  it("records a direct webhook write as a published revision", async () => {
    useAdmin();
    const id = await createConnection();

    // A role that manages webhooks but not the connection still leaves a record.
    useAdmin({}, { webhooksOnly: true });
    const created = await send(
      "post",
      `/api/v1/sdk-connections/${id}/webhooks`,
      { name: "Purge", endpoint: "https://example.com/purge" },
    );
    expect(created.status).toBe(200);
    const webhookId = created.body.sdkWebhook.id;
    const rename = () =>
      send("put", `/api/v1/sdk-webhooks/${webhookId}`, { name: "Purge CDN" });
    expect((await rename()).status).toBe(200);
    // Nothing changed, so nothing to record.
    expect((await rename()).status).toBe(200);
    const deleted = await send("delete", `/api/v1/sdk-webhooks/${webhookId}`);
    expect(deleted.status).toBe(200);

    const [baseline, ...writes] = await collection("revisions")
      .find({ "target.id": id })
      .sort({ version: 1 })
      .toArray();
    expect(baseline.target.proposedChanges).toEqual([]);
    expect(writes.map((r) => r.status)).toEqual(["merged", "merged", "merged"]);
    expect(
      writes.map((r) => r.target.proposedChanges[0].value.map((wh) => wh.name)),
    ).toEqual([["Purge"], ["Purge CDN"], []]);
  });

  it("runs the connection hook on writes and the revision hook on drafts", async () => {
    useAdmin();
    const hook = (type: string, code: string) => ({
      id: `hook_${type}`,
      organization: ORG_ID,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      enabled: true,
      projects: [],
      name: type,
      hook: type,
      code,
    });
    await collection("customhooks").insertMany([
      hook(
        "validateSdkConnection",
        `if (sdkConnection.name === "Bad") throw new Error("No bad names");`,
      ),
      hook(
        "validateSdkConnectionRevision",
        `if (revision.sdkConnection.name === "Staged bad") throw new Error("No bad drafts");`,
      ),
    ]);
    const lastArgs = (hookType = "connection") =>
      mockRunInSandbox.mock.calls
        .filter(
          (call) => call[0].includes("revision.") === (hookType === "revision"),
        )
        .at(-1)?.[1];

    const badCreate = await send("post", "/api/v1/sdk-connections", {
      name: "Bad",
      language: "javascript",
      environment: "production",
    });
    expect(badCreate.status).toBe(400);
    expect(badCreate.body.message).toContain("No bad names");
    // The hook judges what will be saved, defaults included.
    expect(lastArgs().sdkConnection).toMatchObject({
      includeReferencedPrerequisites: true,
    });

    const id = await createConnection();

    const badUpdate = await send("put", `/api/v1/sdk-connections/${id}`, {
      name: "Bad",
    });
    expect(badUpdate.status).toBe(400);
    expect(badUpdate.body.message).toContain("No bad names");
    expect((await liveConnection(id))?.name).toBe("Web app");

    // A direct webhook write is a change to the connection too. Hooks get the
    // headers as an object.
    const webhook = await send(
      "post",
      `/api/v1/sdk-connections/${id}/webhooks`,
      {
        name: "Purge",
        endpoint: "https://example.com/purge",
        headers: '{"X-Token":"abc"}',
      },
    );
    expect(webhook.status).toBe(200);
    expect(lastArgs().sdkWebhooks).toMatchObject([
      { name: "Purge", headers: { "X-Token": "abc" } },
    ]);
    // A direct write lands a revision already published, so both hooks run.
    expect(lastArgs()).not.toHaveProperty("revision");
    expect(lastArgs("revision").revision).toMatchObject({
      status: "published",
      sdkWebhooks: [{ name: "Purge", headers: { "X-Token": "abc" } }],
    });

    // The revision hook sees a draft save: live, and what the draft proposes.
    const refused = await send("put", `${BASE}/${id}/new/settings`, {
      name: "Staged bad",
      revisionTitle: "Rename",
    });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("No bad drafts");
    expect(lastArgs("revision")).toMatchObject({
      sdkConnection: { name: "Web app" },
      revision: {
        status: "draft",
        title: "Rename",
        sdkConnection: { name: "Staged bad" },
      },
    });

    const staged = await send("put", `${BASE}/${id}/new/settings`, {
      name: "Bad",
    });
    const { version } = staged.body.revision;
    const blocked = await send("post", `${BASE}/${id}/${version}/publish`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.gates).toMatchObject([
      { type: "custom-hook", override: "skipHooks" },
    ]);
    // Publish runs both. The revision hook gets the draft's details and
    // nothing of the snapshot it stores, and is told it is a publish.
    expect(lastArgs("revision").revision).toMatchObject({
      version,
      status: "published",
      sdkConnection: { name: "Bad" },
    });
    expect(lastArgs("revision").revision).not.toHaveProperty("target");
    expect((await liveConnection(id))?.name).toBe("Web app");

    // Hooks get no key of the connection's or its webhooks'.
    expect(lastArgs().sdkConnection).not.toHaveProperty("key");
    expect(lastArgs().sdkConnection).not.toHaveProperty("encryptionKey");
    expect(lastArgs().sdkWebhooks[0]).not.toHaveProperty("signingKey");

    // The flag alone clears nothing.
    useAdmin({}, { canBypass: false });
    const unskipped = await send("put", `/api/v1/sdk-connections/${id}`, {
      name: "Bad",
      skipHooks: true,
    });
    expect(unskipped.status).toBe(400);
    expect(unskipped.body.message).toContain("No bad names");

    // Past a hook too, for someone who can bypass approvals everywhere. The
    // flag is part of every body that runs a hook, and no part of the change.
    useAdmin();
    const direct = await send("put", `/api/v1/sdk-connections/${id}`, {
      name: "Bad",
      skipHooks: true,
    });
    expect(direct.status).toBe(200);
    await send("put", `/api/v1/sdk-connections/${id}`, { name: "Web app" });
    const forcedDraft = await send("put", `${BASE}/${id}/new/settings`, {
      name: "Staged bad",
      skipHooks: true,
    });
    expect(forcedDraft.status).toBe(200);
    expect(forcedDraft.body.revision.proposedSdkConnection).toMatchObject({
      name: "Staged bad",
    });
    expect(forcedDraft.body.revision.proposedSdkConnection).not.toHaveProperty(
      "skipHooks",
    );

    const calls = mockRunInSandbox.mock.calls.length;
    const forced = await send("post", `${BASE}/${id}/${version}/publish`, {
      skipHooks: true,
    });
    expect(forced.status).toBe(200);
    expect(forced.body.bypassedGates).toEqual([
      { type: "custom-hook", outcome: "bypassed", via: "skipHooks" },
    ]);
    // Each collected once as a gate, not again inside the publish.
    expect(mockRunInSandbox.mock.calls.length).toBe(calls + 2);
    expect((await liveConnection(id))?.name).toBe("Bad");

    // A rebase rewrites the draft, so the revision hook sees that too.
    useAdmin();
    const behind = await send("put", `${BASE}/${id}/new/settings`, {
      includeRuleIds: true,
    });
    await send("put", `/api/v1/sdk-connections/${id}`, { name: "Web app" });
    const rebased = await send(
      "post",
      `${BASE}/${id}/${behind.body.revision.version}/rebase`,
    );
    expect(rebased.status).toBe(200);
    expect(lastArgs("revision").revision).toMatchObject({
      version: behind.body.revision.version,
      sdkConnection: { name: "Web app", includeRuleIds: true },
    });

    // A revert that publishes at once is a direct landing, not a draft.
    await send("put", `/api/v1/sdk-connections/${id}`, { name: "Renamed" });
    const merged = await send("get", `${BASE}/${id}?status=merged`);
    const target = merged.body.revisions.find(
      (r: { proposedSdkConnection: { name: string } }) =>
        r.proposedSdkConnection.name === "Web app",
    );
    const reverted = await send(
      "post",
      `${BASE}/${id}/${target.version}/revert`,
      { strategy: "publish" },
    );
    expect(reverted.status).toBe(200);
    expect(lastArgs("revision").revision).toMatchObject({
      status: "published",
      sdkConnection: { name: "Web app" },
    });
  });
});
