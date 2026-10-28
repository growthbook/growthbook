import omit from "lodash/omit";
import mongoose from "mongoose";
import request from "supertest";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { ApiKeyWithRole } from "shared/types/apikey";
import { notificationEvents } from "shared/validators";
import type { ZodType } from "zod";
import { ReqContextClass } from "back-end/src/services/context";
import { apiKeyEventUser } from "back-end/src/util/api-key.util";
import { getKeyPermissionsForRequest } from "back-end/src/util/organization.util";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { getAdapter } from "back-end/src/revisions";
import { maybePublishScheduledRevision } from "back-end/src/revisions/revisionActions";
import { maybePublishScheduledRevision as maybePublishScheduledFeatureRevision } from "back-end/src/api/features/autoPublishOnApproval";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import {
  findRecentAuditByUserIdAndOrganization,
  insertAudit,
} from "back-end/src/models/AuditModel";
import { setupApp } from "./api.setup";

/**
 * The person behind a request is a personal token's owner, or the member a User
 * key names with X-GrowthBook-Requested-By; a key that names no one, or a
 * System key, is credited as itself. Checked across callers,
 * revisioned entities, their lifecycles and schedules, and through the real
 * auth middleware.
 */

const ORG_ID = "org_attribution";
const dana = { id: "u_dana", name: "Dana", email: "dana@example.com" };
const bob = { id: "u_bob", name: "Bob", email: "bob@example.com" };
const KEY = {
  id: "key_ci",
  organization: ORG_ID,
  key: "secret_ci",
  secret: true,
  description: "CI key",
  role: "admin",
  limitAccessByEnvironment: false,
  environments: [],
  // A User key, so naming a member acts as them.
  actAs: "user" as const,
  dateCreated: new Date(),
  dateUpdated: new Date(),
};

const org = {
  id: ORG_ID,
  name: "Attribution",
  ownerEmail: dana.email,
  url: "",
  dateCreated: new Date(),
  members: [dana, bob].map((m) => ({
    id: m.id,
    role: "admin",
    limitAccessByEnvironment: false,
    environments: [],
  })),
  settings: {
    environments: [
      { id: "dev", description: "" },
      { id: "production", description: "" },
    ],
    attributeSchema: [{ property: "userId", datatype: "string" }],
  },
} as unknown as OrganizationInterface;

// The documented payload schema for an event, to check what was actually sent.
const payloadSchema = (resource: string, event: string) =>
  (
    notificationEvents as unknown as Record<
      string,
      Record<string, { schema: ZodType }>
    >
  )[resource][event].schema;

type Person = typeof dana;
const ACTORS = [
  "a personal token",
  "a key naming the member",
  "a key naming the member as itself",
  "a key naming no one",
] as const;
type Actor = (typeof ACTORS)[number];

// What each caller should be credited with, for Dana: the person, the
// identity drafts and verdicts record (the key itself unless it assumes her
// role), the member a key records as having asked, and the actor webhooks
// report.
const EXPECT: Record<
  Actor,
  {
    personId: string;
    actorId: string;
    armer: string;
    hasPerson: boolean;
    requestedBy?: string;
    webhookActor: Record<string, unknown>;
  }
> = {
  "a personal token": {
    personId: dana.id,
    actorId: dana.id,
    armer: dana.id,
    hasPerson: true,
    webhookActor: { type: "api_key", apiKey: "key_pat", id: dana.id },
  },
  "a key naming the member": {
    personId: dana.id,
    actorId: dana.id,
    armer: `${KEY.id}:${dana.id}`,
    hasPerson: true,
    requestedBy: dana.id,
    webhookActor: {
      type: "api_key",
      apiKey: KEY.id,
      requestedBy: { id: dana.id },
      assumedRole: true,
    },
  },
  "a key naming the member as itself": {
    personId: "",
    actorId: KEY.id,
    armer: KEY.id,
    hasPerson: false,
    requestedBy: dana.id,
    webhookActor: {
      type: "api_key",
      apiKey: KEY.id,
      name: KEY.description,
      requestedBy: { id: dana.id },
    },
  },
  "a key naming no one": {
    personId: "",
    actorId: KEY.id,
    armer: KEY.id,
    hasPerson: false,
    webhookActor: { type: "api_key", apiKey: KEY.id, name: KEY.description },
  },
};

function contextFor(
  actor: Actor,
  person: Person = dana,
  baseKey: ApiKeyWithRole = KEY,
) {
  const key: ApiKeyWithRole =
    actor === "a key naming the member as itself"
      ? { ...baseKey, actAs: "system" }
      : baseKey;
  const requester = actor.startsWith("a key naming the member") ? person : null;
  const base = {
    org,
    teams: [],
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  };
  const context =
    actor === "a personal token"
      ? new ReqContextClass({
          ...base,
          role: "admin",
          user: { ...person, superAdmin: false },
          auditUser: { type: "api_key", apiKey: "key_pat", ...person },
        })
      : new ReqContextClass({
          ...base,
          role: key.role,
          apiKey: key.id,
          apiKeyData: key,
          auditUser: apiKeyEventUser({
            apiKeyId: key.id,
            key,
            owner: null,
            requester,
          }),
          // As the auth middleware computes it.
          userPermissions: getKeyPermissionsForRequest({
            apiKey: key,
            requesterId: requester?.id ?? null,
            org,
            teams: [],
            restrictedProjects: [],
          }),
        });
  context.hasPremiumFeature = () => true;
  return context;
}

const collection = (name: string) => mongoose.connection.collection(name);

