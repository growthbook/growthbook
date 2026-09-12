import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// Drives the feature rule endpoints (per-rule and bulk, v1 and v2) through the
// real app against in-memory Mongo: targeting references must exist, unknown
// keys are rejected, read-only GET keys are accepted, and a write never
// re-validates references it did not touch.

const ORG_ID = "org_rule_refs";
const org = {
  id: ORG_ID,
  name: "Rule Refs",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }, { id: "dev" }] },
} as unknown as OrganizationInterface;

function makeContext(): ReqContextClass {
  const context = new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_engineer" },
    role: "engineer",
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });
  context.hasPremiumFeature = () => true;
  return context;
}

const now = () => new Date();
type StoredRule = Record<string, unknown>;

async function insertFeature(
  id: string,
  rules: StoredRule[] = [],
): Promise<void> {
  await mongoose.connection.collection("features").insertOne({
    id,
    organization: ORG_ID,
    owner: "",
    description: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 2,
    archived: false,
    tags: [],
    rules,
    environmentSettings: {
      production: { enabled: true, rules: [] },
      dev: { enabled: true, rules: [] },
    },
    prerequisites: [],
    dateCreated: now(),
    dateUpdated: now(),
  });
}

async function insertDraftRevision(
  featureId: string,
  rules: StoredRule[] = [],
): Promise<void> {
  for (const [version, status] of [
    [1, "published"],
    [2, "draft"],
  ] as const) {
    await mongoose.connection.collection("featurerevisions").insertOne({
      id: `frev_${featureId}_${version}`,
      organization: ORG_ID,
      featureId,
      version,
      baseVersion: version - 1,
      status,
      createdBy: { type: "api_key", apiKey: "key_engineer" },
      comment: "",
      defaultValue: "false",
      rules: status === "draft" ? rules : [],
      dateCreated: now(),
      dateUpdated: now(),
      ...(status === "published" ? { datePublished: now() } : {}),
    });
  }
}

async function insertSavedGroup(id: string): Promise<void> {
  await mongoose.connection.collection("savedgroups").insertOne({
    id,
    organization: ORG_ID,
    groupName: id,
    owner: "",
    type: "list",
    attributeKey: "id",
    values: ["1"],
    projects: [],
    dateCreated: now(),
    dateUpdated: now(),
  });
}

const forceRule = (extra: Record<string, unknown>) => ({
  type: "force",
  value: "true",
  allEnvironments: true,
  ...extra,
});

