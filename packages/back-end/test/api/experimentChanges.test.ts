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
import { removeRulesForDeletedExperiment } from "back-end/src/services/experiment-feature";
import { applyExperimentChanges } from "back-end/src/services/experimentChanges/applyExperimentChanges";
import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import { planExperimentUpdate } from "back-end/src/services/experimentChanges/planExperimentUpdate";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/enterprise/sandbox/sandbox-pool", () => ({
  runInSandbox: jest.fn(),
}));

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
// The flag with this experiment's rule gone, live and in every revision.
const dropRule = async () => {
  await collection("features").updateOne({ id: FLAG }, { $set: { rules: [] } });
  await collection("featurerevisions").updateMany(
    { featureId: FLAG },
    { $set: { rules: [] } },
  );
};
const setExperiment = (fields: Record<string, unknown>) =>
  collection("experiments").updateOne({ id: EXP }, { $set: fields });
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

// The sandbox mock answers for it.
const seedRevisionHook = () =>
  collection("customhooks").insertOne({
    id: "hook_revisions",
    organization: ORG_ID,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    enabled: true,
    projects: [],
    name: "Judges drafts",
    hook: "validateFeatureRevision",
    code: "",
  });

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

const storedRevision = (version: number) =>
  collection("featurerevisions").findOne({ featureId: FLAG, version });

