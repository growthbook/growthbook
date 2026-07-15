import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import type { ExperimentInterface } from "shared/types/experiment";
import { ReqContextClass } from "back-end/src/services/context";
import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import { runValidateExperimentHooks } from "back-end/src/enterprise/sandbox/sandbox-eval";
import {
  createExperiment,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { validateExperimentChange } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { setupApp } from "../api/api.setup";

// Exercises the validateExperiment custom-hook wiring end-to-end: createExperiment
// and runValidateExperimentHooks run the real runValidateExperimentHooks -> _runCustomHooks chain
// against an in-memory Mongo. Only the sandbox leaf (runInSandbox, which runs user
// JS in a child process) is mocked, so each test controls the hook's verdict.
// updateExperiment itself no longer runs hooks; callers validate explicitly via
// runValidateExperimentHooks before writing.

jest.mock("back-end/src/enterprise/sandbox/sandbox-pool", () => ({
  runInSandbox: jest.fn(),
}));

const mockRunInSandbox = runInSandbox as jest.MockedFunction<
  typeof runInSandbox
>;

const ORG = {
  id: "org_exp_hooks_test",
  name: "Exp Hooks Test",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {
    environments: [{ id: "production", description: "" }],
  },
} as unknown as OrganizationInterface;

const EXISTING_ID = "exp_hooks_existing";

function makeContext(query: Record<string, string> = {}) {
  return new ReqContextClass({
    org: ORG,
    auditUser: { type: "api_key", apiKey: "key_test" },
    role: "admin",
    // context.ignoreWarnings reads req.query
    req: { query, headers: {} } as unknown as Request,
  });
}

async function seedExperimentHook(options?: {
  id?: string;
  entityId?: string;
  name?: string;
}) {
  await mongoose.connection.collection("customhooks").insertOne({
    id: options?.id || "hook_exp_1",
    organization: ORG.id,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    enabled: true,
    projects: [],
    name: options?.name || "test experiment hook",
    hook: "validateExperiment",
    code: "// behavior comes from the runInSandbox mock",
    ...(options?.entityId
      ? { entityType: "experiment", entityId: options.entityId }
      : {}),
  });
}

// Fields that toExperimentApiInterface reads when create/update logs an event.
const experimentBase = {
  type: "standard",
  project: "",
  projects: [],
  owner: "",
  tags: [],
  description: "",
  hypothesis: "",
  status: "draft",
  archived: false,
  hashAttribute: "id",
  hashVersion: 2,
  shareLevel: "organization",
  variations: [
    {
      id: "0",
      key: "control",
      name: "Control",
      description: "",
      screenshots: [],
    },
    {
      id: "1",
      key: "variation",
      name: "Variation 1",
      description: "",
      screenshots: [],
    },
  ],
  phases: [],
  goalMetrics: [],
  secondaryMetrics: [],
  guardrailMetrics: [],
  linkedFeatures: [],
  hasVisualChangesets: false,
  hasURLRedirects: false,
};

async function seedExperiment() {
  const doc = {
    ...experimentBase,
    id: EXISTING_ID,
    uid: "uidexphooksexisting",
    organization: ORG.id,
    trackingKey: "exp-hooks-existing",
    name: "Original Name",
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };
  await mongoose.connection.collection("experiments").insertOne(doc);
  return doc as unknown as ExperimentInterface;
}

function experimentData(): Partial<ExperimentInterface> {
  return {
    ...experimentBase,
    name: "New Experiment",
    trackingKey: "new-experiment",
  } as Partial<ExperimentInterface>;
}

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    ...experimentBase,
    id: "exp_vec_test",
    uid: "uidvectest",
    organization: ORG.id,
    trackingKey: "vec-test",
    name: "VEC",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...overrides,
  } as unknown as ExperimentInterface;
}

function countExperiments() {
  return mongoose.connection
    .collection("experiments")
    .countDocuments({ organization: ORG.id });
}

function findExperiment(id: string) {
  return mongoose.connection.collection("experiments").findOne({ id });
}

