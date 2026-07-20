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
          if (type !== "feature") return adapter;
          return {
            ...adapter,
            applyPrecomputed: async (...args: unknown[]) => {
              if (mockFailFeatureApply) {
                throw new Error("simulated infra failure");
              }
              return adapter.applyPrecomputed(...args);
            },
          };
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
});
