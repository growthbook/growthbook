import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "./api.setup";

// Commit-phase failure coverage for POST /api/v2/releases/publish-revisions:
// inject a fault into the FEATURE apply (after the constant already applied)
// and assert the full compensation contract — pre-images restored, revisions
// reopened, zero success-side signals, revision.publishFailed emitted per
// item with the shared correlation token.

// Fault injection at the cleanest seam: the bulk adapter registry. The
// feature adapter's applyPrecomputed throws AFTER the constant item already
// applied, so compensation must restore a committed entity write, release
// both claims, and suppress all success-side signals. The lazy Proxy defers
// requireActual to first property access, dodging model-module import cycles.
let mockFailFeatureApply = false;
let mockFailConstantRestore = false;
let mockFailConstantReleaseClaim = false;
let mockFeatureClaimConflict = false;
jest.mock("back-end/src/revisions/bulkPublish/registry", () => {
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        const actual = jest.requireActual(
          "back-end/src/revisions/bulkPublish/registry",
        );
        if (prop !== "getBulkAdapter") return actual[prop];
        return (type: string) => {
          const adapter = actual.getBulkAdapter(type);
          if (type === "feature") {
            return {
              ...adapter,
              claim: async (...args: unknown[]) => {
                // Simulate a lost claim CAS (concurrent edit since plan).
                if (mockFeatureClaimConflict) return false;
                return adapter.claim(...args);
              },
              applyPrecomputed: async (...args: unknown[]) => {
                if (mockFailFeatureApply) {
                  throw new Error("simulated infra failure");
                }
                return adapter.applyPrecomputed(...args);
              },
            };
          }
          if (type === "constant") {
            return {
              ...adapter,
              restorePreImage: async (...args: unknown[]) => {
                if (mockFailConstantRestore) {
                  throw new Error("simulated restore failure");
                }
                return adapter.restorePreImage(...args);
              },
              releaseClaim: async (...args: unknown[]) => {
                if (mockFailConstantReleaseClaim) {
                  throw new Error("simulated release-claim failure");
                }
                return adapter.releaseClaim(...args);
              },
            };
          }
          return adapter;
        };
      },
    },
  );
});

const ORG_ID = "org_publish_failure";

const org = {
  id: ORG_ID,
  name: "Publish Failure",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {},
} as unknown as OrganizationInterface;

function makeContext(): ReqContextClass {
  const context = new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });
  context.hasPremiumFeature = () => true;
  return context;
}

const { app, setReqContext } = setupApp();

