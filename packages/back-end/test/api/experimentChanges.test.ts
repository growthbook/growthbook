import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { ApiKeyInterface } from "shared/types/apikey";
import type { AuditInterfaceInput } from "shared/types/audit";
import type { ExperimentChangesBody } from "shared/validators";
import {
  autoMerge,
  fillRevisionFromFeature,
  liveRevisionFromFeature,
  reconcileMergeBaselines,
} from "shared/util";
import { ReqContextClass } from "back-end/src/services/context";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";
import { getLinkedFeatureInfo } from "back-end/src/services/experiments";
import { applyExperimentChanges } from "back-end/src/services/experimentChanges/applyExperimentChanges";
import { planExperimentUpdate } from "back-end/src/services/experimentChanges/planExperimentUpdate";
import { setupApp } from "./api.setup";

// Stands in for the experiment write; `write` runs the real one.
let mockWriteExperiment:
  | ((write: () => Promise<unknown>) => Promise<unknown>)
  | null = null;
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
          ? mockWriteExperiment(() => actual.writeExperimentUpdatePlan(...args))
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
const variation = (id: string, i: number) => ({
  id,
  key: String(i),
  name: id,
  description: "",
  screenshots: [],
});
const seededVariations = () => [variation("v0", 0), variation("v1", 1)];
const seededPhases = (dateStarted: Date) => [
  {
    name: "Main",
    dateStarted,
    coverage: 1,
    variationWeights: [0.5, 0.5],
    variations: [
      { id: "v0", status: "active" },
      { id: "v1", status: "active" },
    ],
  },
];
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
    variations: seededVariations(),
    phases: seededPhases(date),
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
    await collection("featurerevisions").insertOne(revisionDoc(version, date));
  }
}

