import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { FeatureInterface } from "shared/types/feature";
import { ReqContextClass } from "back-end/src/services/context";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
import { setupApp } from "./api.setup";

// Coverage for POST /api/v2/releases/publish-revisions — the atomic multi-entity
// publish shortcut:
//  1. `dryRun: true` reports would-publish results and gates with ZERO writes.
//  2. A real publish lands a constant + config draft pair atomically: both
//     live values update and both revisions close as merged.
//  3. An unresolvable key surfaces a structured 422 `not-found` gate and
//     nothing in the set publishes (all-or-nothing).
//  4. Two revisions of the same entity in one request are a 400.
//  5. Without the `releases` commercial feature the endpoint is a 403.

const ORG_ID = "org_publish_revisions";

const org = {
  id: ORG_ID,
  name: "Publish Revisions",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {},
} as unknown as OrganizationInterface;

function makeContext(opts: { licensed?: boolean } = {}): ReqContextClass {
  const context = new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    req: {
      query: {},
      headers: {},
      body: {},
    } as unknown as Request,
  });
  if (opts.licensed !== false) {
    context.hasPremiumFeature = () => true;
  }
  return context;
}

async function insertRawConstant(key: string): Promise<void> {
  const now = new Date();
  await mongoose.connection.collection("constants").insertOne({
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
}

async function insertRawConfig(key: string): Promise<void> {
  const now = new Date();
  await mongoose.connection.collection("configs").insertOne({
    id: `cfg_${key}`,
    organization: ORG_ID,
    key,
    name: key,
    owner: "",
    value: JSON.stringify({ hello: "before" }),
    dateCreated: now,
    dateUpdated: now,
  });
}

// Stage a draft revision carrying a value change through the real revisions
// API (`version: "new"` auto-creates the draft). Returns the draft version.
async function stageConstantDraft(key: string, value: string): Promise<number> {
  const res = await request(app)
    .put(`/api/v1/constants-revisions/${key}/new/value`)
    .send({ value })
    .set("Authorization", "Bearer foo");
  expect(res.status).toBe(200);
  return res.body.revision.version;
}

async function stageConfigDraft(
  key: string,
  value: Record<string, unknown>,
): Promise<number> {
  const res = await request(app)
    .put(`/api/v1/configs-revisions/${key}/new/value`)
    .send({ value })
    .set("Authorization", "Bearer foo");
  expect(res.status).toBe(200);
  return res.body.revision.version;
}

async function publishRevisions(body: Record<string, unknown>) {
  return request(app)
    .post("/api/v2/releases/publish-revisions")
    .send(body)
    .set("Authorization", "Bearer foo");
}

const { app, setReqContext } = setupApp();

describe("POST /api/v2/releases/publish-revisions", () => {
  it("dry run reports would-publish outcomes without writing", async () => {
    setReqContext(makeContext());
    await insertRawConstant("qp-dry-const");
    await insertRawConfig("qp-dry-cfg");
    const constVersion = await stageConstantDraft("qp-dry-const", "after");
    const cfgVersion = await stageConfigDraft("qp-dry-cfg", { hello: "after" });

    const res = await publishRevisions({
      dryRun: true,
      revisions: [
        { entityType: "constant", key: "qp-dry-const", version: constVersion },
        { entityType: "config", key: "qp-dry-cfg", version: cfgVersion },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "constant",
          id: "qp-dry-const",
          status: "would-publish",
        }),
        expect.objectContaining({
          entityType: "config",
          id: "qp-dry-cfg",
          status: "would-publish",
        }),
      ]),
    );

    // Zero writes: live values unchanged, revisions still open.
    const constant = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG_ID, key: "qp-dry-const" });
    expect(constant?.value).toBe("before");
    const config = await mongoose.connection
      .collection("configs")
      .findOne({ organization: ORG_ID, key: "qp-dry-cfg" });
    expect(JSON.parse(config?.value ?? "{}")).toEqual({ hello: "before" });
    const openRevisions = await mongoose.connection
      .collection("revisions")
      .find({ organization: ORG_ID, status: { $nin: ["merged", "discarded"] } })
      .toArray();
    expect(openRevisions.length).toBe(2);

    // Zero side effects: a dry run emits no events (so no webhooks) beyond
    // whatever the staging calls above already produced.
    const events = await mongoose.connection
      .collection("events")
      .find({ organizationId: ORG_ID })
      .toArray();
    expect(
      events.filter((e) => /published|publishFailed|updated$/.test(e.event)),
    ).toEqual([]);
  });

  it("publishes a constant + config pair atomically", async () => {
    setReqContext(makeContext());
    await insertRawConstant("qp-real-const");
    await insertRawConfig("qp-real-cfg");
    const constVersion = await stageConstantDraft("qp-real-const", "after");
    const cfgVersion = await stageConfigDraft("qp-real-cfg", {
      hello: "after",
    });

    const res = await publishRevisions({
      revisions: [
        { entityType: "constant", key: "qp-real-const", version: constVersion },
        { entityType: "config", key: "qp-real-cfg", version: cfgVersion },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(false);
    expect(res.body.bulkPublishId).toMatch(/^pub_/);
    expect(res.body.results).toHaveLength(2);
    expect(
      res.body.results.every(
        (r: { status: string }) => r.status === "published",
      ),
    ).toBe(true);

    const constant = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG_ID, key: "qp-real-const" });
    expect(constant?.value).toBe("after");
    const config = await mongoose.connection
      .collection("configs")
      .findOne({ organization: ORG_ID, key: "qp-real-cfg" });
    expect(JSON.parse(config?.value ?? "{}")).toEqual({ hello: "after" });

    const openRevisions = await mongoose.connection
      .collection("revisions")
      .find({ organization: ORG_ID, status: { $nin: ["merged", "discarded"] } })
      .toArray();
    expect(openRevisions.length).toBe(0);
  });

  it("blocks the whole set with a structured 422 when any item is unresolvable", async () => {
    setReqContext(makeContext());
    await insertRawConstant("qp-block-const");
    const constVersion = await stageConstantDraft("qp-block-const", "after");

    const res = await publishRevisions({
      revisions: [
        {
          entityType: "constant",
          key: "qp-block-const",
          version: constVersion,
        },
        { entityType: "config", key: "qp-missing-cfg", version: 2 },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "not-found",
          entityType: "config",
          id: "qp-missing-cfg",
        }),
      ]),
    );

    // All-or-nothing: the resolvable constant did NOT publish.
    const constant = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG_ID, key: "qp-block-const" });
    expect(constant?.value).toBe("before");
  });

  it("rejects two revisions of the same entity", async () => {
    setReqContext(makeContext());
    await insertRawConstant("qp-dupe-const");
    const version = await stageConstantDraft("qp-dupe-const", "after");

    const res = await publishRevisions({
      revisions: [
        { entityType: "constant", key: "qp-dupe-const", version },
        { entityType: "constant", key: "qp-dupe-const", version: version + 1 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/one revision per entity/);
  });

  it("publishes a feature + constant batch across both revision stores", async () => {
    setReqContext(makeContext());
    const now = new Date();
    await mongoose.connection.collection("features").insertOne({
      id: "qp-feat",
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
        featureId: "qp-feat",
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
        featureId: "qp-feat",
        version: 2,
        baseVersion: 1,
        status: "draft",
        defaultValue: "new-value",
        rules: [],
        dateCreated: now,
        dateUpdated: now,
      },
    ]);
    await insertRawConstant("qp-feat-const");
    const constVersion = await stageConstantDraft("qp-feat-const", "after");

    const res = await publishRevisions({
      revisions: [
        { entityType: "feature", id: "qp-feat", version: 2 },
        { entityType: "constant", key: "qp-feat-const", version: constVersion },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "feature",
          id: "qp-feat",
          status: "published",
        }),
        expect.objectContaining({
          entityType: "constant",
          id: "qp-feat-const",
          status: "published",
        }),
      ]),
    );
    // Feature revisions expose a computed natural-key id — a pure projection
    // of (version, featureId), never stored, identical on every read.
    const featureResult = res.body.results.find(
      (r: { entityType: string }) => r.entityType === "feature",
    );
    expect(featureResult.revisionId).toBe("frev_2_qp-feat");

    const feature = await mongoose.connection
      .collection("features")
      .findOne({ organization: ORG_ID, id: "qp-feat" });
    expect(feature?.defaultValue).toBe("new-value");
    expect(feature?.version).toBe(2);
    const publishedRevision = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ organization: ORG_ID, featureId: "qp-feat", version: 2 });
    expect(publishedRevision?.status).toBe("published");
    // Legacy docs (raw-seeded, no stored id) materialize their computed tuple
    // id at the publish write — the identity callers saw is what persists.
    expect(publishedRevision?.id).toBe("frev_2_qp-feat");
    const constant = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG_ID, key: "qp-feat-const" });
    expect(constant?.value).toBe("after");
  });

  it("accepts revisionId inputs — the ids this endpoint and the revision APIs emit", async () => {
    setReqContext(makeContext());
    const now = new Date();
    await mongoose.connection.collection("features").insertOne({
      id: "qp-rid-feat",
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
        featureId: "qp-rid-feat",
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
        featureId: "qp-rid-feat",
        version: 2,
        baseVersion: 1,
        status: "draft",
        defaultValue: "new-value",
        rules: [],
        dateCreated: now,
        dateUpdated: now,
      },
    ]);
    await insertRawConstant("qp-rid-const");
    await stageConstantDraft("qp-rid-const", "after");
    // The generic revision id (rev_…), as callers would capture it from a
    // dry-run response or a revision.published webhook payload.
    const constRevision = await mongoose.connection
      .collection("revisions")
      .findOne({
        organization: ORG_ID,
        "target.type": "constant",
        status: { $nin: ["merged", "discarded"] },
      });

    const res = await publishRevisions({
      revisions: [
        { entityType: "feature", revisionId: "frev_2_qp-rid-feat" },
        { entityType: "constant", revisionId: constRevision?.id },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "feature",
          id: "qp-rid-feat",
          version: 2,
          status: "published",
        }),
        expect.objectContaining({
          entityType: "constant",
          id: "qp-rid-const",
          revisionId: constRevision?.id,
          status: "published",
        }),
      ]),
    );

    // A revisionId whose entity type contradicts the stated one is a 400.
    const mismatch = await publishRevisions({
      revisions: [
        { entityType: "config", revisionId: constRevision?.id ?? "rev_x" },
      ],
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.message).toMatch(/belongs to a constant/);
  });

  it("resolves minted (opaque) feature revision ids via the stored-id index", async () => {
    setReqContext(makeContext());
    const now = new Date();
    await mongoose.connection.collection("features").insertOne({
      id: "qp-mint-feat",
      organization: ORG_ID,
      owner: "",
      valueType: "string",
      defaultValue: "live",
      version: 1,
      environmentSettings: {},
      dateCreated: now,
      dateUpdated: now,
    });
    // A doc created after minting landed: carries a stored opaque id, which
    // does NOT parse as a tuple — resolution must go through the partial
    // (organization, id) index.
    await mongoose.connection.collection("featurerevisions").insertMany([
      {
        organization: ORG_ID,
        featureId: "qp-mint-feat",
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
        featureId: "qp-mint-feat",
        version: 2,
        baseVersion: 1,
        status: "draft",
        id: "frev_kxmintedid9",
        defaultValue: "new-value",
        rules: [],
        dateCreated: now,
        dateUpdated: now,
      },
    ]);

    const res = await publishRevisions({
      revisions: [{ entityType: "feature", revisionId: "frev_kxmintedid9" }],
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      expect.objectContaining({
        entityType: "feature",
        id: "qp-mint-feat",
        version: 2,
        revisionId: "frev_kxmintedid9",
        status: "published",
      }),
    ]);
    const feature = await mongoose.connection
      .collection("features")
      .findOne({ organization: ORG_ID, id: "qp-mint-feat" });
    expect(feature?.defaultValue).toBe("new-value");
  });

  it("publishes a saved group + config batch and stamps bulkPublishId on the emitted events", async () => {
    setReqContext(makeContext());
    const now = new Date();
    await mongoose.connection.collection("savedgroups").insertOne({
      id: "grp_qp_sg",
      organization: ORG_ID,
      groupName: "Release test group",
      owner: "",
      type: "condition",
      condition: '{"id": {"$in": ["a"]}}',
      dateCreated: now,
      dateUpdated: now,
    });
    const sgCreate = await request(app)
      .post(`/api/v1/saved-groups-revisions/grp_qp_sg`)
      .send({})
      .set("Authorization", "Bearer foo");
    expect(sgCreate.status).toBe(200);
    const sgVersion = sgCreate.body.revision.version;
    const sgEdit = await request(app)
      .put(`/api/v1/saved-groups-revisions/grp_qp_sg/${sgVersion}/condition`)
      .send({ condition: '{"id": {"$in": ["a", "b"]}}' })
      .set("Authorization", "Bearer foo");
    expect(sgEdit.status).toBe(200);

    await insertRawConfig("qp-sg-cfg");
    const cfgVersion = await stageConfigDraft("qp-sg-cfg", { hello: "after" });

    const res = await publishRevisions({
      revisions: [
        { entityType: "saved-group", id: "grp_qp_sg", version: sgVersion },
        { entityType: "config", key: "qp-sg-cfg", version: cfgVersion },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.bulkPublishId).toMatch(/^pub_/);
    expect(
      res.body.results.every(
        (r: { status: string }) => r.status === "published",
      ),
    ).toBe(true);

    const savedGroup = await mongoose.connection
      .collection("savedgroups")
      .findOne({ organization: ORG_ID, id: "grp_qp_sg" });
    expect(savedGroup?.condition).toBe('{"id": {"$in": ["a", "b"]}}');

    // Every revision.published event this release emitted carries the
    // response's correlation token.
    const publishedEvents = await mongoose.connection
      .collection("events")
      .find({
        organizationId: ORG_ID,
        event: { $in: ["savedGroup.revision.published"] },
      })
      .toArray();
    const allPublished = await mongoose.connection
      .collection("events")
      .find({ organizationId: ORG_ID, event: /revision\.published/ })
      .toArray();
    expect(publishedEvents.length).toBeGreaterThanOrEqual(1);
    expect(allPublished.length).toBe(2);
    for (const event of allPublished) {
      expect(event.data?.data?.object?.bulkPublishId).toBe(
        res.body.bulkPublishId,
      );
    }
  });

  it("evaluates schema-break guards against the batch's proposed feature state (overlay false-positive regression)", async () => {
    // Engineer, not admin: an admin's bypass-approval permission implicitly
    // clears soft schema-break gates at collection time, hiding the guard
    // under test (mirrors config-revision-publish.test.ts).
    const engineerContext = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_engineer" },
      role: "engineer",
      req: { query: {}, headers: {}, body: {} } as unknown as Request,
    });
    engineerContext.hasPremiumFeature = () => true;
    setReqContext(engineerContext);
    const now = new Date();

    // Config with a `port: integer` schema; a feature backs its value on it
    // and interpolates the constant into the port field.
    await mongoose.connection.collection("configs").insertOne({
      id: "cfg_qp-fp-cfg",
      organization: ORG_ID,
      key: "qp-fp-cfg",
      name: "qp-fp-cfg",
      owner: "",
      value: '{"$extends":["@const:qp-fp-const"]}',
      schema: {
        type: "object",
        fields: [
          {
            key: "port",
            type: "integer",
            required: false,
            default: "",
            description: "",
            enum: [],
          },
        ],
      },
      dateCreated: now,
      dateUpdated: now,
    });
    await mongoose.connection.collection("constants").insertOne({
      id: "const_qp-fp-const",
      organization: ORG_ID,
      key: "qp-fp-const",
      name: "qp-fp-const",
      owner: "",
      type: "json",
      value: JSON.stringify({ port: 8080 }),
      dateCreated: now,
      dateUpdated: now,
    });
    await mongoose.connection.collection("features").insertOne({
      id: "qp-fp-feat",
      organization: ORG_ID,
      owner: "",
      valueType: "json",
      baseConfig: "qp-fp-cfg",
      defaultValue: '{"$extends":["@config:qp-fp-cfg"]}',
      rules: [
        {
          type: "force",
          id: "fr_qp_fp",
          value: '{"$extends":["@config:qp-fp-cfg"],"label":"x"}',
        },
      ],
      version: 1,
      environmentSettings: {},
      dateCreated: now,
      dateUpdated: now,
    });
    await mongoose.connection.collection("featurerevisions").insertMany([
      {
        organization: ORG_ID,
        featureId: "qp-fp-feat",
        version: 1,
        baseVersion: 0,
        status: "published",
        defaultValue: '{"$extends":["@config:qp-fp-cfg"]}',
        rules: [
          {
            type: "force",
            id: "fr_qp_fp",
            value: '{"$extends":["@config:qp-fp-cfg"],"label":"x"}',
          },
        ],
        dateCreated: now,
        dateUpdated: now,
        datePublished: now,
      },
      {
        // The FIX: the draft drops the constant reference, replacing the rule
        // value with a literal that satisfies the schema.
        organization: ORG_ID,
        featureId: "qp-fp-feat",
        version: 2,
        baseVersion: 1,
        status: "draft",
        defaultValue: '{"$extends":["@config:qp-fp-cfg"]}',
        rules: [
          {
            type: "force",
            id: "fr_qp_fp",
            value: '{"$extends":["@config:qp-fp-cfg"],"label":"x","port":9090}',
          },
        ],
        dateCreated: now,
        dateUpdated: now,
      },
    ]);

    // Stage the breaking constant change: port becomes a string.
    const stageRes = await request(app)
      .put(`/api/v1/constants-revisions/qp-fp-const/new/value`)
      .send({ value: JSON.stringify({ port: "not-a-number" }) })
      .set("Authorization", "Bearer foo");
    expect(stageRes.status).toBe(200);
    const constVersion = stageRes.body.revision.version;

    const schemaGatesOf = (body: {
      gates: { type: string; messages: string[] }[];
    }) =>
      body.gates.filter(
        (g) =>
          g.type === "schema-validation" &&
          g.messages.some((m) => m.includes("qp-fp-feat")),
      );

    // Control: the constant alone breaks the live feature value → gate fires.
    const alone = await publishRevisions({
      dryRun: true,
      revisions: [
        { entityType: "constant", key: "qp-fp-const", version: constVersion },
      ],
    });
    expect(alone.status).toBe(200);
    expect(schemaGatesOf(alone.body).length).toBeGreaterThanOrEqual(1);

    // Treatment: batched with the feature revision that removes the broken
    // reference, the guard evaluates the PROPOSED feature state via the
    // overlay → no false-positive gate, no ignoreWarnings needed.
    const batched = await publishRevisions({
      dryRun: true,
      revisions: [
        { entityType: "constant", key: "qp-fp-const", version: constVersion },
        { entityType: "feature", id: "qp-fp-feat", version: 2 },
      ],
    });
    expect(batched.status).toBe(200);
    // The config's own break persists (nothing in the batch fixes the config),
    // so only the FEATURE-mentioning gates must vanish.
    expect(schemaGatesOf(batched.body)).toEqual([]);
  });

  it("requires the releases commercial feature", async () => {
    setReqContext(makeContext({ licensed: false }));
    const res = await publishRevisions({
      revisions: [{ entityType: "constant", key: "any", version: 1 }],
    });
    expect(res.status).toBe(403);
  });

  it("reports a cross-item reference cycle as a 422 plan gate, not a commit 500", async () => {
    setReqContext(makeContext());
    // Two constants, each acyclic alone; only the COMBINED end-state cycles
    // (a → b → a). Neither the pre-state nor the final state cycles, so the
    // check must run against the multi-item overlay at plan time — and the
    // commit-time assert must stand down so a valid interdependent release
    // wouldn't spuriously 500 on apply order.
    await insertRawConstant("cyc-a");
    await insertRawConstant("cyc-b");
    const vA = await stageConstantDraft("cyc-a", "{{ @const:cyc-b }}");
    const vB = await stageConstantDraft("cyc-b", "{{ @const:cyc-a }}");

    const res = await publishRevisions({
      revisions: [
        { entityType: "constant", key: "cyc-a", version: vA },
        { entityType: "constant", key: "cyc-b", version: vB },
      ],
    });

    // A clean 422 with a reference-cycle gate — NOT a 500 from a mid-commit throw.
    expect(res.status).toBe(422);
    const cycleGate = res.body.gates.find(
      (g: { type: string }) => g.type === "reference-cycle",
    );
    expect(cycleGate).toBeDefined();
    expect(cycleGate.severity).toBe("blocker");
    expect(cycleGate.override).toBeNull();

    // Nothing published: both constants still hold their pre-image value.
    const a = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG_ID, key: "cyc-a" });
    expect(a?.value).toBe("before");
  });
});