describe("experiment custom hooks", () => {
  setupApp();

  let premiumSpy: jest.SpyInstance;

  beforeEach(() => {
    premiumSpy = jest
      .spyOn(ReqContextClass.prototype, "hasPremiumFeature")
      .mockReturnValue(true);
    mockRunInSandbox.mockResolvedValue({ ok: true, warnings: [] });
  });

  afterEach(() => {
    premiumSpy.mockRestore();
  });

  it("runs the validateExperiment hook when creating an experiment", async () => {
    await seedExperimentHook();

    await createExperiment({ data: experimentData(), context: makeContext() });

    expect(mockRunInSandbox).toHaveBeenCalledTimes(1);
    // The hook receives the pending experiment as its function args
    expect(mockRunInSandbox.mock.calls[0][1]).toMatchObject({
      experiment: { name: "New Experiment" },
    });
    expect(await countExperiments()).toBe(1);
  });

  it("aborts experiment creation when a hook rejects", async () => {
    await seedExperimentHook();
    mockRunInSandbox.mockResolvedValue({
      ok: false,
      error: "Rejected by hook",
      warnings: [],
    });

    await expect(
      createExperiment({ data: experimentData(), context: makeContext() }),
    ).rejects.toThrow("Rejected by hook");

    // The rejection fires before the DB write, so nothing is persisted
    expect(mockRunInSandbox).toHaveBeenCalledTimes(1);
    expect(await countExperiments()).toBe(0);
  });

  it("runValidateExperimentHooks validates the pending state for an update, and the experiment as-is for a create", async () => {
    const experiment = await seedExperiment();
    await seedExperimentHook();

    await runValidateExperimentHooks({
      context: makeContext(),
      experiment: { ...experiment, name: "Updated Name" },
      original: experiment,
    });
    expect(mockRunInSandbox.mock.calls[0][1]).toMatchObject({
      experiment: { name: "Updated Name" },
    });

    await runValidateExperimentHooks({
      context: makeContext(),
      experiment,
      original: null,
    });
    expect(mockRunInSandbox.mock.calls[1][1]).toMatchObject({
      experiment: { name: "Original Name" },
    });

    expect(mockRunInSandbox).toHaveBeenCalledTimes(2);
  });

  it("aborts before the write when runValidateExperimentHooks rejects", async () => {
    const experiment = await seedExperiment();
    await seedExperimentHook();
    mockRunInSandbox.mockResolvedValue({
      ok: false,
      error: "Update rejected",
      warnings: [],
    });

    await expect(
      runValidateExperimentHooks({
        context: makeContext(),
        experiment: { ...experiment, name: "Updated Name" },
        original: experiment,
      }),
    ).rejects.toThrow("Update rejected");

    expect(mockRunInSandbox).toHaveBeenCalledTimes(1);
    // Real call sites run this before updateExperiment, so a throw here means
    // the write never happens.
    expect((await findExperiment(EXISTING_ID))?.name).toBe("Original Name");
  });

  it("blocks on an unacknowledged soft warning and succeeds on the ignoreWarnings retry", async () => {
    const experiment = await seedExperiment();
    await seedExperimentHook();
    mockRunInSandbox.mockResolvedValue({
      ok: true,
      warnings: ["double check this"],
    });

    await expect(
      runValidateExperimentHooks({
        context: makeContext(),
        experiment: { ...experiment, name: "Updated Name" },
        original: experiment,
      }),
    ).rejects.toMatchObject({
      status: 422,
      warnings: ["double check this"],
    });
    expect((await findExperiment(EXISTING_ID))?.name).toBe("Original Name");

    await runValidateExperimentHooks({
      context: makeContext({ ignoreWarnings: "true" }),
      experiment: { ...experiment, name: "Updated Name" },
      original: experiment,
    });
    const updated = await updateExperiment({
      context: makeContext({ ignoreWarnings: "true" }),
      experiment,
      changes: { name: "Updated Name" },
    });

    expect(updated.name).toBe("Updated Name");
    expect((await findExperiment(EXISTING_ID))?.name).toBe("Updated Name");
  });

  it("never invokes the custom-hook sandbox (validation is the caller's responsibility)", async () => {
    const experiment = await seedExperiment();
    await seedExperimentHook();

    const updated = await updateExperiment({
      context: makeContext(),
      experiment,
      changes: { name: "Bypassed Name" },
    });

    expect(mockRunInSandbox).not.toHaveBeenCalled();
    expect(updated.name).toBe("Bypassed Name");
    expect((await findExperiment(EXISTING_ID))?.name).toBe("Bypassed Name");
  });

  it("skips hooks when the org lacks the custom-hooks premium feature", async () => {
    premiumSpy.mockReturnValue(false);
    await seedExperimentHook();

    await createExperiment({ data: experimentData(), context: makeContext() });

    expect(mockRunInSandbox).not.toHaveBeenCalled();
    expect(await countExperiments()).toBe(1);
  });

  it("runs only experiment-scoped hooks that match the target experiment", async () => {
    const experiment = await seedExperiment();
    await seedExperimentHook({ entityId: EXISTING_ID, name: "scoped hook" });
    await seedExperimentHook({
      id: "hook_exp_2",
      entityId: "exp_other",
      name: "other experiment hook",
    });

    await runValidateExperimentHooks({
      context: makeContext(),
      experiment: { ...experiment, name: "Updated Name" },
      original: experiment,
    });

    expect(mockRunInSandbox).toHaveBeenCalledTimes(1);
  });

  it("skips experiment-scoped hooks when the entity id does not match", async () => {
    const experiment = await seedExperiment();
    await seedExperimentHook({
      entityId: "exp_other",
      name: "other experiment hook",
    });

    await runValidateExperimentHooks({
      context: makeContext(),
      experiment: { ...experiment, name: "Updated Name" },
      original: experiment,
    });

    expect(mockRunInSandbox).not.toHaveBeenCalled();
  });

  describe("validateExperimentChange", () => {
    it("validates the would-be running state when starting a draft", async () => {
      await seedExperimentHook();
      await validateExperimentChange({
        context: makeContext(),
        experiment: makeExperiment({ status: "draft" }),
        changes: { status: "running" },
      });
      expect(mockRunInSandbox.mock.calls[0][1]).toMatchObject({
        experiment: { status: "running" },
      });
    });

    it("validates the would-be running state when arming a scheduled start", async () => {
      await seedExperimentHook();
      await validateExperimentChange({
        context: makeContext(),
        experiment: makeExperiment({ status: "draft" }),
        changes: {
          nextScheduledStatusUpdate: {
            type: "start",
            date: new Date(Date.now() + 86400000),
          },
        },
      });
      expect(mockRunInSandbox.mock.calls[0][1]).toMatchObject({
        experiment: { status: "running" },
      });
    });

    it("validates the merged draft state for a plain draft edit", async () => {
      await seedExperimentHook();
      await validateExperimentChange({
        context: makeContext(),
        experiment: makeExperiment({ status: "draft", name: "Before" }),
        changes: { name: "After" },
      });
      expect(mockRunInSandbox.mock.calls[0][1]).toMatchObject({
        experiment: { status: "draft", name: "After" },
      });
    });

    it("validates a running experiment as-is without recomputing the start", async () => {
      await seedExperimentHook();
      await validateExperimentChange({
        context: makeContext(),
        experiment: makeExperiment({ status: "running", name: "Live" }),
        changes: { name: "Renamed" },
      });
      expect(mockRunInSandbox.mock.calls[0][1]).toMatchObject({
        experiment: { status: "running", name: "Renamed" },
      });
    });

    it("skips the would-be-state computation when hooks are inactive", async () => {
      premiumSpy.mockReturnValue(false);
      await seedExperimentHook();
      // A bandit with no datasource makes getChangesToStartExperiment throw if it
      // runs; the inactive-hook gate must short-circuit before that.
      await validateExperimentChange({
        context: makeContext(),
        experiment: makeExperiment({
          status: "draft",
          type: "multi-armed-bandit",
          datasource: "",
        }),
        changes: { status: "running" },
      });
      expect(mockRunInSandbox).not.toHaveBeenCalled();
    });
  });
});