describe("rule reference integrity (v2 per-rule endpoints)", () => {
  const { app, setReqContext } = setupApp();
  const FLAG = "flag_refs";
  const ADD = `/api/v2/features/${FLAG}/revisions/2/rules`;

  beforeEach(async () => {
    setReqContext(makeContext());
    await insertFeature(FLAG);
    await insertFeature("parent_flag");
    await insertSavedGroup("grp_known");
    await insertSavedGroup("grp_known_2");
  });

  const add = (rule: Record<string, unknown>) =>
    request(app).post(ADD).send({ rule }).set("Authorization", "Bearer foo");

  describe("POST rule", () => {
    beforeEach(() => insertDraftRevision(FLAG));

    it.each([
      ["no targeting", {}],
      ["empty condition and groups", { condition: "{}", savedGroups: [] }],
      [
        "targeted saved group",
        { savedGroups: [{ match: "all", ids: ["grp_known"] }] },
      ],
      ["$inGroup", { condition: '{"id": {"$inGroup": "grp_known"}}' }],
      ["$notInGroup", { condition: '{"id": {"$notInGroup": "grp_known"}}' }],
      [
        "$savedGroups (UI-emitted operator)",
        { condition: '{"$savedGroups": ["grp_known"]}' },
      ],
      [
        "$notSavedGroups",
        { condition: '{"$notSavedGroups": ["grp_known", "grp_known_2"]}' },
      ],
      [
        "nested $or with $inGroup",
        {
          condition:
            '{"$or": [{"country": "US"}, {"id": {"$inGroup": "grp_known"}}]}',
        },
      ],
      [
        "prerequisite on an existing feature",
        {
          prerequisites: [{ id: "parent_flag", condition: '{"value": true}' }],
        },
      ],
    ])("accepts %s", async (_label, extra) => {
      const res = await add(forceRule(extra));
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
      const rules = res.body.revision?.rules ?? [];
      expect(rules).toHaveLength(1);
    });

    it.each([
      [
        "a targeted saved group that does not exist",
        { savedGroups: [{ match: "all", ids: ["grp_missing"] }] },
        404,
        /grp_missing/,
      ],
      [
        "a partially valid id list",
        { savedGroups: [{ match: "any", ids: ["grp_known", "grp_missing"] }] },
        404,
        /grp_missing/,
      ],
      [
        "$inGroup naming an unknown group",
        { condition: '{"id": {"$inGroup": "grp_missing"}}' },
        400,
        /grp_missing/,
      ],
      [
        "$notInGroup naming an unknown group",
        { condition: '{"id": {"$notInGroup": "grp_missing"}}' },
        400,
        /grp_missing/,
      ],
      [
        "$savedGroups naming an unknown group",
        { condition: '{"$savedGroups": ["grp_missing"]}' },
        400,
        /saved group/i,
      ],
      [
        "$savedGroups with one known and one unknown group",
        { condition: '{"$savedGroups": ["grp_known", "grp_missing"]}' },
        400,
        /saved group/i,
      ],
      [
        "a condition that is not valid JSON",
        { condition: '{"country": ' },
        400,
        /Invalid rule condition/,
      ],
      [
        "a condition that is not an object",
        { condition: '"US"' },
        400,
        /Invalid rule condition/,
      ],
      [
        "a prerequisite whose condition is not valid JSON",
        { prerequisites: [{ id: "parent_flag", condition: "{" }] },
        400,
        /prerequisite/i,
      ],
      [
        "a prerequisite on a feature that does not exist",
        {
          prerequisites: [{ id: "missing_flag", condition: '{"value": true}' }],
        },
        404,
        /missing_flag/,
      ],
      [
        "the bulk-only savedGroupTargeting alias (per-rule input is strict)",
        {
          savedGroupTargeting: [
            { matchType: "all", savedGroups: ["grp_known"] },
          ],
        },
        400,
        /Unrecognized key: "savedGroupTargeting"/,
      ],
    ])("rejects %s", async (_label, extra, status, message) => {
      const res = await add(forceRule(extra));
      expect(res.body.message).toMatch(message);
      expect(res.status).toBe(status);
      const revision = await mongoose.connection
        .collection("featurerevisions")
        .findOne({ featureId: FLAG, version: 2 });
      expect(revision?.rules).toEqual([]);
    });

    it("validates a rollout rule the same way", async () => {
      const res = await add({
        type: "rollout",
        value: "true",
        coverage: 0.5,
        hashAttribute: "id",
        allEnvironments: true,
        condition: '{"id": {"$inGroup": "grp_missing"}}',
      });
      expect(res.body.message).toMatch(/grp_missing/);
      expect(res.status).toBe(400);
    });

    it("checks that an experiment-ref's experiment exists before its targeting", async () => {
      const res = await add({
        type: "experiment-ref",
        experimentId: "exp_missing",
        variations: [{ variationId: "v0", value: "false" }],
        allEnvironments: true,
        condition: '{"id": {"$inGroup": "grp_missing"}}',
      });
      expect(res.body.message).toMatch(/exp_missing/);
      expect(res.status).toBe(404);
    });
  });

  describe("PUT rule", () => {
    // Stored rule references a group that no longer exists (or that this
    // caller cannot read) — the pre-existing state a PUT must not trip over.
    const stored = {
      id: "fr_stored",
      type: "force",
      value: "true",
      description: "",
      enabled: true,
      condition: '{"id": {"$inGroup": "grp_gone"}}',
      savedGroups: [{ match: "all", ids: ["grp_gone"] }],
      prerequisites: [{ id: "gone_flag", condition: '{"value": true}' }],
      allEnvironments: true,
    };
    const PUT = `${ADD}/fr_stored`;
    const put = (rule: Record<string, unknown>) =>
      request(app).put(PUT).send({ rule }).set("Authorization", "Bearer foo");

    beforeEach(() => insertDraftRevision(FLAG, [stored]));

    it.each([
      ["a description-only patch", { description: "renamed" }],
      ["a value-only patch", { value: "false" }],
      ["a scope-only patch", { allEnvironments: false, environments: ["dev"] }],
      ["an enabled toggle", { enabled: false }],
    ])(
      "does not re-validate untouched references on %s",
      async (_label, patch) => {
        const res = await put(patch);
        expect(res.body.message).toBeUndefined();
        expect(res.status).toBe(200);
        const rule = res.body.revision.rules.find(
          (r: { id: string }) => r.id === "fr_stored",
        );
        expect(rule.condition).toBe(stored.condition);
      },
    );

    it("re-validates only the patched field", async () => {
      // New condition is checked (and passes); untouched groups/prereqs are not.
      let res = await put({ condition: '{"id": {"$inGroup": "grp_known"}}' });
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
      // New saved groups are checked; the still-stale condition is not.
      res = await put({
        savedGroups: [{ match: "all", ids: ["grp_known_2"] }],
      });
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
    });

    it.each([
      [
        "a condition patch naming an unknown group",
        { condition: '{"id": {"$inGroup": "grp_missing"}}' },
        400,
      ],
      ["a condition patch that is not valid JSON", { condition: "{" }, 400],
      [
        "a $savedGroups patch naming an unknown group",
        { condition: '{"$savedGroups": ["grp_missing"]}' },
        400,
      ],
      [
        "a savedGroups patch with an unknown id",
        { savedGroups: [{ match: "all", ids: ["grp_known", "grp_missing"] }] },
        404,
      ],
      [
        "a prerequisites patch on a missing feature",
        { prerequisites: [{ id: "missing_flag", condition: "{}" }] },
        404,
      ],
      [
        "a prerequisites patch with invalid JSON",
        { prerequisites: [{ id: "parent_flag", condition: "nope" }] },
        400,
      ],
    ])("rejects %s", async (_label, patch, status) => {
      const res = await put(patch);
      expect(res.status).toBe(status);
      const revision = await mongoose.connection
        .collection("featurerevisions")
        .findOne({ featureId: FLAG, version: 2 });
      expect(revision?.rules?.[0]?.condition).toBe(stored.condition);
    });

    it("accepts a $savedGroups patch naming an existing group", async () => {
      const res = await put({ condition: '{"$savedGroups": ["grp_known"]}' });
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
    });
  });

  // The v1 mapper still runs a map-less condition check first, so `$savedGroups`
  // is rejected on v1 bulk regardless of the group.
  describe("v1 bulk (POST /api/v1/features, POST /api/v1/features/:id)", () => {
    const create = (rules: Record<string, unknown>[], id = "flag_v1_bulk") =>
      request(app)
        .post("/api/v1/features")
        .send({
          id,
          owner: "reftest",
          valueType: "boolean",
          defaultValue: "false",
          environments: { production: { enabled: true, rules } },
        })
        .set("Authorization", "Bearer foo");
    const v1Force = (extra: Record<string, unknown>) => ({
      type: "force",
      value: "true",
      ...extra,
    });

    it.each([
      ["plain force rule", {}],
      [
        "known targeted group",
        { savedGroups: [{ match: "all", ids: ["grp_known"] }] },
      ],
      [
        "deprecated alias with a known group",
        {
          savedGroupTargeting: [
            { matchType: "any", savedGroups: ["grp_known"] },
          ],
        },
      ],
      [
        "$inGroup on a known group",
        { condition: '{"id": {"$inGroup": "grp_known"}}' },
      ],
      [
        "read-only echo keys from a GET",
        { rampScheduleId: "rs_1", scheduleType: "schedule" },
      ],
      [
        "prerequisite on an existing feature",
        {
          prerequisites: [{ id: "parent_flag", condition: '{"value": true}' }],
        },
      ],
    ])("accepts %s", async (_label, extra) => {
      const res = await create([v1Force(extra)]);
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
    });

    it.each([
      [
        "a misspelled key",
        { conditions: "{}" },
        400,
        /Unrecognized key: "conditions"/,
      ],
      [
        "an unknown key nested in the alias",
        {
          savedGroupTargeting: [
            { matchType: "all", savedGroups: ["grp_known"], x: 1 },
          ],
        },
        400,
        /Unrecognized key/,
      ],
      [
        "an unknown key nested in prerequisites",
        {
          prerequisites: [
            { id: "parent_flag", condition: "{}", enabled: true },
          ],
        },
        400,
        /Unrecognized key/,
      ],
      [
        "an unknown targeted group",
        { savedGroups: [{ match: "all", ids: ["grp_missing"] }] },
        404,
        /grp_missing/,
      ],
      [
        "a partially valid id list",
        { savedGroups: [{ match: "any", ids: ["grp_known", "grp_missing"] }] },
        404,
        /grp_missing/,
      ],
      [
        "an unknown id via the alias",
        {
          savedGroupTargeting: [
            { matchType: "all", savedGroups: ["grp_missing"] },
          ],
        },
        404,
        /grp_missing/,
      ],
      [
        "$inGroup naming an unknown group",
        { condition: '{"id": {"$inGroup": "grp_missing"}}' },
        400,
        /grp_missing/,
      ],
      [
        "$savedGroups naming an unknown group",
        { condition: '{"$savedGroups": ["grp_missing"]}' },
        400,
        /saved group/i,
      ],
      [
        "a condition that is not valid JSON",
        { condition: '{"country": ' },
        400,
        /condition/i,
      ],
      [
        "a prerequisite on a missing feature",
        {
          prerequisites: [{ id: "missing_flag", condition: '{"value": true}' }],
        },
        404,
        /missing_flag/,
      ],
    ])(
      "rejects %s and creates nothing",
      async (_label, extra, status, message) => {
        const res = await create([v1Force(extra)]);
        expect(res.body.message).toMatch(message);
        expect(res.status).toBe(status);
        expect(
          await mongoose.connection
            .collection("features")
            .findOne({ id: "flag_v1_bulk" }),
        ).toBeNull();
      },
    );

    it("rejects when only the second of two rules is invalid", async () => {
      const res = await create([
        v1Force({ savedGroups: [{ match: "all", ids: ["grp_known"] }] }),
        v1Force({ savedGroups: [{ match: "all", ids: ["grp_missing"] }] }),
      ]);
      expect(res.body.message).toMatch(/grp_missing/);
      expect(res.status).toBe(404);
    });

    describe("update with stale stored references", () => {
      const stale = {
        id: "fr_stale",
        type: "force",
        value: "true",
        description: "",
        enabled: true,
        condition: '{"id": {"$inGroup": "grp_gone"}}',
        savedGroups: [{ match: "all", ids: ["grp_gone"] }],
        prerequisites: [{ id: "gone_flag", condition: '{"value": true}' }],
        allEnvironments: false,
        environments: ["production"],
      };
      const echoed = {
        id: "fr_stale",
        type: "force",
        value: "true",
        condition: stale.condition,
        savedGroups: stale.savedGroups,
        prerequisites: stale.prerequisites,
      };
      const update = (rules: Record<string, unknown>[]) =>
        request(app)
          .post("/api/v1/features/flag_stale")
          .send({ environments: { production: { enabled: true, rules } } })
          .set("Authorization", "Bearer foo");

      beforeEach(async () => {
        await insertFeature("flag_stale", [stale]);
        await insertDraftRevision("flag_stale", [stale]);
      });

      it("accepts the stored rule echoed back unchanged", async () => {
        const res = await update([echoed]);
        expect(res.body.message).toBeUndefined();
        expect(res.status).toBe(200);
      });

      it("accepts a non-targeting edit without re-checking stale references", async () => {
        const res = await update([{ ...echoed, value: "false" }]);
        expect(res.body.message).toBeUndefined();
        expect(res.status).toBe(200);
      });

      it("checks a changed condition but not the untouched stale groups", async () => {
        let res = await update([
          { ...echoed, condition: '{"id": {"$inGroup": "grp_known"}}' },
        ]);
        expect(res.body.message).toBeUndefined();
        expect(res.status).toBe(200);
        res = await update([
          { ...echoed, condition: '{"id": {"$inGroup": "grp_missing"}}' },
        ]);
        expect(res.body.message).toMatch(/grp_missing/);
        expect(res.status).toBe(400);
      });
    });
  });

  describe("v2 bulk (POST /api/v2/features)", () => {
    const create = (rules: Record<string, unknown>[], id = "flag_v2_bulk") =>
      request(app)
        .post("/api/v2/features")
        .send({
          id,
          owner: "reftest",
          valueType: "boolean",
          defaultValue: "false",
          rules,
        })
        .set("Authorization", "Bearer foo");

    it.each([
      ["a plain force rule", {}],
      [
        "read-only echo keys from a GET",
        {
          pendingRamp: "create",
          rampScheduleId: "rs_1",
          scheduleType: "schedule",
        },
      ],
      [
        "$savedGroups on a known group",
        { condition: '{"$savedGroups": ["grp_known"]}' },
      ],
      [
        "a known targeted group",
        { savedGroups: [{ match: "all", ids: ["grp_known"] }] },
      ],
    ])("accepts %s", async (_label, extra) => {
      const res = await create([forceRule(extra)]);
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
    });

    it.each([
      [
        "a misspelled key",
        { conditions: "{}" },
        400,
        /Unrecognized key: "conditions"/,
      ],
      [
        "an unknown key nested in savedGroups",
        { savedGroups: [{ match: "all", ids: ["grp_known"], extra: 1 }] },
        400,
        /Unrecognized key/,
      ],
      [
        "an unknown key nested in prerequisites",
        {
          prerequisites: [
            { id: "parent_flag", condition: "{}", enabled: true },
          ],
        },
        400,
        /Unrecognized key/,
      ],
      [
        "an unknown targeted group",
        { savedGroups: [{ match: "all", ids: ["grp_missing"] }] },
        404,
        /grp_missing/,
      ],
      [
        "$inGroup naming an unknown group",
        { condition: '{"id": {"$inGroup": "grp_missing"}}' },
        400,
        /grp_missing/,
      ],
      [
        "a prerequisite on a feature that does not exist",
        {
          prerequisites: [{ id: "missing_flag", condition: '{"value": true}' }],
        },
        404,
        /missing_flag/,
      ],
      [
        "an unknown key nested in scheduleRules",
        { scheduleRules: [{ timestamp: null, enabled: true, note: "x" }] },
        400,
        /Unrecognized key/,
      ],
    ])(
      "rejects %s and creates nothing",
      async (_label, extra, status, message) => {
        const res = await create([forceRule(extra)]);
        expect(res.body.message).toMatch(message);
        expect(res.status).toBe(status);
        expect(
          await mongoose.connection
            .collection("features")
            .findOne({ id: "flag_v2_bulk" }),
        ).toBeNull();
      },
    );
  });
});
