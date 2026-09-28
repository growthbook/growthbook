import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { ExperimentChangesBody } from "shared/validators";
import {
  autoMerge,
  fillRevisionFromFeature,
  liveRevisionFromFeature,
  reconcileMergeBaselines,
} from "shared/util";
import { ReqContextClass } from "back-end/src/services/context";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  featureIdExists,
  getFeature,
  publishRevision,
} from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";
import { getLinkedFeatureInfo } from "back-end/src/services/experiments";
import { applyExperimentChanges } from "back-end/src/services/experimentChanges/applyExperimentChanges";
import { setupApp } from "./api.setup";

let mockWriteExperiment: (() => Promise<never>) | null = null;
jest.mock(
  "back-end/src/services/experimentChanges/planExperimentUpdate",
  () => {
    const actual = jest.requireActual(
      "back-end/src/services/experimentChanges/planExperimentUpdate",
    );
    return {
      ...actual,
      writeExperimentUpdatePlan: (...args: unknown[]) =>
        mockWriteExperiment
          ? mockWriteExperiment()
          : actual.writeExperimentUpdatePlan(...args),
    };
  },
);

const ORG_ID = "org_exp_changes";
const org = {
  id: ORG_ID,
  name: "Experiment Changes",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }, { id: "staging" }] },
} as unknown as OrganizationInterface;

const EXP = "exp_changes";
const FLAG = "flag_changes";
const collection = (name: string) => mongoose.connection.collection(name);
const arms = (a: string, b: string) => [
  { variationId: "v0", value: a },
  { variationId: "v1", value: b },
];
const expRule = (variations: ReturnType<typeof arms>) => ({
  id: "fr_exp",
  type: "experiment-ref",
  experimentId: EXP,
  description: "",
  enabled: true,
  allEnvironments: true,
  variations,
});

async function seed({ withDraft }: { withDraft: boolean }) {
  const date = new Date("2026-01-01T00:00:00Z");
  await collection("experiments").insertOne({
    id: EXP,
    organization: ORG_ID,
    project: "",
    trackingKey: EXP,
    name: EXP,
    type: "standard",
    hypothesis: "old",
    description: "",
    status: "draft",
    archived: false,
    variations: ["v0", "v1"].map((id, i) => ({
      id,
      key: String(i),
      name: id,
      description: "",
      screenshots: [],
    })),
    phases: [
      {
        name: "Main",
        dateStarted: date,
        coverage: 1,
        variationWeights: [0.5, 0.5],
        variations: [
          { id: "v0", status: "active" },
          { id: "v1", status: "active" },
        ],
      },
    ],
    linkedFeatures: [FLAG],
    dateCreated: date,
    dateUpdated: date,
  });
  await collection("features").insertOne({
    id: FLAG,
    organization: ORG_ID,
    owner: "",
    description: "",
    valueType: "string",
    defaultValue: "a",
    version: 1,
    archived: false,
    tags: [],
    rules: [expRule(arms("a", "b"))],
    linkedExperiments: [EXP],
    environmentSettings: { production: { enabled: true, rules: [] } },
    prerequisites: [],
    dateCreated: date,
    dateUpdated: date,
  });
  for (const version of withDraft ? [1, 2] : [1]) {
    await collection("featurerevisions").insertOne({
      id: `frev_${version}`,
      organization: ORG_ID,
      featureId: FLAG,
      version,
      baseVersion: version - 1,
      status: version === 1 ? "published" : "draft",
      createdBy: { type: "api_key", apiKey: "key" },
      comment: "",
      defaultValue: "a",
      rules: [expRule(version === 1 ? arms("a", "b") : arms("a", "draft"))],
      dateCreated: date,
      dateUpdated: date,
      ...(version === 1 ? { datePublished: date } : {}),
    });
  }
}

const LOADED = "2026-01-01T00:00:00.000Z";

async function revisionRules(version: number) {
  const doc = await collection("featurerevisions").findOne({
    featureId: FLAG,
    version,
  });
  return doc?.rules?.[0]?.variations ?? null;
}

async function refRules(status: string) {
  const doc = await collection("featurerevisions").findOne({
    featureId: FLAG,
    status,
  });
  return (doc?.rules ?? []).filter(
    (r: { type: string }) => r.type === "experiment-ref",
  );
}