describe("POST /api/v2/releases/publish-revisions — commit failure", () => {
  afterEach(() => {
    mockFailFeatureApply = false;
    mockFailConstantRestore = false;
    mockFailConstantReleaseClaim = false;
    mockFeatureClaimConflict = false;
  });

  it("rolls back applied entities, reopens revisions, and emits only publishFailed", async () => {
    setReqContext(makeContext());
    const now = new Date();

    await mongoose.connection.collection("constants").insertOne({
      id: "const_fail-const",
      organization: ORG_ID,
      key: "fail-const",
      name: "fail-const",
      owner: "",
      type: "string",
      value: "before",
      dateCreated: now,
      dateUpdated: now,
    });
    const stageRes = await request(app)
      .put(`/api/v1/constants-revisions/fail-const/new/value`)
      .send({ value: "after" })
      .set("Authorization", "Bearer foo");
    expect(stageRes.status).toBe(200);
    const constVersion = stageRes.body.revision.version;

    await mongoose.connection.collection("features").insertOne({
      id: "fail-feat",
      organization: ORG_ID,
      owner: "",
      valueType: "string",
      defaultValue: "live",
      version: 1,
      environmentSettings: {},
      dateCreated: now,
      dateUpdated: now,
    });
    await mongoose.connection.collection("featurerevisions").insertMany([
      {
        organization: ORG_ID,
        featureId: "fail-feat",
        version: 1,
        baseVersion: 0,
        status: "published",
        defaultValue: "live",
        rules: [],
        dateCreated: now,
        dateUpdated: now,
        datePublished: now,
      },
      {
        organization: ORG_ID,
        featureId: "fail-feat",
        version: 2,
        baseVersion: 1,
        status: "draft",
        defaultValue: "new-value",
        rules: [],
        dateCreated: now,
        dateUpdated: now,
      },
    ]);

    mockFailFeatureApply = true;
    // Constant first: it fully applies before the feature apply throws, so
    // compensation must restore an already-committed entity write.
    const res = await request(app)
      .post("/api/v2/releases/publish-revisions")
      .send({
        revisions: [
          { entityType: "constant", key: "fail-const", version: constVersion },
          { entityType: "feature", id: "fail-feat", version: 2 },
        ],
      })
      .set("Authorization", "Bearer foo");
    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/rolled back/);

    // Pre-images restored on both entities.
    const constant = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG_ID, key: "fail-const" });
    expect(constant?.value).toBe("before");
    const feature = await mongoose.connection
      .collection("features")
      .findOne({ organization: ORG_ID, id: "fail-feat" });
    expect(feature?.defaultValue).toBe("live");
    expect(feature?.version).toBe(1);

    // Claims released: both revisions are open again, not merged/published.
    const constRevision = await mongoose.connection
      .collection("revisions")
      .findOne({
        organization: ORG_ID,
        "target.type": "constant",
        version: constVersion,
      });
    expect(constRevision?.status).not.toBe("merged");
    const featRevision = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ organization: ORG_ID, featureId: "fail-feat", version: 2 });
    expect(featRevision?.status).toBe("draft");

    // No success-side signals for the aborted release; publishFailed per item
    // with the shared per-attempt token.
    const events = await mongoose.connection
      .collection("events")
      .find({ organizationId: ORG_ID })
      .toArray();
    const names = events.map((e) => e.event);
    expect(names).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/revision\.published/)]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\.updated$/)]),
    );
    const failed = events.filter((e) =>
      /revision\.publishFailed/.test(e.event),
    );
    expect(failed.length).toBe(2);
    // Raw-doc path: the Mongo doc's `data` column holds the delivery payload,
    // whose Stripe-style `data.object` is the resource — consumers read
    // `data.object.bulkPublishId`; only raw reads see the double nesting.
    const tokens = failed.map(
      (e) => e.data?.data?.object?.bulkPublishId as string,
    );
    expect(tokens[0]).toMatch(/^pub_/);
    expect(new Set(tokens).size).toBe(1);
    for (const e of failed) {
      expect(e.data?.data?.object?.failureReason).toMatch(
        /simulated infra failure/,
      );
    }
  });

  it("keeps a restore-failed item published and skips its publishFailed event", async () => {
    setReqContext(makeContext());
    const now = new Date();

    await mongoose.connection.collection("constants").insertOne({
      id: "const_stuck-const",
      organization: ORG_ID,
      key: "stuck-const",
      name: "stuck-const",
      owner: "",
      type: "string",
      value: "before",
      dateCreated: now,
      dateUpdated: now,
    });
    const stageRes = await request(app)
      .put(`/api/v1/constants-revisions/stuck-const/new/value`)
      .send({ value: "after" })
      .set("Authorization", "Bearer foo");
    expect(stageRes.status).toBe(200);
    const constVersion = stageRes.body.revision.version;

    await mongoose.connection.collection("features").insertOne({
      id: "stuck-feat",
      organization: ORG_ID,
      owner: "",
      valueType: "string",
      defaultValue: "live",
      version: 1,
      environmentSettings: {},
      dateCreated: now,
      dateUpdated: now,
    });
    await mongoose.connection.collection("featurerevisions").insertMany([
      {
        organization: ORG_ID,
        featureId: "stuck-feat",
        version: 1,
        baseVersion: 0,
        status: "published",
        defaultValue: "live",
        rules: [],
        dateCreated: now,
        dateUpdated: now,
        datePublished: now,
      },
      {
        organization: ORG_ID,
        featureId: "stuck-feat",
        version: 2,
        baseVersion: 1,
        status: "draft",
        defaultValue: "new-value",
        rules: [],
        dateCreated: now,
        dateUpdated: now,
      },
    ]);

    // Constant applies, feature apply throws, then the constant's restore
    // ALSO fails: the constant must stay published (entity + revision) with
    // no contradictory publishFailed webhook, while the feature rolls back
    // and gets one.
    mockFailFeatureApply = true;
    mockFailConstantRestore = true;
    const res = await request(app)
      .post("/api/v2/releases/publish-revisions")
      .send({
        revisions: [
          { entityType: "constant", key: "stuck-const", version: constVersion },
          { entityType: "feature", id: "stuck-feat", version: 2 },
        ],
      })
      .set("Authorization", "Bearer foo");
    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/could not be fully rolled back/);

    // Per-item outcomes name the stuck entity — flat rows speaking the
    // caller's identifier vocabulary (config/constant keys, not internal ids).
    const byId = Object.fromEntries(
      (res.body.items as { id: string; status: string }[]).map((item) => [
        item.id,
        item.status,
      ]),
    );
    expect(byId["stuck-const"]).toBe("published");
    expect(byId["stuck-feat"]).toBe("rolled-back");

    // The stuck constant keeps the release state on both entity and revision.
    const constant = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG_ID, key: "stuck-const" });
    expect(constant?.value).toBe("after");
    const constRevision = await mongoose.connection
      .collection("revisions")
      .findOne({
        organization: ORG_ID,
        "target.type": "constant",
        version: constVersion,
      });
    expect(constRevision?.status).toBe("merged");

    // The feature rolled back cleanly.
    const feature = await mongoose.connection
      .collection("features")
      .findOne({ organization: ORG_ID, id: "stuck-feat" });
    expect(feature?.defaultValue).toBe("live");
    const featRevision = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ organization: ORG_ID, featureId: "stuck-feat", version: 2 });
    expect(featRevision?.status).toBe("draft");

    // Exactly one publishFailed — for the rolled-back feature, not the
    // still-published constant.
    const failed = await mongoose.connection
      .collection("events")
      .find({ organizationId: ORG_ID, event: /revision\.publishFailed/ })
      .toArray();
    const forThisRelease = failed.filter(
      (e) =>
        e.data?.data?.object?.featureId === "stuck-feat" ||
        e.data?.data?.object?.key === "stuck-const",
    );
    expect(forThisRelease.length).toBe(1);
    expect(forThisRelease[0].data?.data?.object?.featureId).toBe("stuck-feat");
  });

  it("reports an item whose reopen fails as published, not rolled-back", async () => {
    setReqContext(makeContext());
    const now = new Date();

    await mongoose.connection.collection("constants").insertOne({
      id: "const_reopen-fail",
      organization: ORG_ID,
      key: "reopen-fail",
      name: "reopen-fail",
      owner: "",
      type: "string",
      value: "before",
      dateCreated: now,
      dateUpdated: now,
    });
    const stageRes = await request(app)
      .put(`/api/v1/constants-revisions/reopen-fail/new/value`)
      .send({ value: "after" })
      .set("Authorization", "Bearer foo");
    expect(stageRes.status).toBe(200);
    const constVersion = stageRes.body.revision.version;

    await mongoose.connection.collection("features").insertOne({
      id: "reopen-feat",
      organization: ORG_ID,
      owner: "",
      valueType: "string",
      defaultValue: "live",
      version: 1,
      environmentSettings: {},
      dateCreated: now,
      dateUpdated: now,
    });
    await mongoose.connection.collection("featurerevisions").insertMany([
      {
        organization: ORG_ID,
        featureId: "reopen-feat",
        version: 1,
        baseVersion: 0,
        status: "published",
        defaultValue: "live",
        rules: [],
        dateCreated: now,
        dateUpdated: now,
        datePublished: now,
      },
      {
        organization: ORG_ID,
        featureId: "reopen-feat",
        version: 2,
        baseVersion: 1,
        status: "draft",
        defaultValue: "new-value",
        rules: [],
        dateCreated: now,
        dateUpdated: now,
      },
    ]);

    // Constant applies and its entity restore succeeds, but reopening its
    // revision (releaseClaim) throws: the entity is back at pre-image while
    // the revision stays merged, so the item must be reported "published"
    // (not "rolled-back") with no contradictory publishFailed event.
    mockFailFeatureApply = true;
    mockFailConstantReleaseClaim = true;
    const res = await request(app)
      .post("/api/v2/releases/publish-revisions")
      .send({
        revisions: [
          { entityType: "constant", key: "reopen-fail", version: constVersion },
          { entityType: "feature", id: "reopen-feat", version: 2 },
        ],
      })
      .set("Authorization", "Bearer foo");
    expect(res.status).toBe(500);

    const byId = Object.fromEntries(
      (res.body.items as { id: string; status: string }[]).map((item) => [
        item.id,
        item.status,
      ]),
    );
    // Entity restored (rolled back) but revision reopen failed → published.
    expect(byId["reopen-fail"]).toBe("published");
    expect(byId["reopen-feat"]).toBe("rolled-back");

    // The constant's entity IS back at its pre-image despite the stuck claim.
    const constant = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG_ID, key: "reopen-fail" });
    expect(constant?.value).toBe("before");

    // No publishFailed for the still-merged constant; only the feature.
    const failed = await mongoose.connection
      .collection("events")
      .find({ organizationId: ORG_ID, event: /revision\.publishFailed/ })
      .toArray();
    const forThisRelease = failed.filter(
      (e) =>
        e.data?.data?.object?.featureId === "reopen-feat" ||
        e.data?.data?.object?.key === "reopen-fail",
    );
    expect(forThisRelease.length).toBe(1);
    expect(forThisRelease[0].data?.data?.object?.featureId).toBe("reopen-feat");
  });

  it("surfaces a stuck claim when a pre-apply abort fails to reopen it", async () => {
    setReqContext(makeContext());
    const now = new Date();

    // Constant claims cleanly; the feature's claim loses its CAS (concurrent
    // edit), triggering a pre-apply abort. Reopening the constant then fails,
    // so its revision is stuck merged with no entity write — this must surface
    // as a 500 with items, not a clean retryable 409.
    await mongoose.connection.collection("constants").insertOne({
      id: "const_abort-stuck",
      organization: ORG_ID,
      key: "abort-stuck",
      name: "abort-stuck",
      owner: "",
      type: "string",
      value: "before",
      dateCreated: now,
      dateUpdated: now,
    });
    const stageRes = await request(app)
      .put(`/api/v1/constants-revisions/abort-stuck/new/value`)
      .send({ value: "after" })
      .set("Authorization", "Bearer foo");
    expect(stageRes.status).toBe(200);
    const constVersion = stageRes.body.revision.version;

    await mongoose.connection.collection("features").insertOne({
      id: "abort-feat",
      organization: ORG_ID,
      owner: "",
      valueType: "string",
      defaultValue: "live",
      version: 1,
      environmentSettings: {},
      dateCreated: now,
      dateUpdated: now,
    });
    await mongoose.connection.collection("featurerevisions").insertMany([
      {
        organization: ORG_ID,
        featureId: "abort-feat",
        version: 1,
        baseVersion: 0,
        status: "published",
        defaultValue: "live",
        rules: [],
        dateCreated: now,
        dateUpdated: now,
        datePublished: now,
      },
      {
        organization: ORG_ID,
        featureId: "abort-feat",
        version: 2,
        baseVersion: 1,
        status: "draft",
        defaultValue: "new-value",
        rules: [],
        dateCreated: now,
        dateUpdated: now,
      },
    ]);

    mockFeatureClaimConflict = true;
    mockFailConstantReleaseClaim = true;
    const res = await request(app)
      .post("/api/v2/releases/publish-revisions")
      .send({
        revisions: [
          { entityType: "constant", key: "abort-stuck", version: constVersion },
          { entityType: "feature", id: "abort-feat", version: 2 },
        ],
      })
      .set("Authorization", "Bearer foo");
    // Not a clean 409 — the failed reopen escalates to a 500 with items.
    expect(res.status).toBe(500);

    const byId = Object.fromEntries(
      (res.body.items as { id: string; status: string }[]).map((item) => [
        item.id,
        item.status,
      ]),
    );
    expect(byId["abort-stuck"]).toBe("published");
    expect(byId["abort-feat"]).toBe("not-applied");

    // No entity was ever written — the constant is still at its pre-image.
    const constant = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG_ID, key: "abort-stuck" });
    expect(constant?.value).toBe("before");

    // A pre-apply abort emits no publishFailed events (nothing was applied).
    const failed = await mongoose.connection
      .collection("events")
      .find({ organizationId: ORG_ID, event: /revision\.publishFailed/ })
      .toArray();
    const forThisRelease = failed.filter(
      (e) =>
        e.data?.data?.object?.featureId === "abort-feat" ||
        e.data?.data?.object?.key === "abort-stuck",
    );
    expect(forThisRelease.length).toBe(0);
  });
});