function revisionDoc(version: number, date: Date) {
  return {
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
  };
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

  const run = async (
    body: ExperimentChangesBody,
    audit: (data: AuditInterfaceInput) => Promise<void> = async () => undefined,
  ) => {
    const experiment = await getExperimentById(context, EXP);
    if (!experiment) throw new Error("missing experiment");
    return applyExperimentChanges({
      context,
      experiment,
      body,
      audit,
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

  it("refuses to start a draft through a plain field write", async () => {
    await seed({ withDraft: false });
    const experiment = await getExperimentById(context, EXP);
    if (!experiment) throw new Error("missing experiment");
    await expect(
      planExperimentUpdate(context, experiment, { status: "running" }),
    ).rejects.toThrow("Start this experiment instead");
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

  it.each([
    ["a bandit's values save", "multi-armed-bandit", null],
    [
      "a standard experiment's are refused",
      "standard",
      "variations and variationWeights must be the same length.",
    ],
  ])(
    "%s though its phase has no weights",
    async (description, type, refusal) => {
      await seed({ withDraft: true });
      await collection("experiments").updateOne(
        { id: EXP },
        { $set: { type, "phases.0.variationWeights": [] } },
      );
      const save = run({
        flagValues: [
          {
            featureId: FLAG,
            variations: arms("a", "new"),
            revision: { version: 2, dateUpdated: LOADED },
          },
        ],
      });
      if (refusal) {
        await expect(save).rejects.toThrow(refusal);
      } else {
        await save;
        expect(await revisionRules(2)).toEqual(arms("a", "new"));
      }
    },
  );

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

  it("writes a sparse-only change", async () => {
    await seed({ withDraft: true });
    await run({
      flagValues: [
        {
          featureId: FLAG,
          variations: arms("a", "draft"),
          sparse: true,
          revision: { version: 2, dateUpdated: LOADED },
        },
      ],
    });
    const draft = await collection("featurerevisions").findOne({
      featureId: FLAG,
      version: 2,
    });
    expect(draft?.rules[0]).toMatchObject({
      sparse: true,
      variations: arms("a", "draft"),
    });
  });

  it("repairs loose JSON instead of storing it malformed", async () => {
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

    await collection("featurerevisions").insertOne(
      revisionDoc(2, new Date(LOADED)),
    );
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

  describe("when the organization requires scoped rules", () => {
    const requireScoped = (body: Record<string, unknown> = {}) => {
      context = new ReqContextClass({
        org: {
          ...org,
          settings: { ...org.settings, requireScopedFeatureRules: true },
        },
        auditUser: { type: "api_key", apiKey: "key" },
        role: "admin",
        req: { query: {}, headers: {}, body } as unknown as Request,
      });
      context.hasPremiumFeature = () => true;
    };

    it("refuses widening a rule to every environment unless the save allows it", async () => {
      await seed({ withDraft: true });
      await collection("featurerevisions").updateOne(
        { featureId: FLAG, version: 2 },
        {
          $set: {
            "rules.0.allEnvironments": false,
            "rules.0.environments": ["staging"],
          },
        },
      );
      const body: ExperimentChangesBody = {
        flagValues: [
          {
            featureId: FLAG,
            variations: arms("a", "wide"),
            environments: { allEnvironments: true, environments: [] },
            revision: { version: 2, dateUpdated: LOADED },
          },
        ],
      };
      requireScoped();
      await expect(run(body)).rejects.toMatchObject({ code: "unscoped_rule" });
      expect(await revisionRules(2)).toEqual(arms("a", "draft"));

      requireScoped({ allowUnscopedRules: true });
      await run({ ...body, allowUnscopedRules: true });
      expect(await revisionRules(2)).toEqual(arms("a", "wide"));
    });

    it("refuses linking a flag again everywhere before writing anything, unless the save allows it", async () => {
      await seed({ withDraft: false });
      const body: ExperimentChangesBody = {
        experiment: hypothesisChange("old"),
        linkFeatures: [{ featureId: FLAG, variations: arms("p", "q") }],
      };
      requireScoped();
      await expect(run(body)).rejects.toMatchObject({ code: "unscoped_rule" });
      expect((await getExperimentById(context, EXP))?.hypothesis).toBe("old");

      requireScoped({ allowUnscopedRules: true });
      await run({ ...body, allowUnscopedRules: true });
      const added = await refRules("draft");
      expect(added[added.length - 1]?.variations).toEqual(arms("p", "q"));
    });
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
    const variations = [...stored.variations, variation("v2", 2)];

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

  describe("URL Redirects and Visual Editor changes", () => {
    const A = "https://a.example.com";
    const B = "https://b.example.com";
    const destinations = (origin: string, ids = ["v0", "v1"]) =>
      ids.map((variation) => ({ variation, url: `${origin}/${variation}` }));
    const staged = (
      urlPattern: string,
      extra: Partial<
        NonNullable<ExperimentChangesBody["addUrlRedirects"]>[number]
      > = {},
    ) => ({
      urlPattern,
      destinationURLs: destinations(urlPattern),
      persistQueryString: false,
      checkCircularDependencies: false,
      ...extra,
    });
    const loadedChange = {
      id: "vc0",
      variation: "v0",
      description: "",
      css: "",
      domMutations: [],
    };
    const editVc0 = {
      id: "vcs_1",
      changes: {
        visualChanges: [{ id: "vc0", css: "body{}", js: "", domMutations: [] }],
      },
      base: { visualChanges: [loadedChange] },
    };
    const swapV1ForV2 = () => ({
      changes: {
        variations: [variation("v0", 0), variation("v2", 2)],
        variationWeights: [0.5, 0.5],
      },
      base: { variations: seededVariations(), variationWeights: [0.5, 0.5] },
    });

    async function seedLinked(status = "draft") {
      await seed({ withDraft: false });
      await collection("experiments").updateOne(
        { id: EXP },
        { $set: { linkedFeatures: [], status } },
      );
    }
    // Raw writes, so no model cache holds what a later save reads.
    async function seedRedirect(id: string, urlPattern: string) {
      await collection("urlredirects").insertOne({
        id,
        organization: ORG_ID,
        experiment: EXP,
        urlPattern,
        destinationURLs: destinations(urlPattern),
        persistQueryString: false,
        dateCreated: new Date(LOADED),
        dateUpdated: new Date(LOADED),
      });
      await collection("experiments").updateOne(
        { id: EXP },
        { $set: { hasURLRedirects: true } },
      );
    }
    async function seedChangeset() {
      await collection("visualchangesets").insertOne({
        id: "vcs_1",
        organization: ORG_ID,
        experiment: EXP,
        editorUrl: A,
        urlPatterns: [{ include: true, type: "simple", pattern: A }],
        visualChanges: [
          loadedChange,
          { ...loadedChange, id: "vc1", variation: "v1", css: ".loaded{}" },
        ],
      });
      await collection("experiments").updateOne(
        { id: EXP },
        { $set: { hasVisualChangesets: true } },
      );
    }
    const storedRedirects = () =>
      collection("urlredirects")
        .find({}, { projection: { _id: 0 } })
        .toArray();
    const storedVisualChanges = async () =>
      (
        await collection("visualchangesets").findOne({ id: "vcs_1" })
      )?.visualChanges.map(
        (c: { variation: string; css: string; js?: string }) => [
          c.variation,
          c.css,
          c.js,
        ],
      );

    it("removes the last URL Redirect and adds one for the variations the save leaves", async () => {
      await seedLinked();
      await seedRedirect("url_a", A);

      const result = await run({
        experiment: swapV1ForV2(),
        removeUrlRedirects: ["url_a"],
        addUrlRedirects: [
          staged(B, { destinationURLs: destinations(B, ["v0", "v2"]) }),
        ],
      });

      expect(await storedRedirects()).toEqual([
        expect.objectContaining({
          urlPattern: B,
          destinationURLs: destinations(B, ["v0", "v2"]),
        }),
      ]);
      expect(result.experiment.hasURLRedirects).toBe(true);
    });

    // Not admin: an admin role ignores an environment limit.
    const limitedTo = (environments: string[]) => {
      context = new ReqContextClass({
        org,
        auditUser: { type: "api_key", apiKey: "key" },
        role: "experimenter",
        apiKeyData: {
          role: "experimenter",
          limitAccessByEnvironment: true,
          environments,
        } as ApiKeyInterface,
        req: { query: {}, headers: {}, body: {} } as unknown as Request,
      });
      context.hasPremiumFeature = () => true;
    };

    it("adds a first URL Redirect for someone who can run the experiment in every environment", async () => {
      await seedLinked();
      limitedTo(["production", "staging"]);

      const result = await run({ addUrlRedirects: [staged(A)] });

      expect(await storedRedirects()).toEqual([
        expect.objectContaining({
          urlPattern: A,
          destinationURLs: destinations(A),
        }),
      ]);
      expect(result.experiment).toMatchObject({ hasURLRedirects: true });
    });

    it("edits a URL Redirect and a Visual Editor change in a save that swaps a variation", async () => {
      await seedLinked();
      await seedRedirect("url_a", A);
      await seedChangeset();

      await run({
        experiment: swapV1ForV2(),
        editUrlRedirects: [
          {
            ...staged(A, { destinationURLs: destinations(A, ["v0", "v2"]) }),
            id: "url_a",
            dateUpdated: LOADED,
          },
        ],
        editVisualChangesets: [editVc0],
      });

      expect(await storedRedirects()).toEqual([
        expect.objectContaining({
          id: "url_a",
          destinationURLs: destinations(A, ["v0", "v2"]),
        }),
      ]);
      // Written over the synced changeset, so v2's new entry is kept.
      expect(await storedVisualChanges()).toEqual([
        ["v0", "body{}", ""],
        ["v2", "", undefined],
      ]);
    });

    it("refuses a Visual Editor edit made stale during the save before writing any URL Redirect", async () => {
      await seedLinked();
      await seedChangeset();
      mockWriteExperiment = async (write) => {
        await collection("visualchangesets").updateOne(
          { id: "vcs_1" },
          { $set: { "visualChanges.0.css": ".extension{}" } },
        );
        return write();
      };

      await expect(
        run({
          experiment: hypothesisChange("old"),
          addUrlRedirects: [staged(A)],
          editVisualChangesets: [editVc0],
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await storedRedirects()).toEqual([]);
      expect(await storedVisualChanges()).toEqual([
        ["v0", ".extension{}", undefined],
        ["v1", ".loaded{}", undefined],
      ]);
    });

    it.each([
      [
        "a URL Redirect edited since it was loaded",
        () => seedRedirect("url_a", A),
        {
          editUrlRedirects: [
            {
              ...staged(A),
              id: "url_a",
              dateUpdated: "2025-12-31T00:00:00.000Z",
            },
          ],
        },
        { status: 409, message: `The URL Redirect from ${A} changed since` },
      ],
      [
        "two staged URL Redirects that chain",
        async () => undefined,
        {
          addUrlRedirects: [
            staged(A, {
              destinationURLs: [
                { variation: "v0", url: B },
                { variation: "v1", url: `${A}/v1` },
              ],
              checkCircularDependencies: true,
            }),
            staged(B),
          ],
        },
        {
          status: 400,
          message: `A destination of the URL Redirect from ${A} matches the origin of the one from ${B}.`,
        },
      ],
      [
        "a URL Redirect missing a variation's destination",
        async () => undefined,
        {
          addUrlRedirects: [
            staged(A, { destinationURLs: destinations(A, ["v0"]) }),
          ],
        },
        { status: 400, message: "needs one destination for each variation" },
      ],
      [
        "a URL Redirect keeping a destination for a variation the save removes",
        async () => undefined,
        {
          experiment: swapV1ForV2(),
          addUrlRedirects: [
            staged(A, { destinationURLs: destinations(A, ["v0", "v1", "v2"]) }),
          ],
        },
        { status: 400, message: "needs one destination for each variation" },
      ],
      [
        "a Visual Editor edit for a variation the save removes",
        seedChangeset,
        {
          experiment: swapV1ForV2(),
          editVisualChangesets: [
            {
              id: "vcs_1",
              changes: {
                visualChanges: [
                  { id: "vc1", css: "x", js: "", domMutations: [] },
                ],
              },
              base: {
                visualChanges: [
                  {
                    ...loadedChange,
                    id: "vc1",
                    variation: "v1",
                    css: ".loaded{}",
                  },
                ],
              },
            },
          ],
        },
        { status: 400, message: "edits a variation this save removes" },
      ],
      [
        "a URL Redirect on a running experiment",
        () =>
          collection("experiments")
            .updateOne({ id: EXP }, { $set: { status: "running" } })
            .then(() => undefined),
        { addUrlRedirects: [staged(A)] },
        { status: 400, message: "only change while the experiment is a draft" },
      ],
      [
        "a first URL Redirect from someone who can run the experiment in only some environments",
        async () => limitedTo(["staging"]),
        { addUrlRedirects: [staged(A)] },
        { status: 403, message: "" },
      ],
    ] as [
      string,
      () => Promise<void>,
      ExperimentChangesBody,
      { status: number; message: string },
    ][])(
      "refuses %s before writing anything",
      async (_label, setup, body, { status, message }) => {
        await seedLinked();
        await setup();
        const stored = async () => ({
          experiment: await collection("experiments").findOne({ id: EXP }),
          redirects: await storedRedirects(),
          visualChanges: await storedVisualChanges(),
        });
        const before = await stored();
        await expect(
          run({ experiment: hypothesisChange("old"), ...body }),
        ).rejects.toMatchObject({
          status,
          message: expect.stringContaining(message),
        });
        expect(await stored()).toEqual(before);
      },
    );

    it("checks everything in a dry run and writes nothing", async () => {
      await seedLinked();
      const body = {
        experiment: hypothesisChange("old"),
        addUrlRedirects: [staged(A)],
        dryRun: true,
      };
      expect((await run(body)).dryRun).toBe(true);
      await expect(
        run({
          ...body,
          addUrlRedirects: [
            staged(A, { checkCircularDependencies: true }),
            staged(`${A}/v0`),
          ],
        }),
      ).rejects.toThrow(`matches the origin of the one from ${A}/v0.`);
      expect(await storedRedirects()).toEqual([]);
      expect((await getExperimentById(context, EXP))?.hypothesis).toBe("old");
    });

    it("edits one variation's Visual Editor changes on a stopped experiment, keeping the others as the Visual Editor left them", async () => {
      await seedLinked("stopped");
      await seedChangeset();
      // The Visual Editor writes to another variation after the page loaded.
      await collection("visualchangesets").updateOne(
        { id: "vcs_1" },
        { $set: { "visualChanges.1.css": ".extension{}" } },
      );
      const audit = jest.fn(async () => undefined);

      await run({ editVisualChangesets: [editVc0] }, audit);
      expect(await storedVisualChanges()).toEqual([
        ["v0", "body{}", ""],
        ["v1", ".extension{}", undefined],
      ]);
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "experiment.update",
          entity: { object: "experiment", id: EXP },
        }),
      );

      // Its own base is stale now.
      await expect(
        run({ editVisualChangesets: [editVc0] }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("rules that disagree", () => {
    const groupRule = (
      id: string,
      environment: string,
      variations: ReturnType<typeof arms>,
    ) => ({
      ...expRule(variations),
      id,
      allEnvironments: false,
      environments: [environment],
    });
    const splitRules = [
      groupRule("fr_prod", "production", arms("a", "b")),
      groupRule("fr_stage", "staging", arms("a", "c")),
    ];
    const LIVE = { version: 1, dateUpdated: null };

    async function seedSplit() {
      await seed({ withDraft: false });
      await collection("features").updateOne(
        { id: FLAG },
        {
          $set: {
            rules: splitRules,
            environmentSettings: {
              production: { enabled: true, rules: [] },
              staging: { enabled: true, rules: [] },
            },
          },
        },
      );
      await collection("featurerevisions").updateOne(
        { featureId: FLAG, version: 1 },
        { $set: { rules: splitRules } },
      );
    }

    const draftValuesByRule = async () =>
      Object.fromEntries(
        (await refRules("draft")).map(
          (r: { id: string; variations: ReturnType<typeof arms> }) => [
            r.id,
            r.variations,
          ],
        ),
      );

    it("shows each set of values as its own group", async () => {
      await seedSplit();
      const experiment = await getExperimentById(context, EXP);
      if (!experiment) throw new Error("missing experiment");
      const [info] = await getLinkedFeatureInfo(context, experiment, {
        includeValueGroups: true,
      });
      expect(info.inconsistentValues).toBe(true);
      expect(
        info.valueGroups?.map((g) => ({
          ruleIds: g.ruleIds,
          environments: g.environments,
          values: g.values,
          inconsistentValues: g.inconsistentValues,
        })),
      ).toEqual([
        {
          ruleIds: ["fr_prod"],
          environments: ["production"],
          values: arms("a", "b"),
          inconsistentValues: false,
        },
        {
          ruleIds: ["fr_stage"],
          environments: ["staging"],
          values: arms("a", "c"),
          inconsistentValues: false,
        },
      ]);

      const [plain] = await getLinkedFeatureInfo(context, experiment);
      expect(plain.valueGroups).toBeUndefined();
    });

    it("writes each group's values to its own rules, in one draft", async () => {
      await seedSplit();
      const result = await run({
        flagValues: [
          {
            featureId: FLAG,
            ruleIds: ["fr_prod"],
            variations: arms("a", "prod"),
            revision: LIVE,
          },
          {
            featureId: FLAG,
            ruleIds: ["fr_stage"],
            variations: arms("a", "stage"),
            revision: LIVE,
          },
        ],
      });
      expect(result.flags).toEqual([{ featureId: FLAG, version: 2 }]);
      expect(await draftValuesByRule()).toEqual({
        fr_prod: arms("a", "prod"),
        fr_stage: arms("a", "stage"),
      });
    });

    it("leaves the other group's rules alone", async () => {
      await seedSplit();
      await run({
        flagValues: [
          {
            featureId: FLAG,
            ruleIds: ["fr_stage"],
            variations: arms("a", "stage"),
            revision: LIVE,
          },
        ],
      });
      expect(await draftValuesByRule()).toEqual({
        fr_prod: arms("a", "b"),
        fr_stage: arms("a", "stage"),
      });
    });

    it.each([
      [
        "without naming the rules",
        [{ featureId: FLAG, variations: arms("a", "x"), revision: LIVE }],
        "variation values must be identical",
      ],
      [
        "twice without separate groups",
        [
          { featureId: FLAG, variations: arms("a", "x"), revision: LIVE },
          { featureId: FLAG, variations: arms("a", "y"), revision: LIVE },
        ],
        "only to set values for separate groups",
      ],
      [
        "with a rule in two groups",
        [
          {
            featureId: FLAG,
            ruleIds: ["fr_prod"],
            variations: arms("a", "x"),
            revision: LIVE,
          },
          {
            featureId: FLAG,
            ruleIds: ["fr_prod", "fr_stage"],
            variations: arms("a", "y"),
            revision: LIVE,
          },
        ],
        "is in more than one group",
      ],
      [
        "re-scoping environments for some of the rules",
        [
          {
            featureId: FLAG,
            ruleIds: ["fr_prod"],
            variations: arms("a", "x"),
            environments: { allEnvironments: true, environments: [] },
            revision: LIVE,
          },
        ],
        "environments can only change for all",
      ],
    ])("refuses values %s", async (description, flagValues, message) => {
      await seedSplit();
      await expect(run({ flagValues })).rejects.toThrow(message);
      expect(await refRules("draft")).toEqual([]);
    });
  });
});