// The feature scan-overlay applied by getAllFeaturesWithoutEditorFields — the
// single funnel cross-entity validators read features through during a bulk
// plan. Exercised against real Mongo so the overlay interacts with the actual
// query, migration, archived, and permission-filter behavior.
describe("feature scan overlay in getAllFeaturesWithoutEditorFields", () => {
  async function insertRawFeature(
    id: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const now = new Date();
    await mongoose.connection.collection("features").insertOne({
      id,
      organization: ORG_ID,
      owner: "",
      valueType: "string",
      defaultValue: "live",
      version: 1,
      environmentSettings: {},
      dateCreated: now,
      dateUpdated: now,
      ...extra,
    });
  }

  function proposed(
    id: string,
    extra: Partial<FeatureInterface> = {},
  ): FeatureInterface {
    return {
      id,
      organization: ORG_ID,
      owner: "",
      valueType: "string",
      defaultValue: "proposed",
      version: 2,
      environmentSettings: {},
      dateCreated: new Date(),
      dateUpdated: new Date(),
      ...extra,
    } as FeatureInterface;
  }

  it("substitutes proposed states, appends unknowns, and keeps non-overlay contexts untouched", async () => {
    const context = makeContext();
    setReqContext(context);
    await insertRawFeature("feat-a");
    await insertRawFeature("feat-b");

    // Non-overlay context: loader returns live docs only.
    const plain = await getAllFeaturesWithoutEditorFields(context);
    expect(plain.map((f) => [f.id, f.defaultValue]).sort()).toEqual([
      ["feat-a", "live"],
      ["feat-b", "live"],
    ]);

    // Overlay context: feat-a substituted, feat-c appended, feat-b untouched.
    const overlayContext = makeContext();
    overlayContext.featureScanOverlay = new Map([
      ["feat-a", proposed("feat-a")],
      ["feat-c", proposed("feat-c")],
    ]);
    const overlaid = await getAllFeaturesWithoutEditorFields(overlayContext);
    expect(overlaid.map((f) => [f.id, f.defaultValue]).sort()).toEqual([
      ["feat-a", "proposed"],
      ["feat-b", "live"],
      ["feat-c", "proposed"],
    ]);
  });

  it("re-applies the archived filter to proposed states", async () => {
    const context = makeContext();
    setReqContext(context);
    // Live-archived feature: excluded from the base query. A batch that
    // UN-archives it must surface it; a batch that archives a live one must
    // hide it (matching the includeArchived=false query semantics).
    await insertRawFeature("feat-live");
    await insertRawFeature("feat-hidden", { archived: true });

    const overlayContext = makeContext();
    overlayContext.featureScanOverlay = new Map([
      ["feat-live", proposed("feat-live", { archived: true })],
      ["feat-hidden", proposed("feat-hidden", { archived: false })],
    ]);
    const overlaid = await getAllFeaturesWithoutEditorFields(overlayContext);
    expect(overlaid.map((f) => f.id)).toEqual(["feat-hidden"]);
  });
});
