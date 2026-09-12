import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// Per-rule and bulk (v1 + v2) rule writes through the real app: references
// must exist, unknown keys are rejected, read-only GET keys are accepted, and a
// write never re-validates references it did not touch.

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

function makeContext(premium = true): ReqContextClass {
  const context = new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_engineer" },
    role: "engineer",
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });
  context.hasPremiumFeature = () => premium;
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

describe("feature rule write contracts", () => {
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
      ["a scope-only patch", { allEnvironments: false, environments: ["dev"] }],
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
        "$savedGroups on a known group (UI operator)",
        { condition: '{"$savedGroups": ["grp_known"]}' },
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

  // A stored rule can still name an environment that was since deleted. The
  // v2 read model drops it, so a GET posted back unchanged is accepted while a
  // newly introduced unknown id is still rejected.
  describe("v2 bulk update with a stale stored environment", () => {
    beforeEach(async () => {
      await insertFeature("flag_stale_env", [
        {
          id: "fr_stale_env",
          type: "force",
          value: "true",
          description: "",
          enabled: true,
          condition: "",
          savedGroups: [],
          allEnvironments: false,
          environments: ["gone_env", "production"],
        },
      ]);
      await insertDraftRevision("flag_stale_env");
    });

    it("reads back without the deleted environment and round-trips", async () => {
      const got = await request(app)
        .get("/api/v2/features/flag_stale_env")
        .set("Authorization", "Bearer foo");
      expect(got.status).toBe(200);
      expect(got.body.feature.rules[0].environments).toEqual(["production"]);

      const echoed = await request(app)
        .post("/api/v2/features/flag_stale_env")
        .send({ rules: got.body.feature.rules })
        .set("Authorization", "Bearer foo");
      expect(echoed.body.message).toBeUndefined();
      expect(echoed.status).toBe(200);
    });

    it("still rejects a newly introduced unknown environment", async () => {
      const res = await request(app)
        .post("/api/v2/features/flag_stale_env")
        .send({
          rules: [
            {
              type: "force",
              value: "true",
              allEnvironments: false,
              environments: ["prodution"],
            },
          ],
        })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toMatch(/Invalid environment: "prodution"/);
      expect(res.status).toBe(400);
    });
  });

  // Deleting a project scrubs feature.project and targetingProjects but not
  // rule scopes, so a stored rule can still name a gone project. An unchanged
  // scope is not re-checked on update; a newly introduced unknown id is.
  describe("bulk update with a stale rule project scope", () => {
    const stale = {
      id: "fr_stale_prj",
      type: "force",
      value: "true",
      description: "",
      enabled: true,
      condition: "",
      savedGroups: [],
      allEnvironments: true,
      allProjects: false,
      projects: ["prj_gone"],
    };
    beforeEach(async () => {
      await insertFeature("flag_stale_prj", [stale]);
      await insertDraftRevision("flag_stale_prj");
    });

    it("v2: echoes the GET back unchanged", async () => {
      const got = await request(app)
        .get("/api/v2/features/flag_stale_prj")
        .set("Authorization", "Bearer foo");
      expect(got.body.feature.rules[0].projects).toEqual(["prj_gone"]);
      const res = await request(app)
        .post("/api/v2/features/flag_stale_prj")
        .send({ rules: got.body.feature.rules })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
    });

    it("v2: still rejects a changed scope naming an unknown project", async () => {
      const res = await request(app)
        .post("/api/v2/features/flag_stale_prj")
        .send({
          rules: [{ ...stale, projects: ["prj_gone", "prj_missing"] }],
        })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toMatch(/prj_missing/);
      expect(res.status).toBe(400);
    });

    it("v1: echoes the GET back unchanged", async () => {
      const got = await request(app)
        .get("/api/v1/features/flag_stale_prj")
        .set("Authorization", "Bearer foo");
      const rules = got.body.feature.environments.production.rules;
      expect(rules[0].projects).toEqual(["prj_gone"]);
      const res = await request(app)
        .post("/api/v1/features/flag_stale_prj")
        .send({ environments: { production: { enabled: true, rules } } })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
    });
  });

  // v1 posts a lone sibling back with its id stemmed; the stored counterpart
  // must still be found so an unchanged stale scope is not re-checked.
  describe("v1 partial post-back of a suffixed sibling rule", () => {
    const sibling = (env: string, projects: string[]) => ({
      id: `fr_x__${env}`,
      type: "force",
      value: "true",
      description: "",
      enabled: true,
      condition: "",
      savedGroups: [],
      allEnvironments: false,
      environments: [env],
      allProjects: false,
      projects,
    });

    it("echoes one environment's rules back unchanged", async () => {
      await insertFeature("flag_sib", [
        sibling("production", ["prj_gone"]),
        sibling("dev", []),
      ]);
      await insertDraftRevision("flag_sib");
      const got = await request(app)
        .get("/api/v1/features/flag_sib")
        .set("Authorization", "Bearer foo");
      const rules = got.body.feature.environments.production.rules;
      expect(rules).toHaveLength(1);
      const res = await request(app)
        .post("/api/v1/features/flag_sib")
        .send({ environments: { production: { enabled: true, rules } } })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
    });
  });

  describe("revision GET → bulk POST", () => {
    it("a draft rule scoped to a deleted environment reads back filtered and echoes", async () => {
      const stale = {
        id: "fr_rev_stale",
        type: "force",
        value: "true",
        description: "",
        enabled: true,
        condition: "",
        savedGroups: [],
        allEnvironments: false,
        environments: ["gone_env", "production"],
      };
      await insertFeature("flag_rev_stale", [stale]);
      await insertDraftRevision("flag_rev_stale", [stale]);
      const got = await request(app)
        .get("/api/v2/features/flag_rev_stale/revisions/2")
        .set("Authorization", "Bearer foo");
      expect(got.body.revision.rules[0].environments).toEqual(["production"]);
      const res = await request(app)
        .post("/api/v2/features/flag_rev_stale")
        .send({ rules: got.body.revision.rules })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
    });
  });

  describe("experiment-ref rules on bulk writes", () => {
    const expRef = (experimentId: string, id?: string) => ({
      ...(id && { id }),
      type: "experiment-ref",
      experimentId,
      variations: [
        { variationId: "v0", value: "false" },
        { variationId: "v1", value: "true" },
      ],
      allEnvironments: true,
    });

    it("v2 create rejects a rule pointing at an experiment that does not exist", async () => {
      const res = await request(app)
        .post("/api/v2/features")
        .send({
          id: "flag_expref",
          owner: "reftest",
          valueType: "boolean",
          defaultValue: "false",
          rules: [expRef("exp_missing")],
        })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toMatch(
        /Could not find experiment "exp_missing"/,
      );
      expect(res.status).toBe(404);
    });

    it("v2 update echoes a rule whose experiment has since been deleted, but rejects a new unknown one", async () => {
      const stale = {
        id: "fr_expref",
        type: "experiment-ref",
        experimentId: "exp_gone",
        variations: [
          { variationId: "v0", value: "false" },
          { variationId: "v1", value: "true" },
        ],
        description: "",
        enabled: true,
        condition: "",
        savedGroups: [],
        allEnvironments: true,
      };
      await insertFeature("flag_stale_exp", [stale]);
      await insertDraftRevision("flag_stale_exp");
      const got = await request(app)
        .get("/api/v2/features/flag_stale_exp")
        .set("Authorization", "Bearer foo");
      let res = await request(app)
        .post("/api/v2/features/flag_stale_exp")
        .send({ rules: got.body.feature.rules })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
      res = await request(app)
        .post("/api/v2/features/flag_stale_exp")
        .send({ rules: [expRef("exp_other_missing", "fr_expref")] })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toMatch(/exp_other_missing/);
      expect(res.status).toBe(404);
    });
  });

  describe("duplicate rule ids in one payload", () => {
    it("v2 bulk rejects a repeated id", async () => {
      const res = await request(app)
        .post("/api/v2/features")
        .send({
          id: "flag_dupe",
          owner: "reftest",
          valueType: "boolean",
          defaultValue: "false",
          rules: [
            { ...forceRule({}), id: "fr_dupe" },
            { ...forceRule({ value: "false" }), id: "fr_dupe" },
          ],
        })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toMatch(/Duplicate rule ID\(s\): fr_dupe/);
      expect(res.status).toBe(400);
    });

    it("v1 bulk rejects a repeated id within one environment but allows siblings across environments", async () => {
      const rule = { id: "fr_sib", type: "force", value: "true" };
      let res = await request(app)
        .post("/api/v1/features")
        .send({
          id: "flag_v1_dupe",
          owner: "reftest",
          valueType: "boolean",
          defaultValue: "false",
          environments: { production: { enabled: true, rules: [rule, rule] } },
        })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toMatch(/in environment "production": fr_sib/);
      expect(res.status).toBe(400);
      res = await request(app)
        .post("/api/v1/features")
        .send({
          id: "flag_v1_sib",
          owner: "reftest",
          valueType: "boolean",
          defaultValue: "false",
          environments: {
            production: { enabled: true, rules: [rule] },
            dev: { enabled: true, rules: [rule] },
          },
        })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
    });
  });

  describe("scheduling shorthand plan gate on the per-rule endpoints", () => {
    beforeEach(async () => {
      setReqContext(makeContext(false));
      await insertDraftRevision(FLAG);
    });

    it("refuses the schedule shorthand without the plan feature", async () => {
      const res = await request(app)
        .post(ADD)
        .send({
          rule: forceRule({}),
          schedule: { startDate: "2030-01-01T00:00:00.000Z" },
        })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toMatch(/Pro plan/);
      expect(res.status).toBe(403);
    });

    it("refuses legacy inline scheduleRules on the v1 endpoint without the plan feature", async () => {
      const res = await request(app)
        .post(`/api/v1/features/${FLAG}/revisions/2/rules`)
        .send({
          environment: "production",
          rule: {
            type: "force",
            value: "true",
            scheduleRules: [
              { timestamp: "2030-01-01T00:00:00.000Z", enabled: true },
              { timestamp: null, enabled: false },
            ],
          },
        })
        .set("Authorization", "Bearer foo");
      expect(res.body.message).toMatch(/Pro plan/);
      expect(res.status).toBe(403);
    });

    it("still accepts an unscheduled rule", async () => {
      const res = await add(forceRule({}));
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
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
