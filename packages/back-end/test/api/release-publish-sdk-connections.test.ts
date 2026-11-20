import request from "supertest";
import mongoose from "mongoose";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import { sandboxEval } from "back-end/src/enterprise/sandbox/sandbox-core";
import { fireSdkWebhook } from "back-end/src/jobs/sdkWebhooks";
import { SdkWebhookModel } from "back-end/src/models/WebhookModel";
import { setupApp } from "./api.setup";

// SDK Connections in POST /api/v1/releases/publish-revisions: a connection's
// settings and webhooks land with the rest of a release, or not at all.

jest.mock("back-end/src/enterprise/sandbox/sandbox-pool", () => ({
  runInSandbox: jest.fn(),
}));
jest.mock("back-end/src/jobs/sdkWebhooks", () => ({
  __esModule: true,
  ...jest.requireActual("back-end/src/jobs/sdkWebhooks"),
  fireSdkWebhook: jest.fn(async () => undefined),
}));
const mockRunInSandbox = runInSandbox as jest.MockedFunction<
  typeof runInSandbox
>;
const mockFireSdkWebhook = fireSdkWebhook as jest.MockedFunction<
  typeof fireSdkWebhook
>;

const ORG_ID = "org_release_sdk";
const DRAFTS = "/api/v1/sdk-connections-revisions";

const org = {
  id: ORG_ID,
  name: "Release SDK",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }] },
} as unknown as OrganizationInterface;