describe("applyExperimentChanges", () => {
  const { isReady } = setupApp();
  let context: ReqContextClass;

  const run = async (body: ExperimentChangesBody) => {
    const experiment = await getExperimentById(context, EXP);
    if (!experiment) throw new Error("missing experiment");
    return applyExperimentChanges({
      context,
      experiment,
      body,
      audit: async () => undefined,
      eventAudit: { type: "api_key", apiKey: "key" },
    });
  };

  const hypothesisChange = (base: string) => ({
    changes: { hypothesis: "new" },
    base: { hypothesis: base },
  });

  beforeEach(async () => {
    await isReady;
    context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key" },
      role: "admin",
      req: { query: {}, headers: {}, body: {} } as unknown as Request,
    });
    context.hasPremiumFeature = () => true;
  });

  afterEach(() => {
    mockWriteExperiment = null;
  });

  it("writes the flag draft and then the experiment", async () => {
    await seed({ withDraft: true });
    const result = await run({
      experiment: hypothesisChange("old"),
      flagValues: [
        {
          featureId: FLAG,
          variations: arms("a", "new"),
          revision: { version: 2, dateUpdated: LOADED },
        },
      ],
    });
    expect(result.flags).toEqual([{ featureId: FLAG, version: 2 }]);
    expect(result.experiment.hypothesis).toBe("new");
    expect(await revisionRules(2)).toEqual(arms("a", "new"));
  });

  it("re-scopes the rule's environments with the values, switching on what it enters", async () => {
    await seed({ withDraft: true });
    await run({
      flagValues: [
        {
          featureId: FLAG,
          variations: arms("a", "draft"),
          environments: { allEnvironments: false, environments: ["staging"] },
          revision: { version: 2, dateUpdated: LOADED },
        },
      ],
    });
    const draft = await collection("featurerevisions").findOne({
      featureId: FLAG,
      version: 2,
    });
    expect(draft?.rules?.[0]).toMatchObject({
      allEnvironments: false,
      environments: ["staging"],
    });
    expect(draft?.environmentsEnabled).toEqual({ staging: true });
  });

  it("starts a new draft when the values were loaded from live", async () => {
    await seed({ withDraft: false });
    const result = await run({
      flagValues: [
        {
          featureId: FLAG,
          variations: arms("a", "new"),
          revision: { version: 1, dateUpdated: LOADED },
        },
      ],
    });
    expect(result.flags).toEqual([{ featureId: FLAG, version: 2 }]);
    expect(await revisionRules(1)).toEqual(arms("a", "b"));
    expect(await revisionRules(2)).toEqual(arms("a", "new"));
  });

  it("writes a sparse-only change, and refuses a type change on a flag it doesn't manage", async () => {
    await seed({ withDraft: true });
    const entry = {
      featureId: FLAG,
      variations: arms("a", "draft"),
      revision: { version: 2, dateUpdated: LOADED },
    };
    await expect(
      run({ flagValues: [{ ...entry, valueType: "number" }] }),
    ).rejects.toThrow(/only a Feature Flag managed by this experiment/);

    await run({ flagValues: [{ ...entry, sparse: true }] });
    const draft = await collection("featurerevisions").findOne({
      featureId: FLAG,
      version: 2,
    });
    expect(draft?.rules[0]).toMatchObject({
      sparse: true,
      variations: arms("a", "draft"),
    });
  });

  it("repairs loose JSON on a flag it doesn't manage instead of storing it malformed", async () => {
    await seed({ withDraft: true });
    await collection("features").updateOne(
      { id: FLAG },
      { $set: { valueType: "json", defaultValue: "{}" } },
    );
    await run({
      flagValues: [
        {
          featureId: FLAG,
          variations: [
            { variationId: "v0", value: "{}" },
            { variationId: "v1", value: '{"layout":"grid"}}' },
          ],
          revision: { version: 2, dateUpdated: LOADED },
        },
      ],
    });
    const values = await revisionRules(2);
    expect(values.map((v: { value: string }) => JSON.parse(v.value))).toEqual([
      {},
      { layout: "grid" },
    ]);
  });

  it.each([
    [
      "an experiment field",
      {
        experiment: hypothesisChange("something else"),
      },
    ],
    [
      "a flag draft",
      {
        flagValues: [
          {
            featureId: FLAG,
            variations: arms("a", "new"),
            revision: { version: 2, dateUpdated: "2025-12-31T00:00:00.000Z" },
          },
        ],
      },
    ],
  ])(
    "refuses with 409 and writes nothing when %s moved since it was loaded",
    async (_label, body) => {
      await seed({ withDraft: true });
      await expect(run(body)).rejects.toMatchObject({ status: 409 });
      expect(await revisionRules(2)).toEqual(arms("a", "draft"));
      expect((await getExperimentById(context, EXP))?.hypothesis).toBe("old");
    },
  );

  it("rolls the drafts back when the experiment write fails", async () => {
    await seed({ withDraft: true });
    mockWriteExperiment = async () => {
      throw new Error("lost race");
    };
    await expect(
      run({
        experiment: hypothesisChange("old"),
        flagValues: [
          {
            featureId: FLAG,
            variations: arms("a", "new"),
            revision: { version: 2, dateUpdated: LOADED },
          },
        ],
      }),
    ).rejects.toThrow("lost race");
    const draft = await collection("featurerevisions").findOne({
      featureId: FLAG,
      version: 2,
    });
    expect(draft?.rules[0].variations).toEqual(arms("a", "draft"));
    expect(draft?.dateUpdated).toEqual(new Date(LOADED));
  });

  it("deletes a draft it created, and reports a draft someone else edited meanwhile", async () => {
    await seed({ withDraft: false });
    mockWriteExperiment = async () => {
      await collection("featurerevisions").updateOne(
        { featureId: FLAG, version: 2 },
        { $set: { dateUpdated: new Date() } },
      );
      throw new Error("lost race");
    };
    const body = {
      experiment: hypothesisChange("old"),
      flagValues: [
        {
          featureId: FLAG,
          variations: arms("a", "new"),
          revision: { version: 1, dateUpdated: LOADED },
        },
      ],
    };
    // A created draft is deleted by identity, so an edit to it does not block the undo.
    await expect(run(body)).rejects.toThrow("lost race");
    expect(await revisionRules(2)).toBeNull();

    await collection("featurerevisions").insertOne({
      id: "frev_2",
      organization: ORG_ID,
      featureId: FLAG,
      version: 2,
      baseVersion: 1,
      status: "draft",
      createdBy: { type: "api_key", apiKey: "key" },
      comment: "",
      defaultValue: "a",
      rules: [expRule(arms("a", "draft"))],
      dateCreated: new Date(LOADED),
      dateUpdated: new Date(LOADED),
    });
    await expect(
      run({
        ...body,
        flagValues: [
          {
            ...body.flagValues[0],
            revision: { version: 2, dateUpdated: LOADED },
          },
        ],
      }),
    ).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining(`${FLAG} (draft v2)`),
    });
  });

  it("links a flag again with the values sent", async () => {
    await seed({ withDraft: false });
    await run({
      linkFeatures: [{ featureId: FLAG, variations: arms("p", "q") }],
    });
    const added = await refRules("draft");
    expect(added[added.length - 1]?.variations).toEqual(arms("p", "q"));
  });

  it("refuses to link a flag another experiment manages", async () => {
    await seed({ withDraft: false });
    await collection("features").updateOne(
      { id: FLAG },
      {
        $set: { managedBy: { type: "experiment", experimentId: "exp_other" } },
      },
    );
    await expect(
      run({ linkFeatures: [{ featureId: FLAG, variations: arms("p", "q") }] }),
    ).rejects.toThrow(/managed/i);
    expect(await refRules("draft")).toEqual([]);
  });

  describe("removing a flag", () => {
    const publishDraft = async () => {
      const feature = await getFeature(context, FLAG);
      const doc = await collection("featurerevisions").findOne({
        featureId: FLAG,
        status: "draft",
      });
      if (!feature || !doc) throw new Error("missing draft");
      const revision = await getRevision({
        context,
        organization: ORG_ID,
        featureId: FLAG,
        feature,
        version: doc.version,
      });
      if (!revision) throw new Error("missing revision");
      const { live, base } = await getLiveAndBaseRevisionsForFeature({
        context,
        feature,
        revision,
      });
      const baselines = reconcileMergeBaselines(feature, live, base);
      const merge = autoMerge(
        liveRevisionFromFeature(baselines.live, feature),
        fillRevisionFromFeature(baselines.base, feature),
        revision,
        context.environments,
        {},
      );
      if (!merge.success) throw new Error("did not merge");
      await publishRevision({
        context,
        feature,
        revision,
        result: merge.result,
        bypassLockdown: true,
        skipPrevalidateValidation: true,
      });
    };

    it("takes a rule only drafts hold out of them and unlinks at once", async () => {
      await seed({ withDraft: true });
      await collection("features").updateOne(
        { id: FLAG },
        { $set: { rules: [] } },
      );
      await collection("featurerevisions").updateOne(
        { featureId: FLAG, version: 1 },
        { $set: { rules: [] } },
      );

      const result = await run({ unlinkFeatures: [FLAG] });
      expect(result.experiment.linkedFeatures).toEqual([]);
      expect(await refRules("draft")).toEqual([]);
    });

    it("takes a live rule out through a draft and unlinks once it publishes", async () => {
      await seed({ withDraft: false });

      const result = await run({ unlinkFeatures: [FLAG] });
      expect(result.experiment.linkedFeatures).toEqual([FLAG]);
      expect(result.experiment.pendingFeatureUnlinks).toEqual([FLAG]);
      expect(await refRules("draft")).toEqual([]);
      const [info] = await getLinkedFeatureInfo(context, result.experiment);
      expect(info.pendingRemoval?.version).toBe(2);

      await publishDraft();
      const after = await getExperimentById(context, EXP);
      expect(after?.linkedFeatures).toEqual([]);
      expect(after?.pendingFeatureUnlinks).toEqual([]);
    });

    it("starts its own removal draft when a stripped draft never took the live rule out", async () => {
      await seed({ withDraft: true });
      // Draft v2 was cut from v1, which lacked the rule; v3 made it live.
      await collection("featurerevisions").updateOne(
        { featureId: FLAG, version: 1 },
        { $set: { rules: [] } },
      );
      await collection("featurerevisions").insertOne({
        id: "frev_3",
        organization: ORG_ID,
        featureId: FLAG,
        version: 3,
        baseVersion: 2,
        status: "published",
        createdBy: { type: "api_key", apiKey: "key" },
        comment: "",
        defaultValue: "a",
        rules: [expRule(arms("a", "b"))],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        datePublished: new Date(),
      });
      await collection("features").updateOne(
        { id: FLAG },
        { $set: { version: 3 } },
      );

      const result = await run({ unlinkFeatures: [FLAG] });
      const [info] = await getLinkedFeatureInfo(context, result.experiment);
      expect(info.pendingRemoval?.version).toBe(4);
    });

    it("puts the live rule back when the flag is kept, dropping the draft left empty", async () => {
      await seed({ withDraft: false });
      // Every org environment has a setting, as the app keeps them.
      await collection("features").updateOne(
        { id: FLAG },
        {
          $set: {
            environmentSettings: {
              production: { enabled: true, rules: [] },
              staging: { enabled: false, rules: [] },
            },
          },
        },
      );
      await run({ unlinkFeatures: [FLAG] });

      const result = await run({ keepFeatures: [FLAG] });
      expect(result.experiment.pendingFeatureUnlinks).toEqual([]);
      expect(
        (
          await collection("featurerevisions").findOne({
            featureId: FLAG,
            version: 2,
          })
        )?.status,
      ).toBe("discarded");
    });

    it("refuses while the experiment runs", async () => {
      await seed({ withDraft: false });
      await collection("experiments").updateOne(
        { id: EXP },
        { $set: { status: "running" } },
      );
      await expect(run({ unlinkFeatures: [FLAG] })).rejects.toThrow(
        "Set the experiment's status back to Draft to remove this Feature Flag.",
      );
      expect(
        await collection("featurerevisions").countDocuments({
          featureId: FLAG,
          status: "draft",
        }),
      ).toBe(0);
      expect((await getExperimentById(context, EXP))?.linkedFeatures).toEqual([
        FLAG,
      ]);
    });
  });

  it("creates a Values experiment's missing flag with the values it was sent", async () => {
    const date = new Date("2026-01-01T00:00:00Z");
    await collection("experiments").insertOne({
      id: "exp_flagless",
      organization: ORG_ID,
      project: "",
      trackingKey: "flagless-values",
      name: "flagless",
      type: "standard",
      implementationType: "values",
      hypothesis: "",
      description: "",
      status: "draft",
      archived: false,
      variations: ["v0", "v1"].map((id, i) => ({
        id,
        key: String(i),
        name: id,
        description: "",
        screenshots: [],
      })),
      phases: [
        {
          name: "Main",
          dateStarted: date,
          coverage: 1,
          variationWeights: [0.5, 0.5],
          variations: [
            { id: "v0", status: "active" },
            { id: "v1", status: "active" },
          ],
        },
      ],
      linkedFeatures: [],
      dateCreated: date,
      dateUpdated: date,
    });
    const experiment = await getExperimentById(context, "exp_flagless");
    if (!experiment) throw new Error("missing experiment");

    const result = await applyExperimentChanges({
      context,
      experiment,
      body: {
        managedFlag: { valueType: "string", variations: arms("x", "y") },
      },
      audit: async () => undefined,
      eventAudit: { type: "api_key", apiKey: "key" },
    });

    const flag = await collection("features").findOne({
      organization: ORG_ID,
      "managedBy.experimentId": "exp_flagless",
    });
    expect(flag?.id).toBe("flagless-values");
    expect(result.experiment.linkedFeatures).toEqual(["flagless-values"]);
    const draft = await collection("featurerevisions").findOne({
      featureId: "flagless-values",
      status: "draft",
    });
    expect(
      draft?.rules?.find((r: { type: string }) => r.type === "experiment-ref")
        ?.variations,
    ).toEqual(arms("x", "y"));
  });

  it("refuses a holdout change once the experiment has something linked", async () => {
    await seed({ withDraft: false });
    await expect(
      run({
        experiment: {
          changes: { holdoutId: "hld_staged" },
          base: { holdoutId: null },
        },
      }),
    ).rejects.toThrow(
      "A holdout can only change while the experiment is a draft",
    );
    expect(
      (await collection("experiments").findOne({ id: EXP }))?.holdoutId,
    ).toBeUndefined();
  });

  it("adds a variation and its flag value in one save", async () => {
    await seed({ withDraft: false });
    const stored = await getExperimentById(context, EXP);
    if (!stored) throw new Error("missing experiment");
    const variations = [
      ...stored.variations,
      { id: "v2", key: "2", name: "v2", description: "", screenshots: [] },
    ];

    await run({
      experiment: {
        changes: { variations, variationWeights: [0.34, 0.33, 0.33] },
        base: { variations: stored.variations, variationWeights: [0.5, 0.5] },
      },
      flagValues: [
        {
          featureId: FLAG,
          variations: [...arms("a", "b"), { variationId: "v2", value: "c" }],
          revision: { version: 1, dateUpdated: LOADED },
        },
      ],
    });
    expect(
      (await getExperimentById(context, EXP))?.variations.map((v) => v.id),
    ).toEqual(["v0", "v1", "v2"]);
    expect(await revisionRules(2)).toEqual([
      ...arms("a", "b"),
      { variationId: "v2", value: "c" },
    ]);
  });

  it("changes a running bandit's coverage without restarting it, and refuses coverage that moved", async () => {
    await seed({ withDraft: false });
    await collection("experiments").updateOne(
      { id: EXP },
      {
        $set: {
          type: "multi-armed-bandit",
          status: "running",
          linkedFeatures: [],
          banditStage: "exploit",
        },
      },
    );

    await run({
      experiment: { changes: { coverage: 0.4 }, base: { coverage: 1 } },
    });
    const updated = await getExperimentById(context, EXP);
    expect(updated?.phases[0].coverage).toBe(0.4);
    expect(updated?.banditStage).toBe("exploit");

    await expect(
      run({
        experiment: { changes: { coverage: 0.5 }, base: { coverage: 1 } },
      }),
    ).rejects.toThrow("changed since you loaded it");
  });

  it("converts a Values experiment's flag to unmanaged alongside another edit", async () => {
    await seed({ withDraft: false });
    await collection("experiments").updateOne(
      { id: EXP },
      { $set: { implementationType: "values" } },
    );
    await collection("features").updateOne(
      { id: FLAG },
      { $set: { managedBy: { type: "experiment", experimentId: EXP } } },
    );

    const result = await run({
      experiment: {
        changes: { implementationType: "feature", hypothesis: "new" },
        base: { implementationType: "values", hypothesis: "old" },
      },
    });
    expect(result.experiment.hypothesis).toBe("new");
    expect(result.experiment.implementationType).toBe("feature");
    expect(
      (await collection("features").findOne({ id: FLAG }))?.managedBy,
    ).toBeUndefined();
  });

  describe("renaming the managed flag", () => {
    const NEW = "flag_renamed";

    async function seedManaged() {
      await seed({ withDraft: true });
      await collection("experiments").updateOne(
        { id: EXP },
        { $set: { implementationType: "values" } },
      );
      await collection("features").updateOne(
        { id: FLAG },
        { $set: { managedBy: { type: "experiment", experimentId: EXP } } },
      );
      // A legacy revision whose id is built from the flag's id.
      await collection("featurerevisions").updateOne(
        { featureId: FLAG, version: 1 },
        { $set: { id: `frev_1_${FLAG}` } },
      );
      await collection("featurerevisionlog").insertOne({
        id: "frl_1",
        organization: ORG_ID,
        featureId: FLAG,
        version: 2,
      });
      await collection("features").insertOne({
        id: "dependent",
        organization: ORG_ID,
        valueType: "boolean",
        defaultValue: "false",
        rules: [
          {
            id: "fr_dep",
            type: "force",
            prerequisites: [{ id: FLAG, condition: "{}" }],
          },
        ],
        environmentSettings: {},
        prerequisites: [{ id: FLAG, condition: "{}" }],
        dateCreated: new Date(),
        dateUpdated: new Date(),
      });
      await collection("watches").insertOne({
        id: "w1",
        organization: ORG_ID,
        userId: "u1",
        features: [FLAG, "other"],
        experiments: [],
      });
      // Linked later, so stored after FLAG; an all-digit key reads back first.
      await collection("holdouts").insertOne({
        id: "ho_1",
        organization: ORG_ID,
        linkedFeatures: { [FLAG]: { id: FLAG, dateAdded: new Date() } },
        environmentSettings: {},
        dateUpdated: new Date(),
      });
      await collection("holdouts").updateOne(
        { id: "ho_1" },
        {
          $set: {
            "linkedFeatures.1234": { id: "1234", dateAdded: new Date() },
          },
        },
      );
      await collection("discussions").insertOne({
        id: "d1",
        organization: ORG_ID,
        parentType: "feature",
        parentId: FLAG,
        comments: [],
      });
    }

    it("moves the flag and every reference to it", async () => {
      await seedManaged();
      const seededDependentDate = (
        await collection("features").findOne({ id: "dependent" })
      )?.dateUpdated;
      const result = await run({ renameManagedFlag: { to: NEW } });

      expect(result.experiment.linkedFeatures).toEqual([NEW]);
      const flag = await collection("features").findOne({ id: NEW });
      expect(flag?.previousIds).toEqual([FLAG]);
      expect(flag?.renaming).toBeUndefined();
      expect(await collection("features").findOne({ id: FLAG })).toBeNull();

      const revisions = await collection("featurerevisions")
        .find({ organization: ORG_ID })
        .sort({ version: 1 })
        .toArray();
      expect(revisions.map((r) => [r.id, r.featureId])).toEqual([
        [`frev_1_${NEW}`, NEW],
        ["frev_2", NEW],
      ]);
      expect(
        (await collection("featurerevisionlog").findOne({ id: "frl_1" }))
          ?.featureId,
      ).toBe(NEW);

      const dependent = await collection("features").findOne({
        id: "dependent",
      });
      // Advanced, so a writer holding the old value can't put it back.
      expect(dependent?.dateUpdated.getTime()).toBeGreaterThan(
        seededDependentDate.getTime(),
      );
      expect(dependent?.prerequisites).toEqual([{ id: NEW, condition: "{}" }]);
      expect(dependent?.rules[0].prerequisites).toEqual([
        { id: NEW, condition: "{}" },
      ]);
      expect(
        (await collection("watches").findOne({ id: "w1" }))?.features,
      ).toEqual([NEW, "other"]);
      expect(
        (await collection("discussions").findOne({ id: "d1" }))?.parentId,
      ).toBe(NEW);
      expect(
        Object.keys(
          (await collection("holdouts").findOne({ id: "ho_1" }))
            ?.linkedFeatures ?? {},
        ).sort(),
      ).toEqual(["1234", NEW]);

      // Webhooks hear of the new key, and of the dependent's prerequisites.
      const updated = await collection("events")
        .find({ organizationId: ORG_ID, event: "feature.updated" })
        .toArray();
      const byObject = new Map(updated.map((e) => [e.objectId, e.data.data]));
      expect(byObject.get(NEW)?.previous_attributes.id).toBe(FLAG);
      expect(byObject.get("dependent")?.object.prerequisites).toEqual([NEW]);
      expect(
        byObject.get("dependent")?.previous_attributes.prerequisites,
      ).toEqual([FLAG]);
    });

    it("finishes a rename that stopped after the flag moved", async () => {
      await seedManaged();
      const claimedAt = new Date();
      await collection("experiments").updateOne(
        { id: EXP },
        { $addToSet: { linkedFeatures: NEW } },
      );
      await collection("features").updateOne(
        { id: FLAG },
        {
          $set: {
            id: NEW,
            renaming: { from: FLAG, to: NEW, claimedAt },
          },
          $addToSet: { previousIds: FLAG },
        },
      );

      // One revision already moved before the stop, and one left by a
      // deleted flag that held NEW: only the leftover is cleared.
      await collection("featurerevisions").updateOne(
        { featureId: FLAG, version: 2 },
        { $set: { featureId: NEW, dateUpdated: new Date() } },
      );
      await collection("featurerevisions").insertOne({
        id: "frev_leftover",
        organization: ORG_ID,
        featureId: NEW,
        version: 7,
        dateUpdated: new Date("2020-01-01"),
      });

      // Reserved while references still name it.
      expect(await featureIdExists(context, FLAG)).toBe(true);

      const result = await run({ experiment: hypothesisChange("old") });

      expect(result.experiment.linkedFeatures).toEqual([NEW]);
      expect(await featureIdExists(context, FLAG)).toBe(false);
      expect(
        (await collection("features").findOne({ id: NEW }))?.renaming,
      ).toBeUndefined();
      expect(
        await collection("featurerevisions").countDocuments({
          featureId: FLAG,
        }),
      ).toBe(0);
      expect(
        (
          await collection("featurerevisions")
            .find({ featureId: NEW })
            .sort({ version: 1 })
            .toArray()
        ).map((r) => r.version),
      ).toEqual([1, 2]);
    });

    it("refuses a taken key, a rename beside a type change or unlink, and a flag the experiment doesn't manage, before writing", async () => {
      await seedManaged();
      await expect(
        run({
          experiment: hypothesisChange("old"),
          renameManagedFlag: { to: "dependent" },
        }),
      ).rejects.toThrow('Feature Flag "dependent" already exists.');
      expect(
        (await collection("experiments").findOne({ id: EXP }))?.hypothesis,
      ).toBe("old");

      await expect(
        run({
          experiment: {
            changes: { implementationType: "none" },
            base: { implementationType: "values" },
          },
          deleteManagedFlag: true,
          renameManagedFlag: { to: NEW },
        }),
      ).rejects.toThrow("not both in one save");
      await expect(
        run({ unlinkFeatures: [FLAG], renameManagedFlag: { to: NEW } }),
      ).rejects.toThrow("not both in one save");
      expect(await collection("features").findOne({ id: FLAG })).not.toBeNull();

      await collection("features").updateOne(
        { id: FLAG },
        { $unset: { managedBy: "" } },
      );
      await expect(run({ renameManagedFlag: { to: NEW } })).rejects.toThrow(
        "This experiment does not manage a Feature Flag.",
      );
      expect(await collection("features").findOne({ id: NEW })).toBeNull();
    });
  });
});