async function revisionRules(version: number) {
  return (await storedRevision(version))?.rules?.[0]?.variations ?? null;
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

  const storedExperiment = async () => {
    const experiment = await getExperimentById(context, EXP);
    if (!experiment) throw new Error("missing experiment");
    return experiment;
  };

  const run = async (
    body: ExperimentChangesBody,
    audit: (data: AuditInterfaceInput) => Promise<void> = async () => undefined,
  ) =>
    applyExperimentChanges({
      context,
      experiment: await storedExperiment(),
      body,
      audit,
      eventAudit: { type: "api_key", apiKey: "key" },
    });

  const removeForDeletedExperiment = async () => {
    const feature = await getFeature(context, FLAG);
    if (!feature) throw new Error("missing feature");
    return removeRulesForDeletedExperiment({
      context,
      experiment: await storedExperiment(),
      features: [feature],
      eventAudit: { type: "api_key", apiKey: "key" },
      audit: async () => undefined,
    });
  };

  const hypothesisChange = (base: string) => ({
    changes: { hypothesis: "new" },
    base: { hypothesis: base },
  });
  const draftValues = (
    variations: ReturnType<typeof arms>,
    extra: Partial<
      NonNullable<ExperimentChangesBody["flagValues"]>[number]
    > = {},
  ) => ({
    featureId: FLAG,
    variations,
    revision: { version: 2, dateUpdated: LOADED },
    ...extra,
  });

  const makeContext = ({
    settings = {},
    role = "admin",
    apiKeyData,
    body = {},
  }: {
    settings?: OrganizationInterface["settings"];
    role?: string;
    apiKeyData?: ApiKeyInterface;
    body?: Record<string, unknown>;
  } = {}) => {
    const made = new ReqContextClass({
      org: { ...org, settings: { ...org.settings, ...settings } },
      auditUser: { type: "api_key", apiKey: "key" },
      role,
      apiKeyData,
      req: { query: {}, headers: {}, body } as unknown as Request,
    });
    made.hasPremiumFeature = () => true;
    return made;
  };

  beforeEach(async () => {
    await isReady;
    context = makeContext();
  });

  afterEach(() => {
    mockWriteExperiment = null;
  });

  it("refuses to start a draft through a plain field write", async () => {
    await seed({ withDraft: false });
    await expect(
      planExperimentUpdate(context, await storedExperiment(), {
        status: "running",
      }),
    ).rejects.toThrow("Start this experiment instead");
  });

  it("writes the flag draft and then the experiment", async () => {
    await seed({ withDraft: true });
    const result = await run({
      experiment: hypothesisChange("old"),
      flagValues: [draftValues(arms("a", "new"))],
    });
    expect(result.flags).toEqual([{ featureId: FLAG, version: 2 }]);
    expect(result.experiment.hypothesis).toBe("new");
    expect(await revisionRules(2)).toEqual(arms("a", "new"));
  });

  it("re-scopes the rule's environments with the values, switching on what it enters", async () => {
    await seed({ withDraft: true });
    await run({
      flagValues: [
        draftValues(arms("a", "draft"), {
          environments: { allEnvironments: false, environments: ["staging"] },
        }),
      ],
    });
    const draft = await storedRevision(2);
    expect(draft?.rules?.[0]).toMatchObject({
      allEnvironments: false,
      environments: ["staging"],
    });
    expect(draft?.environmentsEnabled).toEqual({ staging: true });
  });

  it.each([
    {
      name: "a bandit's values save",
      type: "multi-armed-bandit",
      refusal: null,
    },
    {
      name: "a standard experiment's are refused",
      type: "standard",
      refusal: "variations and variationWeights must be the same length.",
    },
  ])("$name though its phase has no weights", async ({ type, refusal }) => {
    await seed({ withDraft: true });
    await setExperiment({ type, "phases.0.variationWeights": [] });
    const save = run({ flagValues: [draftValues(arms("a", "new"))] });
    if (refusal) {
      await expect(save).rejects.toThrow(refusal);
    } else {
      await save;
      expect(await revisionRules(2)).toEqual(arms("a", "new"));
    }
  });

  it("saves values though the stored weights don't add up to 100%", async () => {
    await seed({ withDraft: true });
    await setExperiment({ "phases.0.variationWeights": [0.53, 0.5] });
    await run({ flagValues: [draftValues(arms("a", "new"))] });
    expect(await revisionRules(2)).toEqual(arms("a", "new"));
  });

  it("refuses values saved with weights that don't add up to 100%, leaving the draft", async () => {
    await seed({ withDraft: true });
    const before = await revisionRules(2);
    await expect(
      run({
        experiment: {
          changes: { variationWeights: [0.6, 0.6] },
          base: { variationWeights: [0.5, 0.5] },
        },
        flagValues: [draftValues(arms("a", "new"))],
      }),
    ).rejects.toThrow("invalid_variation_weights");
    expect(await revisionRules(2)).toEqual(before);
  });

  it("refuses weights that don't add up to 100% in a dry run", async () => {
    await seed({ withDraft: true });
    await expect(
      run({
        experiment: {
          changes: { variationWeights: [0.6, 0.6] },
          base: { variationWeights: [0.5, 0.5] },
        },
        flagValues: [draftValues(arms("a", "new"))],
        dryRun: true,
      }),
    ).rejects.toThrow("invalid_variation_weights");
  });

  it("writes a sparse-only change", async () => {
    await seed({ withDraft: true });
    await run({
      flagValues: [draftValues(arms("a", "draft"), { sparse: true })],
    });
    const draft = await storedRevision(2);
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
    await run({ flagValues: [draftValues(arms("{}", '{"layout":"grid"}}'))] });
    const values = await revisionRules(2);
    expect(values.map((v: { value: string }) => JSON.parse(v.value))).toEqual([
      {},
      { layout: "grid" },
    ]);
  });

  const valuesFrom = (dateUpdated: string) => ({
    flagValues: [
      draftValues(arms("a", "new"), { revision: { version: 2, dateUpdated } }),
    ],
  });
  it.each([
    {
      name: "an experiment field",
      body: { experiment: hypothesisChange("something else") },
      details: { fields: ["hypothesis"], featureIds: [] },
    },
    {
      name: "a flag draft",
      body: valuesFrom("2025-12-31T00:00:00.000Z"),
      details: { fields: [], featureIds: [FLAG] },
    },
    {
      name: "a flag draft published since",
      publish: true,
      body: valuesFrom(LOADED),
      details: { fields: [], featureIds: [FLAG] },
    },
    {
      name: "a targeting field",
      stored: { "phases.0.condition": '{"country":"CA"}' },
      body: {
        experiment: {
          changes: { condition: '{"country":"US"}' },
          base: { condition: "" },
        },
      },
      details: { fields: ["condition"], featureIds: [] },
    },
  ])(
    "names what moved and writes nothing when $name changed since it was loaded",
    async ({ body, details, publish, stored }) => {
      await seed({ withDraft: true });
      if (stored) {
        await setExperiment(stored);
      }
      if (publish) {
        await collection("featurerevisions").updateOne(
          { featureId: FLAG, version: 2 },
          { $set: { status: "published" } },
        );
        await collection("features").updateOne(
          { id: FLAG },
          { $set: { version: 2 } },
        );
      }
      await expect(run(body)).rejects.toMatchObject({
        status: 409,
        code: "changes_conflict",
        details,
      });
      expect(await revisionRules(2)).toEqual(arms("a", "draft"));
      expect((await storedExperiment()).hypothesis).toBe("old");
    },
  );

  it("takes a field stored in another shape of the same value", async () => {
    await seed({ withDraft: false });
    // As another endpoint writes it: its own key order and empty fields.
    await setExperiment({
      variations: seededVariations().map(({ id, key, name }) => ({
        screenshots: [],
        dom: [],
        name,
        key,
        id,
      })),
    });
    await run({
      experiment: {
        changes: {
          variations: seededVariations().map((v) => ({ ...v, name: "new" })),
        },
        base: { variations: seededVariations() },
      },
    });
    expect((await storedExperiment()).variations.map((v) => v.name)).toEqual([
      "new",
      "new",
    ]);
  });

  it("refuses a variation added without a split for it", async () => {
    await seed({ withDraft: false });
    await expect(
      run({
        experiment: {
          changes: {
            variations: [...seededVariations(), variation("v2", 2)],
          },
          base: { variations: seededVariations() },
        },
      }),
    ).rejects.toThrow("one weight per variation");
  });

  it("rolls the drafts back when the experiment write fails", async () => {
    await seed({ withDraft: true });
    mockWriteExperiment = async () => {
      throw new Error("lost race");
    };
    await expect(
      run({
        experiment: hypothesisChange("old"),
        flagValues: [draftValues(arms("a", "new"))],
      }),
    ).rejects.toThrow("lost race");
    expect(await revisionRules(2)).toEqual(arms("a", "draft"));
    expect((await storedRevision(2))?.dateUpdated).toEqual(new Date(LOADED));
  });

  it("deletes a draft it created, and leaves and reports a draft someone else edited meanwhile", async () => {
    await seed({ withDraft: false });
    const body = {
      experiment: hypothesisChange("old"),
      flagValues: [
        draftValues(arms("a", "new"), {
          revision: { version: 1, dateUpdated: null },
        }),
      ],
    };
    mockWriteExperiment = async () => {
      throw new Error("lost race");
    };
    await expect(run(body)).rejects.toThrow("lost race");
    expect(await revisionRules(2)).toBeNull();

    mockWriteExperiment = async () => {
      await collection("featurerevisions").updateOne(
        { featureId: FLAG, version: 2 },
        { $set: { dateUpdated: new Date() } },
      );
      throw new Error("lost race");
    };
    await expect(run(body)).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining(`${FLAG} (draft v2)`),
    });
    expect(await revisionRules(2)).toEqual(arms("a", "new"));

    await collection("featurerevisions").deleteOne({
      featureId: FLAG,
      version: 2,
    });
    await collection("featurerevisions").insertOne(
      revisionDoc(2, new Date(LOADED)),
    );
    await expect(
      run({ ...body, flagValues: [draftValues(arms("a", "new"))] }),
    ).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining(`${FLAG} (draft v2)`),
    });
  });

  it("links a flag again with the values sent, once its rule is gone", async () => {
    await seed({ withDraft: false });
    const body: ExperimentChangesBody = {
      linkFeatures: [{ featureId: FLAG, variations: arms("p", "q") }],
    };
    await expect(run(body)).rejects.toThrow(
      `${FLAG} is already linked to this experiment.`,
    );
    await dropRule();
    await run(body);
    const added = await refRules("draft");
    expect(added[added.length - 1]?.variations).toEqual(arms("p", "q"));
  });

  it("links a flag again past a draft that only carries its old rule", async () => {
    await seed({ withDraft: true });
    const date = new Date("2026-01-01T00:00:00Z");
    // v3 took the rule out and published; v2 still has it, as its base did.
    await collection("featurerevisions").updateOne(
      { featureId: FLAG, version: 2 },
      { $set: { rules: [expRule(arms("a", "b"))] } },
    );
    await collection("featurerevisions").insertOne({
      ...revisionDoc(3, date),
      baseVersion: 1,
      status: "published",
      rules: [],
      datePublished: date,
    });
    await collection("features").updateOne(
      { id: FLAG },
      { $set: { rules: [], version: 3 } },
    );
    await run({
      linkFeatures: [{ featureId: FLAG, variations: arms("p", "q") }],
    });
  });

  it("shows validation hooks the person saving as the author of a flag's new draft", async () => {
    await seed({ withDraft: false });
    await dropRule();
    await collection("featurerevisions").updateOne(
      { featureId: FLAG, version: 1 },
      { $set: { createdBy: { type: "api_key", apiKey: "someone_else" } } },
    );
    await seedRevisionHook();
    jest.mocked(runInSandbox).mockResolvedValue({ ok: true, warnings: [] });
    await run({
      experiment: hypothesisChange("old"),
      linkFeatures: [{ featureId: FLAG, variations: arms("p", "q") }],
    });
    const authors = jest
      .mocked(runInSandbox)
      .mock.calls.map(
        ([, args]) => (args.revision as { createdBy?: unknown }).createdBy,
      );
    expect(authors.length).toBeGreaterThan(0);
    expect(authors).toEqual(
      authors.map(() => ({ type: "api_key", apiKey: "key" })),
    );
  });

  describe("when the organization requires scoped rules", () => {
    const requireScoped = (body: Record<string, unknown> = {}) => {
      context = makeContext({
        settings: { requireScopedFeatureRules: true },
        body,
      });
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
          draftValues(arms("a", "wide"), {
            environments: { allEnvironments: true, environments: [] },
          }),
        ],
      };
      requireScoped();
      await expect(run(body)).rejects.toMatchObject({ code: "unscoped_rule" });
      expect(await revisionRules(2)).toEqual(arms("a", "draft"));

      requireScoped({ allowUnscopedRules: true });
      await run({ ...body, allowUnscopedRules: true });
      expect(await revisionRules(2)).toEqual(arms("a", "wide"));
    });

    it("refuses scoping a rule to no environment, which would leave it unreachable", async () => {
      await seed({ withDraft: true });
      await expect(
        run({
          flagValues: [
            draftValues(arms("a", "none"), {
              environments: { allEnvironments: false, environments: [] },
            }),
          ],
        }),
      ).rejects.toThrow("Choose at least one environment");
      expect(await revisionRules(2)).toEqual(arms("a", "draft"));
    });

    it("refuses linking a flag again everywhere before writing anything, unless the save allows it", async () => {
      await seed({ withDraft: false });
      await dropRule();
      const body: ExperimentChangesBody = {
        experiment: hypothesisChange("old"),
        linkFeatures: [{ featureId: FLAG, variations: arms("p", "q") }],
      };
      requireScoped();
      await expect(run(body)).rejects.toMatchObject({ code: "unscoped_rule" });
      expect((await storedExperiment()).hypothesis).toBe("old");

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
      expect((await storedRevision(2))?.status).toBe("discarded");
    });

    it("refuses while the experiment runs", async () => {
      await seed({ withDraft: false });
      await setExperiment({ status: "running" });
      await expect(run({ unlinkFeatures: [FLAG] })).rejects.toThrow(
        "Set the experiment's status back to draft to remove this Feature Flag.",
      );
      expect(
        await collection("featurerevisions").countDocuments({
          featureId: FLAG,
          status: "draft",
        }),
      ).toBe(0);
      expect((await storedExperiment()).linkedFeatures).toEqual([FLAG]);
    });

    it("removes a flag whose rule is already gone while the experiment runs", async () => {
      await seed({ withDraft: false });
      await dropRule();
      await setExperiment({ status: "running" });
      await run({ unlinkFeatures: [FLAG] });
      expect((await storedExperiment()).linkedFeatures).toEqual([]);
    });
  });

  it("refuses to link a flag once the experiment is past draft", async () => {
    await seed({ withDraft: false });
    await dropRule();
    await setExperiment({ status: "running" });
    await expect(
      run({ linkFeatures: [{ featureId: FLAG, variations: arms("p", "q") }] }),
    ).rejects.toThrow(
      "Set the experiment's status back to draft to link a Feature Flag.",
    );
    expect(await refRules("draft")).toEqual([]);
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

  describe("a save adding a variation", () => {
    const addV2 = (stored: {
      variations: ReturnType<typeof seededVariations>;
    }) => ({
      changes: {
        variations: [...stored.variations, variation("v2", 2)],
        variationWeights: [0.34, 0.33, 0.33],
      },
      base: { variations: stored.variations, variationWeights: [0.5, 0.5] },
    });
    const armsWithV2 = () => [
      ...arms("a", "b"),
      { variationId: "v2", value: "c" },
    ];
    const newFlag = (id: string) => ({
      feature: {
        id,
        valueType: "string" as const,
        defaultValue: "a",
        environmentSettings: {},
      },
      variations: armsWithV2(),
    });

    it("saves with each linked flag's value for it", async () => {
      await seed({ withDraft: false });
      const result = await run({
        experiment: addV2(await storedExperiment()),
        flagValues: [
          {
            featureId: FLAG,
            variations: armsWithV2(),
            revision: { version: 1, dateUpdated: null },
          },
        ],
      });
      expect((await storedExperiment()).variations.map((v) => v.id)).toEqual([
        "v0",
        "v1",
        "v2",
      ]);
      // Loaded from live, so the values start a new draft and live is untouched.
      expect(result.flags).toEqual([{ featureId: FLAG, version: 2 }]);
      expect(await revisionRules(1)).toEqual(arms("a", "b"));
      expect(await revisionRules(2)).toEqual(armsWithV2());
    });

    it("refuses while a linked flag has no value for it", async () => {
      await seed({ withDraft: false });
      await expect(
        run({ experiment: addV2(await storedExperiment()) }),
      ).rejects.toThrow(
        `Give each linked Feature Flag a value for the new variations: ${FLAG}.`,
      );
      expect((await storedExperiment()).variations).toHaveLength(2);
    });

    it("creates a flag whose values name the variation it adds", async () => {
      await seed({ withDraft: false });
      await setExperiment({ linkedFeatures: [] });

      await run({
        experiment: addV2(await storedExperiment()),
        createFeatures: [newFlag("flag_created")],
      });
      expect((await storedExperiment()).linkedFeatures).toEqual([
        "flag_created",
      ]);
      // A new flag's rule lands in a draft, as adding one from the page does.
      const draft = await collection("featurerevisions").findOne({
        featureId: "flag_created",
        status: "draft",
      });
      expect(draft?.rules?.[0]?.variations).toEqual(armsWithV2());
    });

    it("refuses a new flag's draft a validation hook rejects, before saving anything", async () => {
      await seed({ withDraft: false });
      await setExperiment({ linkedFeatures: [] });
      await seedRevisionHook();
      jest.mocked(runInSandbox).mockResolvedValue({
        ok: false,
        rejected: true,
        error: "Rejected by hook",
        warnings: [],
      });
      await expect(
        run({
          experiment: addV2(await storedExperiment()),
          createFeatures: [newFlag("flag_created")],
        }),
      ).rejects.toThrow("Rejected by hook");
      expect((await storedExperiment()).variations).toHaveLength(2);
      expect(await getFeature(context, "flag_created")).toBeNull();
    });

    it("checks a new flag's key in a dry run, writing nothing", async () => {
      await seed({ withDraft: false });
      await setExperiment({ linkedFeatures: [] });
      await expect(
        run({
          experiment: addV2(await storedExperiment()),
          createFeatures: [newFlag(FLAG)],
          dryRun: true,
        }),
      ).rejects.toThrow("This feature key already exists");
      expect((await storedExperiment()).variations).toHaveLength(2);
    });

    it("starts a draft's first phase with the variations it saves", async () => {
      await seed({ withDraft: false });
      await setExperiment({ linkedFeatures: [], phases: [] });
      const added = addV2(await storedExperiment());
      // No phase, so no split was loaded.
      await run({
        experiment: {
          ...added,
          base: { ...added.base, variationWeights: null },
        },
      });
      expect(
        (await storedExperiment()).phases[0]?.variations.map((v) => v.id),
      ).toEqual(["v0", "v1", "v2"]);
    });
  });

  it("changes a running bandit's coverage without restarting it, and refuses coverage that moved", async () => {
    await seed({ withDraft: false });
    await setExperiment({
      type: "multi-armed-bandit",
      status: "running",
      linkedFeatures: [],
      banditStage: "exploit",
    });

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
    ).rejects.toThrow("Traffic percent changed since you loaded it");
  });

  it("refuses taking a live rule out when a targeting Project's review rule governs the flag", async () => {
    await seed({ withDraft: false });
    // The flag's own Project has no rule; the Project it targets does.
    await collection("features").updateOne(
      { id: FLAG },
      { $set: { targetingProjects: ["prj_targeted"] } },
    );
    context = makeContext({
      role: "engineer",
      settings: {
        requireReviews: [
          {
            requireReviewOn: true,
            resetReviewOnChange: false,
            environments: [],
            projects: ["prj_targeted"],
          },
        ],
      } as unknown as OrganizationInterface["settings"],
    });
    await expect(removeForDeletedExperiment()).rejects.toThrow(
      "no authority to publish the change",
    );
    expect((await getFeature(context, FLAG))?.rules).toEqual([
      expect.objectContaining({ experimentId: EXP }),
    ]);
  });

  it("refuses rewriting a rule only drafts hold for someone who can't edit them", async () => {
    await seed({ withDraft: true });
    await collection("features").updateOne(
      { id: FLAG },
      { $set: { rules: [] } },
    );
    await collection("featurerevisions").updateOne(
      { featureId: FLAG, version: 1 },
      { $set: { rules: [] } },
    );
    context = makeContext({ role: "readonly" });
    await expect(removeForDeletedExperiment()).rejects.toThrow(
      "no authority to edit its drafts",
    );
    expect(await refRules("draft")).toEqual([
      expect.objectContaining({ experimentId: EXP }),
    ]);
  });

  describe("targeting", () => {
    const US = '{"country":"US"}';

    it("writes the latest phase and the experiment, keeping what someone else changed elsewhere", async () => {
      await seed({ withDraft: false });
      // Someone else's save: a new size, and the empty condition's other form.
      await setExperiment({
        "phases.0.coverage": 0.7,
        "phases.0.condition": "{}",
      });
      await run({
        experiment: {
          changes: { condition: US, hashAttribute: "device" },
          base: { condition: "", hashAttribute: null },
        },
      });
      const { phases, hashAttribute } = await storedExperiment();
      expect(phases).toHaveLength(1);
      expect(phases[0]).toMatchObject({ condition: US, coverage: 0.7 });
      expect(hashAttribute).toBe("device");
    });

    it("creates the first phase on an experiment with none", async () => {
      await seed({ withDraft: false });
      await setExperiment({ phases: [] });
      await run({
        experiment: { changes: { condition: US }, base: { condition: null } },
      });
      const { phases } = await storedExperiment();
      expect(phases).toHaveLength(1);
      expect(phases[0]).toMatchObject({
        condition: US,
        coverage: 1,
        variationWeights: [0.5, 0.5],
        variations: [
          { id: "v0", status: "active" },
          { id: "v1", status: "active" },
        ],
      });
    });

    it("changes what a live experiment serves only with a release, in place or in a new phase", async () => {
      await seed({ withDraft: false });
      await setExperiment({ status: "running" });
      const coverage = (to: number, from: number) => ({
        changes: { coverage: to },
        base: { coverage: from },
      });

      await expect(run({ experiment: coverage(0.5, 1) })).rejects.toThrow(
        "while the experiment is running and live",
      );

      await run({
        experiment: coverage(0.5, 1),
        release: { newPhase: false, reseed: false },
      });
      expect((await storedExperiment()).phases.map((p) => p.coverage)).toEqual([
        0.5,
      ]);

      await run({
        experiment: coverage(0.4, 0.5),
        release: { newPhase: true, reseed: true },
      });
      const { phases } = await storedExperiment();
      expect(phases.map((p) => p.coverage)).toEqual([0.5, 0.4]);
      expect(phases[0].dateEnded).toBeInstanceOf(Date);
      expect(phases[1]).toMatchObject({
        variationWeights: [0.5, 0.5],
        seed: expect.any(String),
      });
    });

    it("restarts a running bandit once who it targets changes", async () => {
      await seed({ withDraft: false });
      await setExperiment({
        type: "multi-armed-bandit",
        status: "running",
        linkedFeatures: [],
        banditStage: "exploit",
      });
      await run({
        experiment: { changes: { condition: US }, base: { condition: "" } },
      });
      expect((await storedExperiment()).banditStage).toBe("explore");
    });

    it("keeps a holdout's targeting the same in every phase, and refuses what a holdout doesn't target", async () => {
      await seed({ withDraft: false });
      const [phase] = seededPhases(new Date("2026-01-01T00:00:00Z"));
      await setExperiment({ type: "holdout", linkedFeatures: [] });
      await setExperiment({ phases: [phase, { ...phase, name: "Analysis" }] });

      await run({
        experiment: {
          changes: { condition: US, coverage: 0.1 },
          base: { condition: "", coverage: 1 },
        },
        release: { newPhase: false, reseed: false },
      });
      expect(
        (await storedExperiment()).phases.map(({ condition, coverage }) => ({
          condition,
          coverage,
        })),
      ).toEqual([
        { condition: US, coverage: 0.1 },
        { condition: US, coverage: 0.1 },
      ]);

      await expect(
        run({
          experiment: {
            changes: { prerequisites: [{ id: FLAG, condition: "{}" }] },
            base: { prerequisites: null },
          },
        }),
      ).rejects.toThrow("A holdout's targeting");
    });
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
      await setExperiment({ linkedFeatures: [], status });
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
      await setExperiment({ hasURLRedirects: true });
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
      await setExperiment({ hasVisualChangesets: true });
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
      context = makeContext({
        role: "experimenter",
        apiKeyData: {
          role: "experimenter",
          limitAccessByEnvironment: true,
          environments,
        } as ApiKeyInterface,
      });
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

    it("adds no URL Redirect once the experiment started after it was loaded", async () => {
      await seedLinked();
      const loaded = await storedExperiment();
      await setExperiment({ status: "running" });

      await expect(
        applyExperimentChanges({
          context,
          experiment: loaded,
          body: { addUrlRedirects: [staged(A)] },
          audit: async () => undefined,
          eventAudit: { type: "api_key", apiKey: "key" },
        }),
      ).rejects.toThrow("The experiment changed since you loaded it");
      expect(await storedRedirects()).toEqual([]);
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
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("The experiment's changes saved"),
      });
      expect((await storedExperiment()).hypothesis).toBe("new");
      expect(await storedRedirects()).toEqual([]);
      expect(await storedVisualChanges()).toEqual([
        ["v0", ".extension{}", undefined],
        ["v1", ".loaded{}", undefined],
      ]);
    });

    it.each([
      {
        name: "a URL Redirect edited since it was loaded",
        setup: () => seedRedirect("url_a", A),
        body: {
          editUrlRedirects: [
            {
              ...staged(A),
              id: "url_a",
              dateUpdated: "2025-12-31T00:00:00.000Z",
            },
          ],
        },
        refusal: {
          status: 409,
          message: "URL Redirect url_a changed since you loaded it",
        },
      },
      {
        name: "two staged URL Redirects that chain",
        body: {
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
        refusal: {
          status: 400,
          message: `A destination of the URL Redirect from ${A} matches the origin of the one from ${B}.`,
        },
      },
      {
        name: "a URL Redirect keeping a destination for a variation the save removes",
        body: {
          experiment: swapV1ForV2(),
          addUrlRedirects: [
            staged(A, { destinationURLs: destinations(A, ["v0", "v1", "v2"]) }),
          ],
        },
        refusal: {
          status: 400,
          message: "needs one destination for each variation",
        },
      },
      {
        name: "a Visual Editor edit for a variation the save removes",
        setup: seedChangeset,
        body: {
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
        refusal: {
          status: 400,
          message: "edits a variation this save removes",
        },
      },
      {
        name: "a URL Redirect on a running experiment",
        setup: () => setExperiment({ status: "running" }),
        body: { addUrlRedirects: [staged(A)] },
        refusal: {
          status: 400,
          message: "only change while the experiment is a draft",
        },
      },
      {
        name: "a first URL Redirect from someone who can run the experiment in only some environments",
        setup: async () => limitedTo(["staging"]),
        body: { addUrlRedirects: [staged(A)] },
        refusal: { status: 403, message: "" },
      },
    ] as {
      name: string;
      setup?: () => Promise<unknown>;
      body: ExperimentChangesBody;
      refusal: { status: number; message: string };
    }[])(
      "refuses $name before writing anything",
      async ({ setup, body, refusal: { status, message } }) => {
        await seedLinked();
        await setup?.();
        const snapshot = async () => ({
          experiment: await collection("experiments").findOne({ id: EXP }),
          redirects: await storedRedirects(),
          visualChanges: await storedVisualChanges(),
        });
        const before = await snapshot();
        await expect(
          run({ experiment: hypothesisChange("old"), ...body }),
        ).rejects.toMatchObject({
          status,
          message: expect.stringContaining(message),
        });
        expect(await snapshot()).toEqual(before);
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
      expect((await storedExperiment()).hypothesis).toBe("old");
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
      ).rejects.toMatchObject({
        status: 409,
        code: "changes_conflict",
        details: { urlRedirectIds: [], visualChangesetIds: ["vcs_1"] },
      });
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
      const experiment = await storedExperiment();
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

    it.each([
      {
        name: "each group's values to its own rules, in one draft",
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
        expected: { fr_prod: arms("a", "prod"), fr_stage: arms("a", "stage") },
      },
      {
        name: "one group's values, leaving the other group's rules alone",
        flagValues: [
          {
            featureId: FLAG,
            ruleIds: ["fr_stage"],
            variations: arms("a", "stage"),
            revision: LIVE,
          },
        ],
        expected: { fr_prod: arms("a", "b"), fr_stage: arms("a", "stage") },
      },
    ])("writes $name", async ({ flagValues, expected }) => {
      await seedSplit();
      const result = await run({ flagValues });
      expect(result.flags).toEqual([{ featureId: FLAG, version: 2 }]);
      expect(await draftValuesByRule()).toEqual(expected);
    });

    it.each([
      {
        name: "without naming the rules",
        flagValues: [
          { featureId: FLAG, variations: arms("a", "x"), revision: LIVE },
        ],
        message: "variation values must be identical",
      },
      {
        name: "twice without separate groups",
        flagValues: [
          { featureId: FLAG, variations: arms("a", "x"), revision: LIVE },
          { featureId: FLAG, variations: arms("a", "y"), revision: LIVE },
        ],
        message: "only to set values for separate groups",
      },
      {
        name: "with a rule in two groups",
        flagValues: [
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
        message: "is in more than one group",
      },
      {
        name: "re-scoping environments for some of the rules",
        flagValues: [
          {
            featureId: FLAG,
            ruleIds: ["fr_prod"],
            variations: arms("a", "x"),
            environments: { allEnvironments: true, environments: [] },
            revision: LIVE,
          },
        ],
        message: "environments can only change for all",
      },
    ])("refuses values $name", async ({ flagValues, message }) => {
      await seedSplit();
      await expect(run({ flagValues })).rejects.toThrow(message);
      expect(await refRules("draft")).toEqual([]);
    });

    it("names the flag as moved when its groups were loaded from different revisions", async () => {
      await seedSplit();
      await expect(
        run({
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
              revision: { version: 2, dateUpdated: LOADED },
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: "changes_conflict",
        details: { featureIds: [FLAG] },
      });
      expect(await refRules("draft")).toEqual([]);
    });
  });
});
