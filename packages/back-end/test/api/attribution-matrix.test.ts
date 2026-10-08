import mongoose from "mongoose";
import request from "supertest";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { ApiKeyWithRole } from "shared/types/apikey";
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
 * The person behind a request is a personal token's owner, or the member an
 * org key names with X-GrowthBook-Requested-By; a key that names no one is
 * credited under its own name. Checked across callers, revisioned entities,
 * their lifecycles and schedules, and through the real auth middleware.
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

type Person = typeof dana;
const ACTORS = [
  "a personal token",
  "a key naming the member",
  "a key naming no one",
] as const;
type Actor = (typeof ACTORS)[number];

// What each caller should be credited with, for Dana.
const EXPECT: Record<
  Actor,
  { personId: string; armer: string; hasPerson: boolean }
> = {
  "a personal token": { personId: dana.id, armer: dana.id, hasPerson: true },
  "a key naming the member": {
    personId: dana.id,
    armer: `${KEY.id}:${dana.id}`,
    hasPerson: true,
  },
  "a key naming no one": { personId: "", armer: KEY.id, hasPerson: false },
};

function contextFor(
  actor: Actor,
  person: Person = dana,
  key: ApiKeyWithRole = KEY,
) {
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
            requester: actor === "a key naming the member" ? person : null,
          }),
          // As the auth middleware computes it.
          userPermissions: getKeyPermissionsForRequest({
            apiKey: key,
            requesterId: actor === "a key naming the member" ? person.id : null,
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
      const { personId, hasPerson } = EXPECT[actor];
      const key = await createEntity(actor);
      const entity = await collection(cfg.collection).findOne({
        organization: ORG_ID,
      });
      expect(entity?.owner ?? "").toBe(personId);

      const { id, version } = await draft(actor, key);
      const path = `${revisions}/${key}/${version}`;
      expect((await stored(id))?.authorId).toBe(personId);

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

      // A key naming Bob approves as Bob, and can take it back as Bob.
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
      expect(comment?.userId).toBe(personId);
      const requested = approved?.activityLog.find(
        (a: { action: string }) => a.action === "review-requested",
      );
      expect(requested?.userId).toBe(personId);

      const approvedEvent = await collection("events").findOne({
        organizationId: ORG_ID,
        event: `${cfg.event}.revision.approved`,
      });
      expect(approvedEvent?.data?.data?.object?.reviewer?.id).toBe(bob.id);
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
      expect((await stored(id))?.resolution?.userId).toBe(personId);
      const publishedEvent = await collection("events").findOne({
        organizationId: ORG_ID,
        event: `${cfg.event}.revision.published`,
      });
      expect(publishedEvent?.data?.user?.requestedBy?.id).toBe(
        actor === "a key naming the member" ? dana.id : undefined,
      );
    });

    it.each(ACTORS)(
      "fires a publish %s scheduled as the same person",
      async (actor) => {
        const { personId, armer } = EXPECT[actor];
        const key = await createEntity(actor);
        const { id, version } = await draft(actor, key);

        const schedule = await as(actor).post(
          `${revisions}/${key}/${version}/schedule-publish`,
          {
            scheduledPublishAt: new Date(Date.now() + 3_600_000).toISOString(),
          },
        );
        expect(schedule.status).toBe(200);
        const armed = await stored(id);
        expect(armed?.autoPublishEnabledBy).toBe(armer);
        expect(
          armed?.activityLog.find(
            (a: { action: string }) => a.action === "scheduled-publish",
          )?.userId,
        ).toBe(personId);

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
        expect(fired?.resolution?.userId).toBe(personId);
      },
    );
  });

  describe("feature flag revisions", () => {
    const createFlag = async (actor: Actor) => {
      const res = await as(actor).post("/api/v2/features", {
        id: "checkout-flow",
        valueType: "boolean",
        defaultValue: "false",
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

    it.each(ACTORS)("credits %s through a reviewed draft", async (actor) => {
      const { personId, hasPerson } = EXPECT[actor];
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
      ).toBe(personId);
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
      expect(approvedEvent?.data?.data?.object?.reviewer?.id).toBe(bob.id);

      const log = await as(actor).get(`${path}/log`);
      const commentEntry = log.body.log.find(
        (l: { action: string }) => l.action === "Comment",
      );
      expect(
        commentEntry?.user?.requestedBy?.id ?? commentEntry?.user?.id ?? "",
      ).toBe(personId);

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

  describe("author rights through a key", () => {
    const READONLY_KEY = { ...KEY, id: "key_readonly", role: "readonly" };
    const OWN_ROLE_KEY = {
      ...READONLY_KEY,
      id: "key_own_role",
      requesterPermissions: "key" as const,
    };
    const NAMED = [
      ["naming the draft's author", dana, READONLY_KEY, 200],
      ["naming someone else", bob, READONLY_KEY, 403],
      ["that keeps its own role, naming the author", dana, OWN_ROLE_KEY, 403],
    ] as const;

    // Dana writes a draft, then loses draft permissions, so only her author
    // rights can let a read-only key discard it, and only when it names her.

    it.each(NAMED)(
      "lets a read-only key %s discard a constant draft",
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

        await withRole(dana, "readonly", async () => {
          const res = await as("a key naming the member", person, key).post(
            `/api/v1/constants-revisions/timeout/${version}/discard`,
          );
          expect(res.status).toBe(status);
        });
      },
    );

    it.each(NAMED)(
      "lets a read-only key %s discard a feature draft",
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

        await withRole(dana, "readonly", async () => {
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

  describe("through the auth middleware", () => {
    const MIDDLEWARE =
      "back-end/src/middleware/authenticateApiRequestMiddleware";
    const auth = () => jest.requireMock(MIDDLEWARE).default as jest.Mock;
    const realAuth = jest.requireActual(MIDDLEWARE).default;
    const KEYS = {
      optional: KEY,
      required: {
        ...KEY,
        id: "key_required",
        key: "secret_required",
        requesterHeader: "required",
      },
      rejected: {
        ...KEY,
        id: "key_rejected",
        key: "secret_rejected",
        requesterHeader: "rejected",
      },
      ownRole: {
        ...KEY,
        id: "key_own_role",
        key: "secret_own_role",
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
        [KEYS.required, KEYS.rejected, KEYS.ownRole, KEYS.token].map((k) => ({
          ...k,
        })),
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
      ["an optional key naming a member", 200, "optional", dana.email],
      ["an optional key naming no one", 200, "optional", null],
      [
        "a key naming someone outside the org",
        400,
        "optional",
        "nobody@example.com",
      ],
      ["a required key naming no one", 400, "required", null],
      ["a required key naming a member by id", 200, "required", dana.id],
      ["a rejected key naming a member", 400, "rejected", dana.email],
      ["a rejected key naming no one", 200, "rejected", null],
      ["a personal token naming a member", 400, "token", bob.email],
      [
        "a key naming a member who can't create projects",
        403,
        "optional",
        bob.email,
      ],
      [
        "a key keeping its own role, naming that member",
        200,
        "ownRole",
        bob.email,
      ],
    ] as const)("answers %s with %i", async (_, status, key, header) => {
      const res = await createProject(key, header);
      expect(res.status).toBe(status);
      if (status === 400) expect(res.body.message).toMatch(/Requested-By/);
    });

    it("records the named member and whether the request assumed their role", async () => {
      expect((await createProject("optional", dana.email, "Web")).status).toBe(
        200,
      );
      expect((await createProject("ownRole", bob.email, "App")).status).toBe(
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
      expect(owners.map((p) => p.owner).sort()).toEqual([bob.id, dana.id]);
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

    it("finds actions a key took for a member among their recent activity", async () => {
      await insertAudit({
        organization: ORG_ID,
        user: {
          apiKey: KEY.id,
          name: KEY.description,
          requestedBy: dana,
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
