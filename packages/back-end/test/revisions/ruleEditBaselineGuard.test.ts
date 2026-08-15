import mongoose from "mongoose";
import type { Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { FeatureRule } from "shared/types/feature";
import { putFeatureRule } from "back-end/src/controllers/features";
import { setupApp } from "../api/api.setup";

const ORG_ID = "org_rule_baseline_guard";
const FEATURE_ID = "baseline-guarded-flag";

const org = {
  id: ORG_ID,
  name: "Rule Baseline Guard",
  ownerEmail: "t@t.co",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: "u_admin",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: { environments: [{ id: "production", description: "" }] },
} as unknown as OrganizationInterface;

const baseRule: FeatureRule = {
  id: "fr_guarded",
  type: "force",
  description: "",
  value: "true",
  enabled: true,
  allEnvironments: true,
  environments: [],
} as unknown as FeatureRule;

const featureDoc = (liveRules: FeatureRule[], version: number) => ({
  id: FEATURE_ID,
  organization: ORG_ID,
  valueType: "boolean" as const,
  defaultValue: "false",
  version,
  project: "",
  environmentSettings: { production: { enabled: true, rules: [] } },
  rules: liveRules,
  dateCreated: new Date(),
  dateUpdated: new Date(),
});

const revisionDoc = (
  version: number,
  status: string,
  rules: FeatureRule[],
  baseVersion: number,
) => ({
  organization: ORG_ID,
  featureId: FEATURE_ID,
  version,
  status,
  baseVersion,
  createdBy: { type: "dashboard", id: "u_admin", email: "a@t.co", name: "A" },
  comment: "",
  rules,
  defaultValue: "false",
  dateCreated: new Date(),
  dateUpdated: new Date(),
});

describe("putFeatureRule baseline guard", () => {
  setupApp();

  const reqFor = (
    version: number,
    body: Record<string, unknown>,
  ): Parameters<typeof putFeatureRule>[0] =>
    ({
      params: { id: FEATURE_ID, version: String(version) },
      body,
      organization: org,
      userId: "u_admin",
      email: "a@t.co",
      name: "A",
      query: {},
      headers: {},
      audit: jest.fn(),
    }) as unknown as Parameters<typeof putFeatureRule>[0];

  const resSpy = () => {
    const captured: { status?: number; body?: unknown } = {};
    const res = {
      locals: {
        eventAudit: {
          type: "dashboard",
          id: "u_admin",
          email: "a@t.co",
          name: "A",
        },
      },
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(payload: unknown) {
        captured.body = payload;
        return this;
      },
    } as unknown as Response;
    return { res, captured };
  };

  const seed = async (opts: {
    liveRules: FeatureRule[];
    liveVersion: number;
    drafts?: Array<{
      version: number;
      status?: string;
      rules: FeatureRule[];
      baseVersion?: number;
    }>;
  }) => {
    for (const c of ["features", "featurerevisions"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    await mongoose.connection
      .collection("features")
      .insertOne(featureDoc(opts.liveRules, opts.liveVersion));
    for (let v = 1; v <= opts.liveVersion; v++) {
      await mongoose.connection
        .collection("featurerevisions")
        .insertOne(
          revisionDoc(
            v,
            "published",
            v === opts.liveVersion ? opts.liveRules : [baseRule],
            Math.max(1, v - 1),
          ),
        );
    }
    for (const d of opts.drafts ?? []) {
      await mongoose.connection
        .collection("featurerevisions")
        .insertOne(
          revisionDoc(
            d.version,
            d.status ?? "draft",
            d.rules,
            d.baseVersion ?? opts.liveVersion,
          ),
        );
    }
  };

  const storedRevision = async (version: number) =>
    mongoose.connection
      .collection("featurerevisions")
      .findOne({ organization: ORG_ID, featureId: FEATURE_ID, version });

  const draftCount = async () =>
    mongoose.connection.collection("featurerevisions").countDocuments({
      organization: ORG_ID,
      featureId: FEATURE_ID,
      status: "draft",
    });

  const edited: FeatureRule = { ...baseRule, value: "false" };

  it("saves into a draft when the baseline matches", async () => {
    await seed({
      liveRules: [baseRule],
      liveVersion: 1,
      drafts: [{ version: 2, rules: [baseRule] }],
    });
    const { res, captured } = resSpy();
    await putFeatureRule(
      reqFor(2, {
        rule: edited,
        ruleId: baseRule.id,
        baseline: { rule: baseRule },
      }),
      res,
    );
    expect(captured.body).toMatchObject({ status: 200, version: 2 });
    const draft = await storedRevision(2);
    expect(draft?.rules?.[0]?.value).toBe("false");
  });

  it("409s with a contested chunk when both sides changed the same field, and does not write", async () => {
    const theirEdit: FeatureRule = { ...baseRule, value: "someone-elses" };
    await seed({
      liveRules: [baseRule],
      liveVersion: 1,
      drafts: [{ version: 2, rules: [theirEdit] }],
    });
    const { res, captured } = resSpy();
    await putFeatureRule(
      reqFor(2, {
        rule: edited,
        ruleId: baseRule.id,
        baseline: { rule: baseRule },
      }),
      res,
    );
    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({
      status: 409,
      conflict: {
        ruleId: baseRule.id,
        currentRule: { value: "someone-elses" },
        liveVersion: 1,
        draftVersion: 2,
        merge: {
          contested: [{ key: "value", fields: ["value"] }],
        },
      },
    });
    const draft = await storedRevision(2);
    expect(draft?.rules?.[0]?.value).toBe("someone-elses");
  });

  it("auto-merges disjoint edits: theirs to description, yours to value", async () => {
    const theirEdit: FeatureRule = {
      ...baseRule,
      description: "their new description",
    };
    await seed({
      liveRules: [baseRule],
      liveVersion: 1,
      drafts: [{ version: 2, rules: [theirEdit] }],
    });
    const { res, captured } = resSpy();
    await putFeatureRule(
      reqFor(2, {
        rule: edited,
        ruleId: baseRule.id,
        baseline: { rule: baseRule },
      }),
      res,
    );
    expect(captured.body).toMatchObject({
      status: 200,
      version: 2,
      autoMergedTheirFields: ["description"],
    });
    const draft = await storedRevision(2);
    expect(draft?.rules?.[0]?.value).toBe("false");
    expect(draft?.rules?.[0]?.description).toBe("their new description");
  });

  it("treats the env-scope pair as one chunk: allEnvironments vs environments is contested", async () => {
    const theirEdit: FeatureRule = {
      ...baseRule,
      allEnvironments: false,
      environments: ["production"],
    } as FeatureRule;
    const myEdit: FeatureRule = {
      ...baseRule,
      allEnvironments: false,
      environments: ["dev"],
    } as FeatureRule;
    await seed({
      liveRules: [baseRule],
      liveVersion: 1,
      drafts: [{ version: 2, rules: [theirEdit] }],
    });
    const { res, captured } = resSpy();
    await putFeatureRule(
      reqFor(2, {
        rule: myEdit,
        ruleId: baseRule.id,
        baseline: { rule: baseRule },
      }),
      res,
    );
    expect(captured.status).toBe(409);
    const conflict = (
      captured.body as {
        conflict: { merge: { contested: Array<{ fields: string[] }> } };
      }
    ).conflict;
    expect(conflict.merge.contested).toHaveLength(1);
    expect(conflict.merge.contested[0].fields.sort()).toEqual([
      "allEnvironments",
      "environments",
    ]);
  });

  it("derives force/rollout type from the merged coverage instead of contesting it", async () => {
    const theirEdit = {
      ...baseRule,
      type: "rollout",
      coverage: 0.25,
      hashAttribute: "id",
    } as unknown as FeatureRule;
    await seed({
      liveRules: [baseRule],
      liveVersion: 1,
      drafts: [{ version: 2, rules: [theirEdit] }],
    });
    const { res, captured } = resSpy();
    await putFeatureRule(
      reqFor(2, {
        rule: edited,
        ruleId: baseRule.id,
        baseline: { rule: baseRule },
      }),
      res,
    );
    expect(captured.body).toMatchObject({ status: 200 });
    const draft = await storedRevision(2);
    expect(draft?.rules?.[0]?.type).toBe("rollout");
    expect(draft?.rules?.[0]?.coverage).toBe(0.25);
    expect(draft?.rules?.[0]?.value).toBe("false");
  });

  it("recomputes the type back to force when the merged coverage is full", async () => {
    const rolloutBase = {
      ...baseRule,
      type: "rollout",
      coverage: 0.5,
      hashAttribute: "id",
    } as unknown as FeatureRule;
    const theirEdit = { ...rolloutBase, coverage: 1 } as FeatureRule;
    const myEdit = {
      ...rolloutBase,
      description: "mine",
    } as unknown as FeatureRule;
    await seed({
      liveRules: [rolloutBase],
      liveVersion: 1,
      drafts: [{ version: 2, rules: [theirEdit] }],
    });
    const { res, captured } = resSpy();
    await putFeatureRule(
      reqFor(2, {
        rule: myEdit,
        ruleId: baseRule.id,
        baseline: { rule: rolloutBase },
      }),
      res,
    );
    expect(captured.body).toMatchObject({ status: 200 });
    const draft = await storedRevision(2);
    expect(draft?.rules?.[0]?.type).toBe("force");
    expect(draft?.rules?.[0]?.description).toBe("mine");
  });

  it("takes theirs without contesting when your side omits the field", async () => {
    const sparseBase = { ...baseRule, sparse: true } as unknown as FeatureRule;
    const theirEdit = { ...sparseBase, sparse: false } as FeatureRule;
    const myEdit = { ...baseRule, value: "false" } as FeatureRule; // no `sparse`
    await seed({
      liveRules: [sparseBase],
      liveVersion: 1,
      drafts: [{ version: 2, rules: [theirEdit] }],
    });
    const { res, captured } = resSpy();
    await putFeatureRule(
      reqFor(2, {
        rule: myEdit,
        ruleId: baseRule.id,
        baseline: { rule: sparseBase },
      }),
      res,
    );
    expect(captured.body).toMatchObject({ status: 200 });
    const draft = await storedRevision(2);
    expect(draft?.rules?.[0]?.sparse).toBe(false);
    expect(draft?.rules?.[0]?.value).toBe("false");
  });

  it("cross-family type change is a whole-rule conflict, no field merge", async () => {
    const theirEdit = {
      ...baseRule,
      type: "experiment-ref",
      experimentId: "exp_123",
      variations: [],
    } as unknown as FeatureRule;
    await seed({
      liveRules: [baseRule],
      liveVersion: 1,
      drafts: [{ version: 2, rules: [theirEdit] }],
    });
    const { res, captured } = resSpy();
    await putFeatureRule(
      reqFor(2, {
        rule: edited,
        ruleId: baseRule.id,
        baseline: { rule: baseRule },
      }),
      res,
    );
    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({
      status: 409,
      conflict: { merge: { wholeRule: true } },
    });
  });

  it("force->rollout flip merges with a disjoint value edit (same family)", async () => {
    const theirEdit = {
      ...baseRule,
      type: "rollout",
      coverage: 0.5,
      hashAttribute: "id",
    } as unknown as FeatureRule;
    await seed({
      liveRules: [baseRule],
      liveVersion: 1,
      drafts: [{ version: 2, rules: [theirEdit] }],
    });
    const { res, captured } = resSpy();
    await putFeatureRule(
      reqFor(2, {
        rule: edited,
        ruleId: baseRule.id,
        baseline: { rule: baseRule },
      }),
      res,
    );
    expect(captured.body).toMatchObject({ status: 200, version: 2 });
    const draft = await storedRevision(2);
    expect(draft?.rules?.[0]?.type).toBe("rollout");
    expect(draft?.rules?.[0]?.coverage).toBe(0.5);
    expect(draft?.rules?.[0]?.value).toBe("false");
  });

  it("re-anchors to the current live when the pinned live moved but the rule did not", async () => {
    await seed({ liveRules: [baseRule], liveVersion: 2 });
    const { res, captured } = resSpy();
    await putFeatureRule(
      reqFor(1, {
        rule: edited,
        ruleId: baseRule.id,
        baseline: { rule: baseRule },
      }),
      res,
    );
    expect(captured.body).toMatchObject({ status: 200 });
    const version = (captured.body as { version: number }).version;
    const draft = await storedRevision(version);
    expect(draft?.status).toBe("draft");
    expect(draft?.baseVersion).toBe(2);
    expect(draft?.rules?.[0]?.value).toBe("false");
  });

  it("409s without creating a draft when the pinned live moved and the rule changed", async () => {
    const publishedOverUs: FeatureRule = { ...baseRule, value: "published-v2" };
    await seed({ liveRules: [publishedOverUs], liveVersion: 2 });
    const { res, captured } = resSpy();
    await putFeatureRule(
      reqFor(1, {
        rule: edited,
        ruleId: baseRule.id,
        baseline: { rule: baseRule },
      }),
      res,
    );
    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({
      status: 409,
      conflict: {
        ruleId: baseRule.id,
        currentRule: { value: "published-v2" },
        liveVersion: 2,
      },
    });
    expect(await draftCount()).toBe(0);
  });

  it("keeps legacy behavior when no baseline is sent: a stale pin throws", async () => {
    await seed({ liveRules: [baseRule], liveVersion: 2 });
    const { res } = resSpy();
    await expect(
      putFeatureRule(reqFor(1, { rule: edited, ruleId: baseRule.id }), res),
    ).rejects.toThrow("Can only make changes to draft revisions");
  });

  it("an overwrite resubmit (baseline omitted) replaces the conflicting draft rule", async () => {
    const theirEdit: FeatureRule = { ...baseRule, value: "someone-elses" };
    await seed({
      liveRules: [baseRule],
      liveVersion: 1,
      drafts: [{ version: 2, rules: [theirEdit] }],
    });
    const { res, captured } = resSpy();
    await putFeatureRule(reqFor(2, { rule: edited, ruleId: baseRule.id }), res);
    expect(captured.body).toMatchObject({ status: 200, version: 2 });
    const draft = await storedRevision(2);
    expect(draft?.rules?.[0]?.value).toBe("false");
  });
});