describe("SDK Connections in a release", () => {
  const { app, setReqContext } = setupApp();
  const collection = (name: string) => mongoose.connection.collection(name);

  beforeEach(async () => {
    for (const name of [
      "sdkconnections",
      "webhooks",
      "revisions",
      "customhooks",
      "constants",
      "projects",
      "webhooksecrets",
    ]) {
      await collection(name).deleteMany({ organization: ORG_ID });
    }
    // The secret the fixture webhooks' headers reference.
    await collection("webhooksecrets").insertOne({
      id: "secret_token",
      organization: ORG_ID,
      key: "TOKEN",
      value: "abc",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    mockRunInSandbox.mockReset();
    mockRunInSandbox.mockImplementation(sandboxEval);
    const context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
    });
    context.hasPremiumFeature = () => true;
    setReqContext(context);
  });

  const send = (
    method: "get" | "post" | "put" | "delete",
    path: string,
    body?: Record<string, unknown>,
  ) =>
    request(app)[method](path).send(body).set({ Authorization: "Bearer foo" });

  async function createConnection(name = "Web app"): Promise<string> {
    const created = await send("post", "/api/v1/sdk-connections", {
      name,
      language: "javascript",
      environment: "production",
    });
    return created.body.sdkConnection.id;
  }

  // A connection with three live webhooks, and a draft that changes a
  // setting, adds a webhook, renames one and removes one.
  async function connectionWithDraft(name: string) {
    const id = await createConnection(name);
    const webhookIds: Record<string, string> = {};
    for (const hook of ["Keep", "Rename me", "Delete me"]) {
      const res = await send("post", `/api/v1/sdk-connections/${id}/webhooks`, {
        name: hook,
        endpoint: `https://example.com/${encodeURIComponent(hook)}`,
        headers: '{"X-Token":"{{ TOKEN }}"}',
      });
      expect(res.status).toBe(200);
      webhookIds[hook] = res.body.sdkWebhook.id;
    }
    const staged = await send("put", `${DRAFTS}/${id}/new/settings`, {
      includeRuleIds: true,
    });
    expect(staged.status).toBe(200);
    const version: number = staged.body.revision.version;
    const draft = `${DRAFTS}/${id}/${version}/webhooks`;
    for (const res of [
      await send("post", draft, {
        name: "Added",
        endpoint: "https://example.com/added",
      }),
      await send("put", `${draft}/${webhookIds["Rename me"]}`, {
        name: "Renamed",
      }),
      await send("delete", `${draft}/${webhookIds["Delete me"]}`),
    ]) {
      expect(res.status).toBe(200);
    }
    return { id, version, ref: { entityType: "sdk-connection", id, version } };
  }

  async function constantWithDraft(key: string) {
    const now = new Date();
    await collection("constants").insertOne({
      id: `const_${key}`,
      organization: ORG_ID,
      key,
      name: key,
      owner: "",
      type: "string",
      value: "before",
      dateCreated: now,
      dateUpdated: now,
    });
    const res = await send(
      "put",
      `/api/v1/constants-revisions/${key}/new/value`,
      {
        value: "after",
      },
    );
    expect(res.status).toBe(200);
    return { entityType: "constant", key, version: res.body.revision.version };
  }

  const publish = (body: Record<string, unknown>) =>
    send("post", "/api/v1/releases/publish-revisions", body);

  // What is live, in a form that shows any difference a rollback left.
  async function live(id: string) {
    const connection = await collection("sdkconnections").findOne({ id });
    const webhooks = await collection("webhooks")
      .find({ sdks: id })
      .sort({ name: 1 })
      .toArray();
    return {
      includeRuleIds: !!connection?.includeRuleIds,
      webhooks: webhooks.map((w) => ({
        id: w.id,
        name: w.name,
        endpoint: w.endpoint,
        headers: w.headers,
        signingKey: w.signingKey,
        lastSuccess: w.lastSuccess,
      })),
    };
  }
  const draftStatus = async (id: string, version: number) =>
    (await collection("revisions").findOne({ "target.id": id, version }))
      ?.status;
  const constantValue = async (key: string) =>
    (await collection("constants").findOne({ organization: ORG_ID, key }))
      ?.value;

  it("publishes a connection and a constant together", async () => {
    const a = await connectionWithDraft("Web app");
    const constant = await constantWithDraft("rel-sdk-ok");

    const res = await publish({ revisions: [a.ref, constant] });
    expect(res.status).toBe(200);
    expect(res.body.results).toMatchObject([
      { entityType: "sdk-connection", id: a.id, status: "published" },
      { entityType: "constant", id: "rel-sdk-ok", status: "published" },
    ]);
    const now = await live(a.id);
    expect(now.includeRuleIds).toBe(true);
    expect(now.webhooks.map((w) => w.name)).toEqual([
      "Added",
      "Keep",
      "Renamed",
    ]);
    expect(await draftStatus(a.id, a.version)).toBe("merged");
    expect(await constantValue("rel-sdk-ok")).toBe("after");
  });

  it("holds the release on a connection's hook, until it is skipped", async () => {
    const a = await connectionWithDraft("Web app");
    await collection("customhooks").insertOne({
      id: "hook_release_sdk",
      organization: ORG_ID,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      enabled: true,
      projects: [],
      name: "No added webhooks",
      hook: "validateSdkConnection",
      code: `if (sdkWebhooks.some((w) => w.name === "Added")) throw new Error("No added webhooks");`,
    });
    const revisions = [a.ref];

    const blocked = await publish({ revisions });
    expect(blocked.status).toBe(422);
    expect(blocked.body.gates).toMatchObject([
      {
        entityType: "sdk-connection",
        id: a.id,
        type: "custom-hook",
        override: "skipHooks",
      },
    ]);
    expect(await draftStatus(a.id, a.version)).toBe("draft");

    const forced = await publish({ revisions, skipHooks: true });
    expect(forced.status).toBe(200);
    expect(forced.body.bypassedGates).toMatchObject([
      { entityType: "sdk-connection", type: "custom-hook", via: "skipHooks" },
    ]);
    expect(await draftStatus(a.id, a.version)).toBe("merged");
  });

  it("holds the release when a connection's draft can no longer publish", async () => {
    const a = await connectionWithDraft("Web app");
    const b = await connectionWithDraft("Mobile app");
    // Since the draft renamed it, the webhook was attached to another
    // connection, where a draft of this one may not change it.
    const renamed = (await live(a.id)).webhooks.find(
      (w) => w.name === "Rename me",
    );
    const shared = await send("put", `/api/v1/sdk-webhooks/${renamed?.id}`, {
      sdkConnections: [a.id, b.id],
    });
    expect(shared.status).toBe(200);

    const res = await publish({ revisions: [a.ref] });
    expect(res.status).toBe(422);
    expect(res.body.gates).toMatchObject([
      { entityType: "sdk-connection", id: a.id, type: "validation" },
    ]);
  });

  it("warns about a webhook secret that doesn't exist, until it is acknowledged", async () => {
    const id = await createConnection();
    const staged = await send("post", `${DRAFTS}/${id}/new/webhooks`, {
      name: "Purge",
      endpoint: "https://example.com/purge?token={{ NOPE }}",
    });
    const revisions = [
      {
        entityType: "sdk-connection",
        id,
        version: staged.body.revision.version,
      },
    ];

    const blocked = await publish({ revisions });
    expect(blocked.status).toBe(422);
    expect(blocked.body.gates).toMatchObject([
      { type: "missing-webhook-secret", override: "ignoreWarnings" },
    ]);
    expect((await publish({ revisions, ignoreWarnings: true })).status).toBe(
      200,
    );
  });

  it("records what landed when a draft behind live publishes in a release", async () => {
    const a = await connectionWithDraft("Web app");
    const renamed = await send("put", `/api/v1/sdk-connections/${a.id}`, {
      name: "Renamed live",
    });
    expect(renamed.status).toBe(200);

    const res = await publish({ revisions: [a.ref], ignoreWarnings: true });
    expect(res.status).toBe(200);
    const record = await send("get", `${DRAFTS}/${a.id}/${a.version}`);
    // Live kept the rename, so the published revision shows it too.
    expect(record.body.revision.proposedSdkConnection).toMatchObject({
      name: "Renamed live",
      includeRuleIds: true,
    });
  });

  it("asks for bypass access where a draft moves a connection", async () => {
    await collection("projects").insertOne({
      id: "prj_dest",
      organization: ORG_ID,
      name: "Destination",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    const id = await createConnection();
    const staged = await send("put", `${DRAFTS}/${id}/new/settings`, {
      projects: ["prj_dest"],
    });
    expect(staged.status).toBe(200);

    // Approval is required, and the caller may bypass it everywhere but in
    // the Project the draft moves the connection to.
    const context = new ReqContextClass({
      org: {
        ...org,
        settings: {
          ...org.settings,
          approvalFlows: {
            sdkConnections: [
              { required: true, projects: [], environments: [] },
            ],
          },
        },
      } as OrganizationInterface,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
    });
    context.hasPremiumFeature = () => true;
    context.permissions.canBypassSDKConnectionApprovalChecks = (scope) =>
      scope.project !== "prj_dest";
    setReqContext(context);

    const res = await publish({
      revisions: [
        {
          entityType: "sdk-connection",
          id,
          version: staged.body.revision.version,
        },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.gates).toMatchObject([{ type: "approval-required" }]);
    expect(
      (await collection("sdkconnections").findOne({ id }))?.projects,
    ).toEqual([]);
  });

  it("puts back a connection that landed and one that failed partway", async () => {
    const a = await connectionWithDraft("Web app");
    const b = await connectionWithDraft("Mobile app");
    const constant = await constantWithDraft("rel-sdk-fail");
    const before = { a: await live(a.id), b: await live(b.id) };
    const revisions = [a.ref, b.ref, constant];
    mockFireSdkWebhook.mockClear();
    // The first connection lands whole. The second has its settings and added
    // webhook live when its rename fails.
    const original = SdkWebhookModel.prototype.saveEdit;
    const saveEdit = jest
      .spyOn(SdkWebhookModel.prototype, "saveEdit")
      .mockImplementationOnce(function (
        this: SdkWebhookModel,
        ...args: Parameters<typeof original>
      ) {
        return original.apply(this, args);
      })
      .mockRejectedValueOnce(new Error("simulated infra failure"));

    const res = await publish({ revisions });
    expect(res.status).toBe(500);
    // Removed and renamed webhooks are back as they were, signing key included.
    expect({ a: await live(a.id), b: await live(b.id) }).toEqual(before);
    expect(await draftStatus(a.id, a.version)).toBe("draft");
    expect(await draftStatus(b.id, b.version)).toBe("draft");
    // A release that did not stand sends nothing.
    expect(mockFireSdkWebhook).not.toHaveBeenCalled();

    const retry = await publish({ revisions });
    saveEdit.mockRestore();
    expect(retry.status).toBe(200);
    expect((await live(b.id)).webhooks.map((w) => w.name)).toEqual([
      "Added",
      "Keep",
      "Renamed",
    ]);
  });
});
