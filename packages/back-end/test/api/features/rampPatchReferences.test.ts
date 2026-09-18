import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api.setup";

// A ramp schedule patch carries the same targeting fields a rule does
// (condition, savedGroups, prerequisites, environments) and the ramp engine
// writes them onto the live rule when the step fires. The REST routes that
// store a plan check those fields the way the rule endpoints check a rule, so
// a plan cannot stage what a rule write would refuse.

const ORG_ID = "org_ramp_patch_refs";
const org = {
  id: ORG_ID,
  name: "Ramp Patch Refs",
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
const RULE = {
  type: "rollout",
  id: "fr_ramped",
  description: "",
  value: "true",
  coverage: 0,
  hashAttribute: "id",
  enabled: false,
  allEnvironments: true,
};
// Force rules: a coverage ramp promotes them, so the rule or the plan's start
// state must bring a hash attribute. The second exists only in the draft.
const FORCE_RULE = {
  type: "force",
  id: "fr_force",
  description: "",
  value: "true",
  enabled: false,
  allEnvironments: true,
};
const DRAFT_FORCE_RULE = { ...FORCE_RULE, id: "fr_draft_force" };

async function insertFeature(id: string): Promise<void> {
  await mongoose.connection.collection("features").insertOne({
    id,
    organization: ORG_ID,
    owner: "",
    description: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    archived: false,
    tags: [],
    rules: id === FLAG ? [RULE, FORCE_RULE] : [],
    environmentSettings: {
      production: { enabled: true, rules: [] },
      dev: { enabled: true, rules: [] },
    },
    prerequisites: [],
    dateCreated: now(),
    dateUpdated: now(),
  });
}

async function insertRevisions(featureId: string): Promise<void> {
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
      rules:
        status === "draft"
          ? [RULE, FORCE_RULE, DRAFT_FORCE_RULE]
          : [RULE, FORCE_RULE],
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

const FLAG = "flag_ramped";
const step = (patch: Record<string, unknown>) => ({
  interval: 3600,
  actions: [{ patch }],
});
const draftRampActions = async () =>
  (
    await mongoose.connection
      .collection("featurerevisions")
      .findOne({ featureId: FLAG, version: 2 })
  )?.rampActions ?? [];

describe("ramp schedule patch references", () => {
  const { app, setReqContext } = setupApp();

  beforeEach(async () => {
    setReqContext(makeContext());
    await insertFeature(FLAG);
    await insertFeature("parent_flag");
    await insertRevisions(FLAG);
    await insertSavedGroup("grp_known");
  });

  describe("PUT /api/v2/features/:id/revisions/:version/rules/:ruleId/ramp-schedule", () => {
    const put = (body: Record<string, unknown>) =>
      request(app)
        .put(
          `/api/v2/features/${FLAG}/revisions/2/rules/${RULE.id}/ramp-schedule`,
        )
        .send(body)
        .set("Authorization", "Bearer foo");

    it("stores a plan whose patches reference things that exist", async () => {
      const res = await put({
        steps: [
          step({
            coverage: 0.25,
            condition: '{"id": {"$inGroup": "grp_known"}}',
          }),
          step({ savedGroups: [{ match: "all", ids: ["grp_known"] }] }),
        ],
        endActions: [
          {
            patch: {
              environments: ["production"],
              prerequisites: [
                { id: "parent_flag", condition: '{"value": true}' },
              ],
            },
          },
        ],
      });
      expect(res.body.message).toBeUndefined();
      expect(res.status).toBe(200);
      expect(await draftRampActions()).toHaveLength(1);
    });

    it.each([
      [
        "a step condition that does not parse",
        { steps: [step({ condition: '{"country": ' })] },
        400,
        /Invalid ramp schedule patch: Invalid rule condition/,
      ],
      [
        "a step saved group that does not exist",
        {
          steps: [
            step({ savedGroups: [{ match: "all", ids: ["grp_missing"] }] }),
          ],
        },
        404,
        /grp_missing/,
      ],
      [
        "an end action naming an unknown environment",
        { steps: [], endActions: [{ patch: { environments: ["prodution"] } }] },
        400,
        /Invalid environment: "prodution"/,
      ],
      [
        "a startState prerequisite on a feature that does not exist",
        {
          steps: [step({ coverage: 0.5 })],
          startState: {
            prerequisites: [
              { id: "missing_flag", condition: '{"value": true}' },
            ],
          },
        },
        404,
        /missing_flag/,
      ],
    ])(
      "rejects %s and stores nothing",
      async (_label, body, status, message) => {
        const res = await put(body);
        expect(res.body.message).toMatch(message);
        expect(res.status).toBe(status);
        expect(await draftRampActions()).toEqual([]);
      },
    );
  });

  describe("a coverage ramp on a force rule with no hash attribute", () => {
    const NO_HASH = /is a force rule with no hash attribute/;
    const auth = (r: request.Test) => r.set("Authorization", "Bearer foo");

    it("is refused on the per-rule attach unless the start state names one; steps cannot", async () => {
      const put = (body: Record<string, unknown>) =>
        auth(
          request(app)
            .put(
              `/api/v2/features/${FLAG}/revisions/2/rules/${FORCE_RULE.id}/ramp-schedule`,
            )
            .send(body),
        );
      const refused = await put({ steps: [step({ coverage: 0.5 })] });
      expect(refused.body.message).toMatch(NO_HASH);
      expect(refused.status).toBe(400);
      expect(await draftRampActions()).toEqual([]);
      const onStep = await put({
        steps: [step({ coverage: 0.5, hashAttribute: "id" })],
      });
      expect(onStep.status).toBe(400);
      expect(await draftRampActions()).toEqual([]);
      const anchored = await put({
        steps: [step({ coverage: 0.5 })],
        startState: { hashAttribute: "id" },
      });
      expect(anchored.body.message).toBeUndefined();
      expect(anchored.status).toBe(200);
      expect(await draftRampActions()).toHaveLength(1);
    });

    it("is refused on v2 rule add, where the rule has no id yet", async () => {
      const add = (rampSchedule: Record<string, unknown>) =>
        auth(
          request(app)
            .post(`/api/v2/features/${FLAG}/revisions/2/rules`)
            .send({
              rule: {
                type: "force",
                value: "true",
                allEnvironments: true,
                enabled: false,
              },
              rampSchedule,
            }),
        );
      const refused = await add({ steps: [step({ coverage: 0.5 })] });
      expect(refused.body.message).toMatch(NO_HASH);
      expect(refused.status).toBe(400);
      const anchored = await add({
        steps: [step({ coverage: 0.5 })],
        startActions: [{ patch: { hashAttribute: "id" } }],
      });
      expect(anchored.body.message).toBeUndefined();
      expect(anchored.status).toBe(200);
    });

    it("is refused on v2 rule update for a rule that exists only in the draft", async () => {
      const res = await auth(
        request(app)
          .put(
            `/api/v2/features/${FLAG}/revisions/2/rules/${DRAFT_FORCE_RULE.id}`,
          )
          .send({
            rule: { enabled: true },
            rampSchedule: { steps: [step({ coverage: 0.5 })] },
          }),
      );
      expect(res.body.message).toMatch(NO_HASH);
      expect(res.status).toBe(400);
      expect(await draftRampActions()).toEqual([]);
    });
  });

  it("rejects an inline rampSchedule with a bad patch on v2 rule add", async () => {
    const res = await request(app)
      .post(`/api/v2/features/${FLAG}/revisions/2/rules`)
      .send({
        rule: {
          type: "force",
          value: "true",
          allEnvironments: true,
          enabled: false,
        },
        rampSchedule: {
          steps: [step({ condition: '{"id": {"$inGroup": "grp_missing"}}' })],
        },
      })
      .set("Authorization", "Bearer foo");
    expect(res.body.message).toMatch(
      /Invalid ramp schedule patch: .*grp_missing/,
    );
    expect(res.status).toBe(400);
    const revision = await mongoose.connection
      .collection("featurerevisions")
      .findOne({ featureId: FLAG, version: 2 });
    expect(revision?.rules).toHaveLength(3);
  });

  it("rejects a bad patch on REST ramp-schedule create, with or without a target", async () => {
    const create = (body: Record<string, unknown>) =>
      request(app)
        .post("/api/v1/ramp-schedules")
        .send(body)
        .set("Authorization", "Bearer foo");

    const targetless = await create({
      name: "targetless",
      steps: [step({ condition: '{"country": ' })],
    });
    expect(targetless.body.message).toMatch(/Invalid ramp schedule patch/);
    expect(targetless.status).toBe(400);

    const targeted = await create({
      name: "targeted",
      featureId: FLAG,
      ruleId: RULE.id,
      steps: [step({ savedGroups: [{ match: "any", ids: ["grp_missing"] }] })],
    });
    expect(targeted.body.message).toMatch(/grp_missing/);
    expect(targeted.status).toBe(404);

    expect(
      await mongoose.connection
        .collection("rampschedules")
        .countDocuments({ organization: ORG_ID }),
    ).toBe(0);
  });

  it("checks a changed patch on the generated update but lets an echo of the stored plan through", async () => {
    const auth = { Authorization: "Bearer foo" };
    const created = await request(app)
      .post("/api/v1/ramp-schedules")
      .send({
        name: "attached",
        featureId: FLAG,
        ruleId: RULE.id,
        steps: [step({ coverage: 0.5 })],
      })
      .set(auth);
    expect(created.body.message).toBeUndefined();
    expect(created.status).toBe(200);
    const id = created.body.rampSchedule.id;
    // A plan stored before the group it names was deleted.
    await mongoose.connection.collection("rampschedules").updateOne(
      { id },
      {
        $set: {
          "steps.0.actions.0.patch.savedGroups": [
            { match: "all", ids: ["grp_gone"] },
          ],
        },
      },
    );

    const fetched = await request(app)
      .get(`/api/v1/ramp-schedules/${id}`)
      .set(auth);
    expect(fetched.status).toBe(200);
    const steps = fetched.body.rampSchedule.steps;
    expect(steps[0].actions[0].patch.savedGroups[0].ids).toEqual(["grp_gone"]);
    const put = (body: Record<string, unknown>) =>
      request(app).put(`/api/v1/ramp-schedules/${id}`).send(body).set(auth);

    const echo = await put({ name: "renamed", steps });
    expect(echo.body.message).toBeUndefined();
    expect(echo.status).toBe(200);
    // Targeting untouched, so still an echo as far as references go.
    const recovered = await put({
      steps: [
        {
          ...steps[0],
          actions: [
            {
              ...steps[0].actions[0],
              patch: { ...steps[0].actions[0].patch, coverage: 0.75 },
            },
          ],
        },
      ],
    });
    expect(recovered.body.message).toBeUndefined();
    expect(recovered.status).toBe(200);

    // Editing another field of the step leaves the stale group unchecked...
    const otherField = await put({
      steps: [
        {
          ...steps[0],
          actions: [
            {
              ...steps[0].actions[0],
              patch: {
                ...steps[0].actions[0].patch,
                condition: '{"country": "US"}',
              },
            },
          ],
        },
      ],
    });
    expect(otherField.body.message).toBeUndefined();
    expect(otherField.status).toBe(200);

    // ...touching the saved groups themselves re-checks them.
    const changed = await put({
      steps: [
        {
          ...steps[0],
          actions: [
            {
              ...steps[0].actions[0],
              patch: {
                ...steps[0].actions[0].patch,
                savedGroups: [{ match: "all", ids: ["grp_gone", "grp_known"] }],
              },
            },
          ],
        },
      ],
    });
    expect(changed.body.message).toMatch(
      /Invalid ramp schedule patch: Saved group "grp_gone" not found/,
    );
    expect(changed.status).toBe(404);

    const cyclic = await put({
      steps: [
        step({
          ruleId: RULE.id,
          prerequisites: [{ id: FLAG, condition: '{"value": true}' }],
        }),
      ].map((s) => ({
        ...s,
        actions: s.actions.map((a) => ({ ...a, targetType: "feature-rule" })),
      })),
    });
    expect(cyclic.body.message).toMatch(/cannot be its own prerequisite/);
    expect(cyclic.status).toBe(400);
  });
});
