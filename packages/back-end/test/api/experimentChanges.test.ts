import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { ExperimentChangesBody } from "shared/validators";
import { ReqContextClass } from "back-end/src/services/context";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
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
  settings: { environments: [{ id: "production" }] },
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
});