describe("attribution across callers", () => {
  const { app, isReady, setReqContext } = setupApp();

  beforeEach(async () => {
    await isReady;
    // The shared teardown only empties collections Mongoose registered; some
    // models write through the driver, and leftovers would match lookups here.
    const all = await mongoose.connection.db!.collections();
    await Promise.all(all.map((c) => c.deleteMany({})));
    await collection("users").insertMany([{ ...dana }, { ...bob }]);
    await collection("apikeys").insertOne({ ...KEY });
  });

  // Org members are read from this object, so a test can demote one briefly.
  const withRole = async (
    person: Person,
    role: string,
    work: () => Promise<void>,
  ) => {
    const member = org.members.find((m) => m.id === person.id)!;
    member.role = role;
    try {
      await work();
    } finally {
      member.role = "admin";
    }
  };

  const as = (
    actor: Actor,
    person: Person = dana,
    key: ApiKeyWithRole = KEY,
  ) => {
    setReqContext(contextFor(actor, person, key));
    return {
      get: (path: string) =>
        request(app).get(path).set("Authorization", "Bearer x"),
      post: (path: string, body: object = {}) =>
        request(app).post(path).set("Authorization", "Bearer x").send(body),
      put: (path: string, body: object = {}) =>
        request(app).put(path).set("Authorization", "Bearer x").send(body),
    };
  };

  it.each(ACTORS)("gives %s the right acting person", (actor) => {
    const context = contextFor(actor);
    expect(context.actingUserId).toBe(EXPECT[actor].personId);
    expect(context.actingUserName).toBe(
      EXPECT[actor].hasPerson ? dana.name : "",
    );
  });

  const GENERIC = [
    {
      entity: "saved group",
      base: "saved-groups",
      collection: "savedgroups",
      event: "savedGroup",
      create: () => ({
        name: "Testers",
        values: ["u1"],
        attributeKey: "userId",
      }),
      keyOf: (body: { savedGroup: { id: string } }) => body.savedGroup.id,
      edit: ["values", { values: ["u2"] }] as const,
    },
    {
      entity: "constant",
      base: "constants",
      collection: "constants",
      event: "constant",
      create: () => ({
        key: "timeout",
        name: "Timeout",
        type: "json",
        value: '{"t":1}',
      }),
      keyOf: () => "timeout",
      edit: ["value", { value: '{"t":2}' }] as const,
    },
    {
      entity: "config",
      base: "configs",
      collection: "configs",
      event: "config",
      create: () => ({ key: "checkout", name: "Checkout", value: { t: 1 } }),
      keyOf: () => "checkout",
      edit: ["value", { value: { t: 2 } }] as const,
    },
  ];

  describe.each(GENERIC)("$entity revisions", (cfg) => {
    const revisions = `/api/v1/${cfg.base}-revisions`;

    const createEntity = async (actor: Actor) => {
      const res = await as(actor).post(`/api/v1/${cfg.base}`, cfg.create());
      expect(res.status).toBe(200);
      return cfg.keyOf(res.body);
    };
    const draft = async (actor: Actor, key: string) => {
      const [field, body] = cfg.edit;
      const res = await as(actor).put(`${revisions}/${key}/new/${field}`, body);
      expect(res.status).toBe(200);
      return res.body.revision as { id: string; version: number };
    };
    const stored = (id: string) => collection("revisions").findOne({ id });

    it.each(ACTORS)("credits %s through a reviewed publish", async (actor) => {
      const { personId, actorId, hasPerson } = EXPECT[actor];
      const key = await createEntity(actor);
      const entity = await collection(cfg.collection).findOne({
        organization: ORG_ID,
      });
      expect(entity?.owner ?? "").toBe(personId);

      const { id, version } = await draft(actor, key);
      const path = `${revisions}/${key}/${version}`;
      expect((await stored(id))?.authorId).toBe(actorId);
      if (!hasPerson) {
        // REST pairs the key's ID with its name.
        const listed = await as(actor).get(path);
        expect(listed.body.revision.author).toMatchObject({
          type: "api_key",
          apiKey: KEY.id,
          name: KEY.description,
        });
      }

      const mine = await as(actor).get(`${revisions}/${key}?mine=true`);
      if (hasPerson) {
        expect(mine.status).toBe(200);
        expect(
          mine.body.revisions.map((r: { version: number }) => r.version),
        ).toContain(version);
      } else {
        expect(mine.status).toBe(400);
      }

      expect(
        (
          await as(actor).post(`${path}/submit-review`, {
            decision: "comment",
            comment: "Looks reasonable",
          })
        ).status,
      ).toBe(200);
      expect((await as(actor).post(`${path}/request-review`)).status).toBe(200);

      // No one rules on a draft created in their own name, and a key needs a
      // person to rule at all.
      const selfApproval = await as(actor).post(`${path}/submit-review`, {
        decision: "approve",
        skipAutoPublish: true,
      });
      expect(selfApproval.status).toBe(400);

      // A key naming Bob approves as Bob.
      const approval = await as("a key naming the member", bob).post(
        `${path}/submit-review`,
        { decision: "approve", skipAutoPublish: true },
      );
      expect(approval.status).toBe(200);
      const approved = await stored(id);
      const verdict = approved?.reviews.find(
        (r: { decision: string }) => r.decision === "approve",
      );
      expect(verdict?.userId).toBe(bob.id);
      expect(verdict?.user?.requestedBy?.id).toBe(bob.id);
      const comment = approved?.reviews.find(
        (r: { decision: string }) => r.decision === "comment",
      );
      expect(comment?.userId).toBe(actorId);
      const requested = approved?.activityLog.find(
        (a: { action: string }) => a.action === "review-requested",
      );
      expect(requested?.userId).toBe(actorId);

      const approvedEvent = await collection("events").findOne({
        organizationId: ORG_ID,
        event: `${cfg.event}.revision.approved`,
      });
      // Who authored and reviewed it, its content and its review history,
      // matching the documented schema.
      const approvedObject = approvedEvent?.data?.data?.object;
      expect(approvedObject).toMatchObject({
        id,
        authorId: actorId,
        author: EXPECT[actor].webhookActor,
        [cfg.event]: { id: entity?.id, name: cfg.create().name },
        reviewer: { requestedBy: { id: bob.id }, assumedRole: true },
        proposedChanges: expect.arrayContaining([
          expect.objectContaining({ path: `/${cfg.edit[0]}` }),
        ]),
        reviews: expect.arrayContaining([
          expect.objectContaining({ userId: bob.id, decision: "approve" }),
        ]),
      });
      expect(approvedObject).not.toHaveProperty("activityLog");
      expect(
        payloadSchema(cfg.event, "revision.approved").safeParse(approvedObject)
          .error,
      ).toBeUndefined();
      expect(approvedEvent?.data?.user?.requestedBy?.id).toBe(bob.id);

      // Bob withdraws it with his own token; the history keeps the key as the
      // approval's source.
      expect(
        (await as("a personal token", bob).post(`${path}/undo-review`)).status,
      ).toBe(200);
      const undone = await stored(id);
      expect(
        undone?.reviews.some(
          (r: { userId: string; decision: string; stale?: boolean }) =>
            r.userId === bob.id && r.decision === "approve" && !r.stale,
        ),
      ).toBe(false);
      const retraction = undone?.activityLog.find(
        (a: { action: string }) => a.action === "review-retracted",
      );
      expect(retraction?.user?.apiKey).toBe("key_pat");
      expect(
        JSON.parse(retraction?.description ?? "{}").user?.requestedBy?.id,
      ).toBe(bob.id);

      expect((await as(actor).post(`${path}/publish`)).status).toBe(200);
      expect((await stored(id))?.resolution?.userId).toBe(actorId);
      const publishedEvent = await collection("events").findOne({
        organizationId: ORG_ID,
        event: `${cfg.event}.revision.published`,
      });
      expect(publishedEvent?.data?.user?.requestedBy?.id).toBe(
        EXPECT[actor].requestedBy,
      );
    });

    // Scheduling is shared across these types, so one of them covers it.
    if (cfg === GENERIC[0]) {
      it.each(ACTORS)(
        "fires a publish %s scheduled as the same person",
        async (actor) => {
          const { actorId, armer } = EXPECT[actor];
          const key = await createEntity(actor);
          const { id, version } = await draft(actor, key);

          const schedule = await as(actor).post(
            `${revisions}/${key}/${version}/schedule-publish`,
            {
              scheduledPublishAt: new Date(
                Date.now() + 3_600_000,
              ).toISOString(),
            },
          );
          expect(schedule.status).toBe(200);
          const armed = await stored(id);
          expect(armed?.autoPublishEnabledBy).toBe(armer);
          expect(
            armed?.activityLog.find(
              (a: { action: string }) => a.action === "scheduled-publish",
            )?.userId,
          ).toBe(actorId);

          await collection("revisions").updateOne(
            { id },
            { $set: { scheduledPublishAt: new Date(Date.now() - 1000) } },
          );
          const job = getContextForAgendaJobByOrgObject(org);
          const revision = await job.models.revisions.getById(id);
          const target = await getAdapter(revision!.target.type)
            .getModel(job)!
            .getById(revision!.target.id);
          await maybePublishScheduledRevision(
            job,
            revision!,
            target as Record<string, unknown>,
          );

          const fired = await stored(id);
          expect(fired?.status).toBe("merged");
          expect(fired?.resolution?.userId).toBe(actorId);
        },
      );
    }
  });

  describe("feature flag revisions", () => {
    const createFlag = async (actor: Actor) => {
      const res = await as(actor).post("/api/v2/features", {
        id: "checkout-flow",
        valueType: "boolean",
        defaultValue: "false",
        rules: [{ type: "force", value: "true", allEnvironments: true }],
        ...(EXPECT[actor].hasPerson ? {} : { owner: dana.id }),
      });
      expect(res.status).toBe(200);
      return "checkout-flow";
    };
    const draft = async (actor: Actor, id: string) => {
      const res = await as(actor).put(
        `/api/v2/features/${id}/revisions/new/metadata`,
        { description: "Updated" },
      );
      expect(res.status).toBe(200);
      return res.body.revision.version as number;
    };
    const stored = (featureId: string, version: number) =>
      collection("featurerevisions").findOne({
        organization: ORG_ID,
        featureId,
        version,
      });

    it("requires an owner from a key that names no one", async () => {
      const res = await as("a key naming no one").post("/api/v2/features", {
        id: "no-owner",
        valueType: "boolean",
        defaultValue: "false",
      });
      expect(res.status).toBe(400);
    });

    it("finds a draft a key made as itself by the key's ID", async () => {
      const id = await createFlag("a key naming no one");
      const version = await draft("a key naming no one", id);
      const res = await as("a personal token").get(
        `/api/v2/features/${id}/revisions?author=${KEY.id}`,
      );
      expect(res.status).toBe(200);
      expect(
        res.body.revisions.map((r: { version: number }) => r.version),
      ).toContain(version);
    });

    it.each(ACTORS)("credits %s through a reviewed draft", async (actor) => {
      const { personId, actorId, hasPerson, requestedBy } = EXPECT[actor];
      const id = await createFlag(actor);
      const flag = await collection("features").findOne({ id });
      expect(flag?.owner).toBe(dana.id);
      const watch = await collection("watches").findOne({ userId: dana.id });
      expect(!!watch?.features?.includes(id)).toBe(hasPerson);

      const version = await draft(actor, id);
      const path = `/api/v2/features/${id}/revisions/${version}`;
      const created = await stored(id, version);
      expect(
        created?.createdBy?.requestedBy?.id ?? created?.createdBy?.id ?? "",
      ).toBe(requestedBy ?? personId);
      expect((created?.contributors ?? []).includes(dana.id)).toBe(hasPerson);

      const mine = await as(actor).get(
        `/api/v2/features/${id}/revisions?mine=true`,
      );
      if (hasPerson) {
        expect(mine.status).toBe(200);
        expect(
          mine.body.revisions.map((r: { version: number }) => r.version),
        ).toContain(version);
      } else {
        expect(mine.status).toBe(400);
      }

      expect(
        (
          await as(actor).post(`${path}/submit-review`, {
            action: "comment",
            comment: "Looks reasonable",
          })
        ).status,
      ).toBe(200);
      expect((await as(actor).post(`${path}/request-review`)).status).toBe(200);

      const selfApproval = await as(actor).post(`${path}/submit-review`, {
        action: "approve",
        skipAutoPublish: true,
      });
      expect(selfApproval.status).toBe(400);

      const approval = await as("a key naming the member", bob).post(
        `${path}/submit-review`,
        { action: "approve", skipAutoPublish: true },
      );
      expect(approval.status).toBe(200);
      const approved = await stored(id, version);
      expect(
        approved?.reviews?.find(
          (r: { status: string }) => r.status === "approved",
        )?.userId,
      ).toBe(bob.id);
      const approvedEvent = await collection("events").findOne({
        organizationId: ORG_ID,
        event: "feature.revision.approved",
      });
      const approvedObject = approvedEvent?.data?.data?.object;
      expect(approvedObject).toMatchObject({
        version,
        authorId: actorId,
        author: EXPECT[actor].webhookActor,
        feature: { id },
        reviewer: { requestedBy: { id: bob.id }, assumedRole: true },
        defaultValue: "false",
        metadata: expect.objectContaining({ description: "Updated" }),
        rules: {
          production: [
            expect.objectContaining({ type: "force", value: "true" }),
          ],
        },
      });
      expect(
        payloadSchema("feature", "revision.approved").safeParse(approvedObject)
          .error,
      ).toBeUndefined();

      const log = await as(actor).get(`${path}/log`);
      const commentEntry = log.body.log.find(
        (l: { action: string }) => l.action === "Comment",
      );
      expect(
        commentEntry?.user?.requestedBy?.id ?? commentEntry?.user?.id ?? "",
      ).toBe(requestedBy ?? personId);

      expect(
        (await as("a key naming the member", bob).post(`${path}/undo-review`))
          .status,
      ).toBe(200);
      expect(
        (await stored(id, version))?.reviews?.some(
          (r: { userId: string; status: string }) =>
            r.userId === bob.id && r.status === "approved",
        ),
      ).toBe(false);
    });

    it.each(ACTORS)(
      "fires a publish %s scheduled as the same person",
      async (actor) => {
        const { armer, personId } = EXPECT[actor];
        const id = await createFlag(actor);
        const version = await draft(actor, id);

        const schedule = await as(actor).post(
          `/api/v2/features/${id}/revisions/${version}/schedule-publish`,
          {
            scheduledPublishAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
        );
        expect(schedule.status).toBe(200);
        expect((await stored(id, version))?.autoPublishEnabledBy).toBe(armer);

        await collection("featurerevisions").updateOne(
          { organization: ORG_ID, featureId: id, version },
          { $set: { scheduledPublishAt: new Date(Date.now() - 1000) } },
        );
        const job = getContextForAgendaJobByOrgObject(org);
        const feature = await getFeature(job, id);
        const revision = await getRevision({
          context: job,
          organization: ORG_ID,
          featureId: id,
          feature: feature!,
          version,
        });
        await maybePublishScheduledFeatureRevision(job, feature!, revision!);

        const fired = await stored(id, version);
        expect(fired?.status).toBe("published");
        expect(
          fired?.publishedBy?.requestedBy?.id ?? fired?.publishedBy?.id ?? "",
        ).toBe(personId);
      },
    );
  });

  describe("a member who loses permissions", () => {
    const draftConstant = async () => {
      await as("a personal token").post("/api/v1/constants", {
        key: "timeout",
        name: "Timeout",
        type: "json",
        value: '{"t":1}',
      });
      const draft = await as("a personal token").put(
        "/api/v1/constants-revisions/timeout/new/value",
        { value: '{"t":2}' },
      );
      expect(draft.status).toBe(200);
      return draft.body.revision as { id: string; version: number };
    };

    const draftFlag = async () => {
      await as("a personal token").post("/api/v2/features", {
        id: "checkout-flow",
        valueType: "boolean",
        defaultValue: "false",
      });
      const draft = await as("a personal token").put(
        "/api/v2/features/checkout-flow/revisions/new/metadata",
        { description: "Updated" },
      );
      expect(draft.status).toBe(200);
      return draft.body.revision.version as number;
    };

    it("can't approve a constant through a key that names them, but can withdraw", async () => {
      const { version } = await draftConstant();
      const path = `/api/v1/constants-revisions/timeout/${version}`;
      expect(
        (await as("a personal token").post(`${path}/request-review`)).status,
      ).toBe(200);
      const approve = () =>
        as("a key naming the member", bob).post(`${path}/submit-review`, {
          decision: "approve",
          skipAutoPublish: true,
        });
      await withRole(bob, "readonly", async () => {
        expect((await approve()).status).toBe(403);
      });
      expect((await approve()).status).toBe(200);
      await withRole(bob, "readonly", async () => {
        expect(
          (await as("a key naming the member", bob).post(`${path}/undo-review`))
            .status,
        ).toBe(200);
      });
    });

    it("stops a constant publish a key scheduled for them", async () => {
      const { id, version } = await draftConstant();
      const schedule = await as("a key naming the member", bob).post(
        `/api/v1/constants-revisions/timeout/${version}/schedule-publish`,
        { scheduledPublishAt: new Date(Date.now() + 3_600_000).toISOString() },
      );
      expect(schedule.status).toBe(200);
      await collection("revisions").updateOne(
        { id },
        { $set: { scheduledPublishAt: new Date(Date.now() - 1000) } },
      );

      await withRole(bob, "readonly", async () => {
        const job = getContextForAgendaJobByOrgObject(org);
        const revision = await job.models.revisions.getById(id);
        const target = await getAdapter(revision!.target.type)
          .getModel(job)!
          .getById(revision!.target.id);
        await maybePublishScheduledRevision(
          job,
          revision!,
          target as Record<string, unknown>,
        );
      });
      expect((await collection("revisions").findOne({ id }))?.status).not.toBe(
        "merged",
      );
    });

    it.each([["stops acting as members", { actAs: "system" }]])(
      "drops a constant publish a key armed for them once the key %s",
      async (_, change) => {
        const { id, version } = await draftConstant();
        const schedule = await as("a key naming the member", bob).post(
          `/api/v1/constants-revisions/timeout/${version}/schedule-publish`,
          {
            scheduledPublishAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
        );
        expect(schedule.status).toBe(200);
        await collection("apikeys").updateOne({ id: KEY.id }, { $set: change });
        await collection("revisions").updateOne(
          { id },
          { $set: { scheduledPublishAt: new Date(Date.now() - 1000) } },
        );

        const job = getContextForAgendaJobByOrgObject(org);
        const revision = await job.models.revisions.getById(id);
        const target = await getAdapter(revision!.target.type)
          .getModel(job)!
          .getById(revision!.target.id);
        await maybePublishScheduledRevision(
          job,
          revision!,
          target as Record<string, unknown>,
        );
        expect(
          (await collection("revisions").findOne({ id }))?.status,
        ).not.toBe("merged");
      },
    );

    it("can't approve a flag through a key that names them", async () => {
      const path = `/api/v2/features/checkout-flow/revisions/${await draftFlag()}`;
      expect(
        (await as("a personal token").post(`${path}/request-review`)).status,
      ).toBe(200);
      const approve = () =>
        as("a key naming the member", bob).post(`${path}/submit-review`, {
          action: "approve",
          skipAutoPublish: true,
        });
      await withRole(bob, "readonly", async () => {
        expect((await approve()).status).toBe(403);
      });
      expect((await approve()).status).toBe(200);
    });

    it("stops a flag publish a key scheduled for them", async () => {
      const version = await draftFlag();
      const schedule = await as("a key naming the member", bob).post(
        `/api/v2/features/checkout-flow/revisions/${version}/schedule-publish`,
        { scheduledPublishAt: new Date(Date.now() + 3_600_000).toISOString() },
      );
      expect(schedule.status).toBe(200);
      const stored = {
        organization: ORG_ID,
        featureId: "checkout-flow",
        version,
      };
      await collection("featurerevisions").updateOne(stored, {
        $set: { scheduledPublishAt: new Date(Date.now() - 1000) },
      });

      await withRole(bob, "readonly", async () => {
        const job = getContextForAgendaJobByOrgObject(org);
        const feature = await getFeature(job, "checkout-flow");
        const revision = await getRevision({
          context: job,
          organization: ORG_ID,
          featureId: "checkout-flow",
          feature: feature!,
          version,
        });
        await maybePublishScheduledFeatureRevision(job, feature!, revision!);
      });
      expect(
        (await collection("featurerevisions").findOne(stored))?.status,
      ).not.toBe("published");
    });
  });

  describe("a key reviewing as itself", () => {
    const READONLY_KEY = { ...KEY, id: "key_readonly", role: "readonly" };
    const OTHER_KEY = { ...KEY, id: "key_other", key: "secret_other" };
    const draftSavedGroup = async (author: Actor = "a personal token") => {
      const created = await as(author).post("/api/v1/saved-groups", {
        name: "Testers",
        values: ["u1"],
        attributeKey: "userId",
      });
      expect(created.status).toBe(200);
      const id = created.body.savedGroup.id;
      const draft = await as(author).put(
        `/api/v1/saved-groups-revisions/${id}/new/values`,
        { values: ["u2"] },
      );
      expect(draft.status).toBe(200);
      const path = `/api/v1/saved-groups-revisions/${id}/${draft.body.revision.version}`;
      expect((await as(author).post(`${path}/request-review`)).status).toBe(
        200,
      );
      return { path, revisionId: draft.body.revision.id as string };
    };
    const withRequiredApproval = async (work: () => Promise<void>) => {
      const settings = org.settings as Record<string, unknown>;
      settings.approvalFlows = { savedGroups: [{ required: true }] };
      try {
        await work();
      } finally {
        delete settings.approvalFlows;
      }
    };

    it("approves with its own role, and the approval counts", async () => {
      await withRequiredApproval(async () => {
        const { path, revisionId } = await draftSavedGroup();
        const approve = (key: ApiKeyWithRole) =>
          as("a key naming no one", dana, key).post(`${path}/submit-review`, {
            decision: "approve",
            skipAutoPublish: true,
          });
        expect((await approve(READONLY_KEY)).status).toBe(403);
        expect((await approve(KEY)).status).toBe(200);
        const verdict = (
          await collection("revisions").findOne({ id: revisionId })
        )?.reviews.find((r: { decision: string }) => r.decision === "approve");
        expect(verdict?.userId).toBe(KEY.id);
        // An engineer can't bypass approval, so only the key's counts here.
        await withRole(bob, "engineer", async () => {
          expect(
            (await as("a personal token", bob).post(`${path}/publish`)).status,
          ).toBe(200);
        });
      });
    });

    it.each(["approve", "request-changes"] as const)(
      "can't %s a draft it made while assuming a member",
      async (decision) => {
        const { path } = await draftSavedGroup("a key naming the member");
        const rule = (key: ApiKeyWithRole) =>
          as("a key naming no one", dana, key).post(`${path}/submit-review`, {
            decision,
            skipAutoPublish: true,
          });
        expect((await rule(KEY)).status).toBe(400);
        expect((await rule(OTHER_KEY)).status).toBe(200);
      },
    );

    it("can't rule on a draft with no recorded author, which any key may have made", async () => {
      const { path, revisionId } = await draftSavedGroup();
      // As main stored a key's draft: no author and no actors on its entries.
      const stored = await collection("revisions").findOne({ id: revisionId });
      await collection("revisions").updateOne(
        { id: revisionId },
        {
          $set: {
            authorId: "",
            activityLog: (stored?.activityLog ?? []).map(
              (e: Record<string, unknown>) => ({
                ...Object.fromEntries(
                  Object.entries(e).filter(([field]) => field !== "user"),
                ),
                userId: "",
              }),
            ),
          },
        },
      );
      const approve = (actor: Actor, person: Person = dana) =>
        as(actor, person).post(`${path}/submit-review`, {
          decision: "approve",
          skipAutoPublish: true,
        });
      expect((await approve("a key naming no one")).status).toBe(400);
      expect((await approve("a personal token", bob)).status).toBe(200);
    });

    it("can't rule on a flag draft it made while assuming a member", async () => {
      const assuming = as("a key naming the member");
      await assuming.post("/api/v2/features", {
        id: "checkout-flow",
        valueType: "boolean",
        defaultValue: "false",
      });
      const draft = await assuming.put(
        "/api/v2/features/checkout-flow/revisions/new/metadata",
        { description: "Updated" },
      );
      const version = draft.body.revision.version;
      const path = `/api/v2/features/checkout-flow/revisions/${version}`;
      // Written with the edit, so the verdict write can recheck it.
      expect(
        (
          await collection("featurerevisions").findOne({
            organization: ORG_ID,
            featureId: "checkout-flow",
            version,
          })
        )?.editorKeys,
      ).toEqual([KEY.id]);
      expect(
        (await as("a key naming the member").post(`${path}/request-review`))
          .status,
      ).toBe(200);
      const approve = (key: ApiKeyWithRole) =>
        as("a key naming no one", dana, key).post(`${path}/submit-review`, {
          action: "approve",
          skipAutoPublish: true,
        });
      expect((await approve(KEY)).status).toBe(400);
      expect((await approve(OTHER_KEY)).status).toBe(200);
    });

    it("stops counting an approval given while assuming a member once the key is disabled", async () => {
      await withRequiredApproval(async () => {
        const { path } = await draftSavedGroup();
        expect(
          (
            await as("a key naming the member", bob).post(
              `${path}/submit-review`,
              { decision: "approve", skipAutoPublish: true },
            )
          ).status,
        ).toBe(200);
        // An engineer can't bypass approval, so only Bob's approval counts.
        const publish = async () => {
          let status = 0;
          await withRole(dana, "engineer", async () => {
            status = (await as("a personal token").post(`${path}/publish`))
              .status;
          });
          return status;
        };
        const setDisabled = (disabled: boolean) =>
          collection("apikeys").updateOne(
            { id: KEY.id },
            { $set: { disabled } },
          );
        await setDisabled(true);
        expect(await publish()).not.toBe(200);
        await setDisabled(false);
        expect(await publish()).toBe(200);
      });
    });

    it("can still rule on a flag draft it only asked to be reviewed", async () => {
      await as("a personal token").post("/api/v2/features", {
        id: "checkout-flow",
        valueType: "boolean",
        defaultValue: "false",
      });
      const draft = await as("a personal token").put(
        "/api/v2/features/checkout-flow/revisions/new/metadata",
        { description: "Updated" },
      );
      const path = `/api/v2/features/checkout-flow/revisions/${draft.body.revision.version}`;
      const key = as("a key naming no one");
      expect((await key.post(`${path}/request-review`)).status).toBe(200);
      expect(
        (
          await key.post(`${path}/submit-review`, {
            action: "approve",
            skipAutoPublish: true,
          })
        ).status,
      ).toBe(200);
    });

    it("records a key that names a member as itself as the reviewer", async () => {
      const { path, revisionId } = await draftSavedGroup();
      const res = await as("a key naming the member as itself", bob).post(
        `${path}/submit-review`,
        {
          decision: "approve",
          skipAutoPublish: true,
        },
      );
      expect(res.status).toBe(200);
      const verdict = (
        await collection("revisions").findOne({ id: revisionId })
      )?.reviews.find((r: { decision: string }) => r.decision === "approve");
      expect(verdict?.userId).toBe(KEY.id);
      expect(verdict?.user?.requestedBy?.id).toBe(bob.id);
    });
  });

  describe("author rights through a key", () => {
    const READONLY_KEY = { ...KEY, id: "key_readonly", role: "readonly" };
    const OWN_ROLE_KEY = {
      ...READONLY_KEY,
      id: "key_own_role",
      actAs: "system" as const,
    };
    const NAMED = [
      ["an admin key naming the draft's author", dana, KEY, 200],
      ["a read-only key naming the draft's author", dana, READONLY_KEY, 403],
      ["an admin key naming someone else", bob, KEY, 403],
      ["a read-only key naming the author as itself", dana, OWN_ROLE_KEY, 403],
    ] as const;

    // Dana writes a draft, then the named member loses draft permissions, so
    // only the author's rights can let the request through: when the key names
    // the author and its own role could discard the draft.

    it.each(NAMED)(
      "lets %s discard a constant draft",
      async (_, person, key, status) => {
        const create = await as("a personal token").post("/api/v1/constants", {
          key: "timeout",
          name: "Timeout",
          type: "json",
          value: '{"t":1}',
        });
        expect(create.status).toBe(200);
        const draft = await as("a personal token").put(
          "/api/v1/constants-revisions/timeout/new/value",
          { value: '{"t":2}' },
        );
        const version = draft.body.revision.version;

        await withRole(person, "readonly", async () => {
          const res = await as("a key naming the member", person, key).post(
            `/api/v1/constants-revisions/timeout/${version}/discard`,
          );
          expect(res.status).toBe(status);
        });
      },
    );

    it.each(NAMED)(
      "lets %s discard a feature draft",
      async (_, person, key, status) => {
        const create = await as("a personal token").post("/api/v2/features", {
          id: "checkout-flow",
          valueType: "boolean",
          defaultValue: "false",
        });
        expect(create.status).toBe(200);
        const draft = await as("a personal token").put(
          "/api/v2/features/checkout-flow/revisions/new/metadata",
          { description: "Updated" },
        );
        const version = draft.body.revision.version;

        await withRole(person, "readonly", async () => {
          const res = await as("a key naming the member", person, key).post(
            `/api/v2/features/checkout-flow/revisions/${version}/discard`,
          );
          expect(res.status).toBe(status);
        });
        if (status !== 200) return;
        // The timeline records it too, though written after the response.
        const logged = () =>
          collection("featurerevisionlog").findOne({
            featureId: "checkout-flow",
            version,
            action: "discard",
          });
        for (let i = 0; i < 20 && !(await logged()); i++) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(await logged()).toBeTruthy();
      },
    );
  });

  describe("author rights through a personal token", () => {
    // Dana loses draft permissions, so only her author rights could let her
    // own token discard her draft, and a token scoped to read only gets none.
    it.each([
      ["an unscoped token", false, 200],
      ["a token scoped to read only", true, 403],
    ] as const)(
      "lets the author discard their constant draft with %s",
      async (_, scoped, status) => {
        await as("a personal token").post("/api/v1/constants", {
          key: "timeout",
          name: "Timeout",
          type: "json",
          value: '{"t":1}',
        });
        const draft = await as("a personal token").put(
          "/api/v1/constants-revisions/timeout/new/value",
          { value: '{"t":2}' },
        );
        const token = {
          ...KEY,
          id: "key_dana",
          userId: dana.id,
          actAs: undefined,
          scoped,
          role: scoped ? "readonly" : "user",
        };
        await withRole(dana, "readonly", async () => {
          const context = new ReqContextClass({
            org,
            teams: [],
            req: { query: {}, headers: {}, body: {} } as unknown as Request,
            role: "admin",
            user: { ...dana, superAdmin: false },
            apiKey: token.id,
            apiKeyData: token,
            auditUser: { type: "api_key", apiKey: token.id, ...dana },
          });
          context.hasPremiumFeature = () => true;
          setReqContext(context);
          const res = await request(app)
            .post(
              `/api/v1/constants-revisions/timeout/${draft.body.revision.version}/discard`,
            )
            .set("Authorization", "Bearer x");
          expect(res.status).toBe(status);
        });
      },
    );
  });

  describe("through the auth middleware", () => {
    const MIDDLEWARE =
      "back-end/src/middleware/authenticateApiRequestMiddleware";
    const auth = () => jest.requireMock(MIDDLEWARE).default as jest.Mock;
    const realAuth = jest.requireActual(MIDDLEWARE).default;
    const KEYS = {
      system: {
        ...KEY,
        id: "key_system",
        key: "secret_system",
        actAs: "system",
      },
      user: KEY,
      // Saved with settings that have since been retired.
      rejected: {
        ...omit(KEY, "actAs"),
        id: "key_rejected",
        key: "secret_rejected",
        requesterHeader: "rejected",
      },
      requiredOwnRole: {
        ...omit(KEY, "actAs"),
        id: "key_required_own_role",
        key: "secret_required_own_role",
        requesterHeader: "required",
        requesterPermissions: "key",
      },
      token: { ...KEY, id: "key_pat", key: "secret_pat", userId: dana.id },
    };
    let mocked: ((...args: unknown[]) => unknown) | undefined;

    beforeEach(async () => {
      mocked = auth().getMockImplementation();
      auth().mockImplementation(realAuth);
      await collection("organizations").insertOne({
        ...org,
        members: org.members.map((m) =>
          m.id === bob.id ? { ...m, role: "readonly" } : m,
        ),
      });
      await collection("apikeys").insertMany(
        [KEYS.system, KEYS.rejected, KEYS.requiredOwnRole, KEYS.token].map(
          (k) => ({
            ...k,
          }),
        ),
      );
    });
    afterEach(() => {
      auth().mockImplementation(mocked);
    });

    const createProject = (
      key: keyof typeof KEYS,
      requestedBy: string | null,
      name = "Web",
    ) => {
      const req = request(app)
        .post("/api/v1/projects")
        .set("Authorization", `Bearer ${KEYS[key].key}`);
      return (
        requestedBy ? req.set("X-GrowthBook-Requested-By", requestedBy) : req
      ).send({ name });
    };

    it.each([
      ["a System key naming no one", 200, "system", null],
      [
        "a key naming someone outside the org",
        400,
        "system",
        "nobody@example.com",
      ],
      ["a User key naming no one", 400, "user", null],
      ["a User key naming a member by id", 200, "user", dana.id],
      [
        "a key saved as rejecting the header naming a member",
        200,
        "rejected",
        dana.email,
      ],
      [
        "a key saved as rejecting the header naming no one",
        200,
        "rejected",
        null,
      ],
      [
        "a key saved as required with its own role naming a member who can't create projects",
        403,
        "requiredOwnRole",
        bob.email,
      ],
      [
        "a key saved as required with its own role naming no one",
        400,
        "requiredOwnRole",
        null,
      ],
      ["a personal token naming a member", 400, "token", bob.email],
      [
        "a System key naming a member who can't create projects",
        200,
        "system",
        bob.email,
      ],
      [
        "a User key naming a member who can't create projects",
        403,
        "user",
        bob.email,
      ],
    ] as const)("answers %s with %i", async (_, status, key, header) => {
      const res = await createProject(key, header);
      expect(res.status).toBe(status);
      if (status === 400) expect(res.body.message).toMatch(/Requested-By/);
    });

    it("records the named member, who owns what the key creates only for a User key", async () => {
      expect((await createProject("user", dana.email, "Web")).status).toBe(200);
      expect((await createProject("system", bob.email, "App")).status).toBe(
        200,
      );
      const audits = await collection("audits")
        .find({ organization: ORG_ID, event: "project.create" })
        .toArray();
      expect(
        audits.map((a) => [
          a.user?.requestedBy?.id,
          a.user?.assumedRole ?? false,
        ]),
      ).toEqual(
        expect.arrayContaining([
          [dana.id, true],
          [bob.id, false],
        ]),
      );
      const owners = await collection("projects")
        .find({ organization: ORG_ID })
        .toArray();
      expect(owners.map((p) => p.owner ?? "").sort()).toEqual(["", dana.id]);
    });
  });

  describe("flag comments", () => {
    it("lets a key assuming a member edit a comment its review access let it post", async () => {
      const settings = org as unknown as { customRoles?: unknown[] };
      settings.customRoles = [
        {
          id: "flag_reviewer",
          description: "",
          policies: ["ReadData", "FlagsReview"],
        },
      ];
      try {
        await as("a personal token").post("/api/v2/features", {
          id: "checkout-flow",
          valueType: "boolean",
          defaultValue: "false",
        });
        const draft = await as("a personal token").put(
          "/api/v2/features/checkout-flow/revisions/new/metadata",
          { description: "Updated" },
        );
        const path = `/api/v2/features/checkout-flow/revisions/${draft.body.revision.version}`;
        const reviewer = as("a key naming the member", bob, {
          ...KEY,
          id: "key_reviewer",
          key: "secret_reviewer",
          role: "flag_reviewer",
        });
        expect(
          (
            await reviewer.post(`${path}/submit-review`, {
              action: "comment",
              comment: "Looks off",
            })
          ).status,
        ).toBe(200);
        // The comment is logged after the response, like discard above.
        const logged = () =>
          collection("featurerevisionlog").findOne({
            organization: ORG_ID,
            featureId: "checkout-flow",
            action: "Comment",
          });
        for (let i = 0; i < 20 && !(await logged()); i++) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const entry = await logged();
        expect(entry).toBeTruthy();
        expect(
          (await reviewer.put(`${path}/log/${entry?.id}`, { comment: "Fine" }))
            .status,
        ).toBe(200);
      } finally {
        delete settings.customRoles;
      }
    });
  });

  describe("revision webhooks", () => {
    it("carry a draft's base version, before, after and patch", async () => {
      const created = await as("a personal token").post(
        "/api/v1/saved-groups",
        {
          name: "Testers",
          values: ["u1"],
          attributeKey: "userId",
        },
      );
      const revisions = `/api/v1/saved-groups-revisions/${created.body.savedGroup.id}`;
      const draft = async (values: string[]) =>
        (
          await as("a personal token").put(`${revisions}/new/values`, {
            values,
          })
        ).body.revision.version as number;
      const first = await draft(["u2"]);
      expect(
        (await as("a personal token").post(`${revisions}/${first}/publish`))
          .status,
      ).toBe(200);
      const second = await draft(["u3"]);

      const event = await collection("events").findOne({
        organizationId: ORG_ID,
        event: "savedGroup.revision.created",
        "data.data.object.version": second,
      });
      expect(event?.data?.data?.object).toMatchObject({
        version: second,
        baseVersion: first,
        baseSavedGroup: { values: ["u2"] },
        proposedSavedGroup: { values: ["u3"] },
        proposedChanges: [{ op: "replace", path: "/values", value: ["u3"] }],
      });
    });
  });

  describe("owners and other records", () => {
    it.each(ACTORS)("defaults a new project's owner for %s", async (actor) => {
      const res = await as(actor).post("/api/v1/projects", { name: "Web" });
      expect(res.status).toBe(200);
      const project = await collection("projects").findOne({
        organization: ORG_ID,
      });
      expect(project?.owner ?? "").toBe(EXPECT[actor].personId);
    });

    it.each(ACTORS)("owns a v1 dashboard as %s", async (actor) => {
      const res = await as(actor).post("/api/v1/dashboards", {
        title: "Weekly",
        editLevel: "private",
        shareLevel: "private",
        enableAutoUpdates: false,
        blocks: [],
      });
      expect(res.status).toBe(200);
      const dashboard = await collection("dashboards").findOne({
        organization: ORG_ID,
      });
      expect(dashboard?.userId ?? "").toBe(EXPECT[actor].personId);
    });

    it.each(ACTORS)(
      "keeps an auto run %s starts editable by the same caller",
      async (actor) => {
        const created = await as(actor).post("/api/v1/auto-runs", {});
        expect(created.status).toBe(200);
        const run = await collection("autoruns").findOne({
          organization: ORG_ID,
        });
        expect(run?.createdBy ?? null).toBe(
          actor === "a personal token" ? dana.id : null,
        );
        const appended = await as(actor).post(
          `/api/v1/auto-runs/${run?.id}/artifacts`,
          {
            kind: "feature",
            id: "checkout-flow",
            label: "Checkout flow",
            by: "developer",
            detail: null,
          },
        );
        expect(appended.status).toBe(200);
      },
    );

    it("credits a publish to the request that made it, not an earlier one by the same person", async () => {
      await as("a personal token").post("/api/v1/constants", {
        key: "timeout",
        name: "Timeout",
        type: "json",
        value: '{"t":1}',
      });
      const draft = await as("a personal token").put(
        "/api/v1/constants-revisions/timeout/new/value",
        { value: '{"t":2}' },
      );
      const path = `/api/v1/constants-revisions/timeout/${draft.body.revision.version}`;
      expect(
        (await as("a key naming the member").post(`${path}/publish`)).status,
      ).toBe(200);
      const res = await as("a personal token").get(path);
      expect(res.body.revision.resolution.user).toMatchObject({
        apiKey: KEY.id,
        requestedBy: { id: dana.id },
        assumedRole: true,
      });
    });

    it("records a key acting as itself as the publisher of a bulk publish", async () => {
      const key = as("a key naming no one");
      await key.post("/api/v1/constants", {
        key: "timeout",
        name: "Timeout",
        type: "json",
        value: '{"t":1}',
      });
      const draft = await key.put(
        "/api/v1/constants-revisions/timeout/new/value",
        {
          value: '{"t":2}',
        },
      );
      const res = await key.post("/api/v1/releases/publish-revisions", {
        revisions: [
          {
            entityType: "constant",
            key: "timeout",
            version: draft.body.revision.version,
          },
        ],
      });
      expect(res.status).toBe(200);
      expect(
        (await collection("revisions").findOne({ id: draft.body.revision.id }))
          ?.resolution?.userId,
      ).toBe(KEY.id);
    });

    it("finds actions a key took for a member among their recent activity", async () => {
      await insertAudit({
        organization: ORG_ID,
        user: {
          apiKey: KEY.id,
          name: KEY.description,
          requestedBy: dana,
          assumedRole: true,
        },
        event: "feature.create",
        entity: { object: "feature", id: "checkout-flow" },
        dateCreated: new Date(),
      });
      const recent = await findRecentAuditByUserIdAndOrganization(
        dana.id,
        ORG_ID,
      );
      expect(recent.map((a) => a.entity.id)).toContain("checkout-flow");
    });
  });
});
