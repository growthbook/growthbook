import type {
  ExperimentInterface,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import type { VisualChangesetInterface } from "shared/types/visual-changeset";
import type { ContextualBanditInterface } from "shared/validators";
import type { ApiReqContext } from "back-end/types/api";
import {
  ContextualBanditChangesetOwner,
  ExperimentChangesetOwner,
  resolveChangesetOwner,
} from "back-end/src/services/changesetOwner";
import { loadChangesetWithOwner } from "back-end/src/api/visual-editor-ai/loadChangesetWithOwner";
import {
  getExperimentById,
  getPayloadKeys,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { findVisualChangesetById } from "back-end/src/models/VisualChangesetModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { validateExperimentChange } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import { logger } from "back-end/src/util/logger";
import {
  executeContextualBanditVariationChange,
  getContextualBanditLinkedFeatureInfo,
} from "back-end/src/enterprise/services/contextualBandits";
import { onContextualBanditVisualStateChanged } from "back-end/src/services/contextualBanditVisualState";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  getPayloadKeys: jest.fn(),
  updateExperiment: jest.fn(),
}));
jest.mock("back-end/src/models/VisualChangesetModel", () => ({
  findVisualChangesetById: jest.fn(),
}));
jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
}));
jest.mock(
  "back-end/src/services/experimentChanges/changeExperimentStatus",
  () => ({ validateExperimentChange: jest.fn() }),
);
jest.mock("back-end/src/services/experiments", () => ({
  toExperimentApiInterface: jest.fn(),
}));
jest.mock("back-end/src/services/owner", () => ({
  resolveOwnerEmail: jest.fn(async (doc: unknown) => doc),
}));
jest.mock("back-end/src/enterprise/services/contextualBandits", () => ({
  executeContextualBanditVariationChange: jest.fn(),
  getContextualBanditLinkedFeatureInfo: jest.fn(),
}));
jest.mock("back-end/src/services/contextualBanditVisualState", () => ({
  onContextualBanditVisualStateChanged: jest.fn(),
}));

const mockGetExperimentById = jest.mocked(getExperimentById);
const mockGetPayloadKeys = jest.mocked(getPayloadKeys);
const mockUpdateExperiment = jest.mocked(updateExperiment);
const mockFindVisualChangeset = jest.mocked(findVisualChangesetById);
const mockQueueRefresh = jest.mocked(queueSDKPayloadRefresh);
const mockValidateChange = jest.mocked(validateExperimentChange);
const mockToApi = jest.mocked(toExperimentApiInterface);
const mockExecuteVariationChange = jest.mocked(
  executeContextualBanditVariationChange,
);
const mockVisualStateChanged = jest.mocked(
  onContextualBanditVisualStateChanged,
);
const mockLinkedFeatureInfo = jest.mocked(getContextualBanditLinkedFeatureInfo);

const mockCbGetById = jest.fn();
const mockCbUpdate = jest.fn();

type Permission =
  | "canUpdateVisualChange"
  | "canCreateVisualChange"
  | "canUpdateExperiment"
  | "canRunExperiment"
  | "canUpdateContextualBandit"
  | "canRunContextualBandit";

function makeContext(denied: Permission[] = []) {
  const allow = (p: Permission) => jest.fn(() => !denied.includes(p));
  return {
    org: {
      id: "org_1",
      settings: {
        environments: [
          { id: "dev", description: "" },
          { id: "production", description: "" },
        ],
      },
    },
    userId: "u_1",
    permissions: {
      canUpdateVisualChange: allow("canUpdateVisualChange"),
      canCreateVisualChange: allow("canCreateVisualChange"),
      canUpdateExperiment: allow("canUpdateExperiment"),
      canRunExperiment: allow("canRunExperiment"),
      canUpdateContextualBandit: allow("canUpdateContextualBandit"),
      canRunContextualBandit: allow("canRunContextualBandit"),
      throwPermissionError: jest.fn(() => {
        throw new Error("permission denied");
      }),
    },
    models: {
      contextualBandits: { getById: mockCbGetById, update: mockCbUpdate },
    },
    throwBadRequestError: jest.fn((message: string) => {
      throw new Error(message);
    }),
    throwNotFoundError: jest.fn((message?: string) => {
      throw new Error(message ?? "not found");
    }),
  } as unknown as ApiReqContext;
}

function writeReq(context: ApiReqContext) {
  return { context, audit: jest.fn().mockResolvedValue(undefined) };
}

const CONTROL = {
  id: "var_control",
  key: "0",
  name: "Control",
  description: "",
  screenshots: [],
};
const TREATMENT = {
  id: "var_treatment",
  key: "1",
  name: "Variation 1",
  description: "",
  screenshots: [],
};

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_1",
    organization: "org_1",
    trackingKey: "exp-1",
    name: "Exp one",
    status: "draft",
    archived: false,
    project: "prj_1",
    hypothesis: "Bigger buttons convert",
    description: "",
    hashAttribute: "id",
    variations: [CONTROL, TREATMENT],
    phases: [],
    hasVisualChangesets: true,
    dateCreated: new Date("2026-10-01"),
    dateUpdated: new Date("2026-10-02"),
    ...overrides,
  } as unknown as ExperimentInterface;
}

function changeset(
  owner: Partial<
    Pick<VisualChangesetInterface, "experiment" | "contextualBandit">
  >,
): VisualChangesetInterface {
  return {
    id: "vcs_1",
    organization: "org_1",
    urlPatterns: [],
    editorUrl: "https://example.com",
    visualChanges: [],
    experiment: "",
    ...owner,
  } as unknown as VisualChangesetInterface;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateExperiment.mockImplementation(
    async ({ experiment, changes }) =>
      ({
        ...experiment,
        ...changes,
      }) as ExperimentInterface,
  );
});

describe("ExperimentChangesetOwner", () => {
  it("serves the latest phase's variations", () => {
    const third = { ...TREATMENT, id: "var_third", key: "2", name: "Third" };
    const owner = new ExperimentChangesetOwner(
      makeContext(),
      makeExperiment({
        variations: [CONTROL, TREATMENT, third],
        phases: [
          {
            variations: [
              { id: CONTROL.id, status: "active" },
              { id: TREATMENT.id, status: "active" },
              { id: third.id, status: "active" },
            ],
          },
          {
            variations: [
              { id: CONTROL.id, status: "active" },
              { id: TREATMENT.id, status: "active" },
            ],
          },
        ] as unknown as ExperimentInterface["phases"],
      }),
    );
    expect(owner.editableVariations().map((v) => v.id)).toEqual([
      CONTROL.id,
      TREATMENT.id,
    ]);
  });

  it("is editable only while draft and not archived", () => {
    const ctx = makeContext();
    expect(
      new ExperimentChangesetOwner(ctx, makeExperiment()).isEditable(),
    ).toBe(true);
    expect(
      new ExperimentChangesetOwner(
        ctx,
        makeExperiment({ status: "running" }),
      ).isEditable(),
    ).toBe(false);
    expect(
      new ExperimentChangesetOwner(
        ctx,
        makeExperiment({ archived: true }),
      ).isEditable(),
    ).toBe(false);
  });

  it("needs experiment and visual-change permissions to create a changeset", () => {
    const exp = makeExperiment();
    expect(
      new ExperimentChangesetOwner(makeContext(), exp).canCreateChangeset(),
    ).toBe(true);
    expect(
      new ExperimentChangesetOwner(
        makeContext(["canUpdateExperiment"]),
        exp,
      ).canCreateChangeset(),
    ).toBe(false);
    expect(
      new ExperimentChangesetOwner(
        makeContext(["canCreateVisualChange"]),
        exp,
      ).canCreateChangeset(),
    ).toBe(false);
  });

  it("needs experiment and visual-change permissions to manage variations", () => {
    const exp = makeExperiment();
    expect(
      new ExperimentChangesetOwner(makeContext(), exp).canManageVariations(),
    ).toBe(true);
    expect(
      new ExperimentChangesetOwner(
        makeContext(["canUpdateExperiment"]),
        exp,
      ).canManageVariations(),
    ).toBe(false);
    expect(
      new ExperimentChangesetOwner(
        makeContext(["canUpdateVisualChange"]),
        exp,
      ).canManageVariations(),
    ).toBe(false);
  });

  it("maps visual-change and owner updates to their own permissions", () => {
    const owner = new ExperimentChangesetOwner(
      makeContext(["canUpdateExperiment"]),
      makeExperiment(),
    );
    expect(owner.canUpdateVisualChange()).toBe(true);
    expect(owner.canUpdateOwner()).toBe(false);
  });

  describe("requireWrite", () => {
    const opts = { allowRunning: false, visualChangesetId: "vcs_1" };

    it("allows a draft write without auditing", async () => {
      const req = writeReq(makeContext());
      const audit = new ExperimentChangesetOwner(
        req.context,
        makeExperiment(),
      ).requireWrite(req, opts);
      await audit();
      expect(req.audit).not.toHaveBeenCalled();
    });

    it.each([
      ["a stopped", { status: "stopped" }],
      ["an archived", { archived: true }],
    ] as const)(
      "rejects %s experiment even with the live-edit opt-in",
      (_label, overrides) => {
        const req = writeReq(makeContext());
        const owner = new ExperimentChangesetOwner(
          req.context,
          makeExperiment(overrides as Partial<ExperimentInterface>),
        );
        expect(() =>
          owner.requireWrite(req, { ...opts, allowRunning: true }),
        ).toThrow(
          "Only draft experiments can have their visual changes edited",
        );
      },
    );

    it("rejects a running experiment without the opt-in", () => {
      const req = writeReq(makeContext());
      const owner = new ExperimentChangesetOwner(
        req.context,
        makeExperiment({ status: "running" }),
      );
      expect(() => owner.requireWrite(req, opts)).toThrow(
        "Only draft experiments",
      );
    });

    it("rejects a live edit without run permission", () => {
      const req = writeReq(makeContext(["canRunExperiment"]));
      const owner = new ExperimentChangesetOwner(
        req.context,
        makeExperiment({ status: "running" }),
      );
      expect(() =>
        owner.requireWrite(req, { ...opts, allowRunning: true }),
      ).toThrow("permission denied");
    });

    it("audits an accepted live edit", async () => {
      const req = writeReq(makeContext());
      const owner = new ExperimentChangesetOwner(
        req.context,
        makeExperiment({ status: "running" }),
      );
      await owner.requireWrite(req, { ...opts, allowRunning: true })();
      expect(req.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "experiment.update",
          entity: { object: "experiment", id: "exp_1" },
          details: expect.stringContaining('"liveVisualChangeEdit":true'),
        }),
      );
    });

    it("logs instead of failing the write when the audit fails", async () => {
      const logged = jest
        .spyOn(logger, "error")
        .mockImplementation(() => undefined);
      const req = writeReq(makeContext());
      req.audit.mockRejectedValue(new Error("audit down"));
      const owner = new ExperimentChangesetOwner(
        req.context,
        makeExperiment({ status: "running" }),
      );
      await expect(
        owner.requireWrite(req, { ...opts, allowRunning: true })(),
      ).resolves.toBeUndefined();
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({
          experimentId: "exp_1",
          visualChangesetId: "vcs_1",
        }),
        "Failed to audit a live visual change edit",
      );
      logged.mockRestore();
    });
  });

  it("writes hasVisualChangesets only when it changes", async () => {
    const owner = new ExperimentChangesetOwner(makeContext(), makeExperiment());
    await owner.setHasVisualChangesets(true);
    expect(mockUpdateExperiment).not.toHaveBeenCalled();
    await owner.setHasVisualChangesets(false);
    expect(mockUpdateExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { hasVisualChangesets: false },
        bypassWebhooks: true,
      }),
    );
  });

  it("refreshes the experiment's payload keys", async () => {
    const keys = [{ environment: "dev", project: "prj_1" }];
    mockGetPayloadKeys.mockReturnValue(keys);
    const ctx = makeContext();
    await new ExperimentChangesetOwner(ctx, makeExperiment()).refreshPayloads(
      "deleted",
      "vcs_1",
    );
    expect(mockQueueRefresh).toHaveBeenCalledWith({
      context: ctx,
      payloadKeys: keys,
      auditContext: { event: "deleted", model: "visualchangeset", id: "vcs_1" },
    });
  });

  it("renames after validation and skips an unchanged name", async () => {
    const owner = new ExperimentChangesetOwner(makeContext(), makeExperiment());
    expect(await owner.rename("  Exp one  ")).toBe("Exp one");
    expect(mockUpdateExperiment).not.toHaveBeenCalled();
    expect(await owner.rename(" Renamed ")).toBe("Renamed");
    expect(mockValidateChange).toHaveBeenCalledWith(
      expect.objectContaining({ changes: { name: "Renamed" } }),
    );
    expect(owner.name).toBe("Renamed");
  });

  describe("addVariation", () => {
    it("appends a variation and rebalances the latest phase", async () => {
      const owner = new ExperimentChangesetOwner(
        makeContext(),
        makeExperiment({
          phases: [
            {
              variations: [
                { id: CONTROL.id, status: "active" },
                { id: TREATMENT.id, status: "active" },
              ],
              variationWeights: [0.5, 0.5],
            },
          ] as unknown as ExperimentInterface["phases"],
        }),
      );
      const added = await owner.addVariation({});
      expect(added.name).toBe("Variant 2");
      const { changes } = mockUpdateExperiment.mock.calls[0][0];
      expect(changes.variations?.map((v) => v.key)).toEqual(["0", "1", "2"]);
      const phase = changes.phases?.[0];
      expect(phase?.variations?.map((v) => v.id)).toEqual([
        CONTROL.id,
        TREATMENT.id,
        added.id,
      ]);
      expect(phase?.variationWeights).toEqual([0.3334, 0.3333, 0.3333]);
    });

    it("names a duplicate after its source", async () => {
      const owner = new ExperimentChangesetOwner(
        makeContext(),
        makeExperiment(),
      );
      const added = await owner.addVariation({
        sourceVariationId: TREATMENT.id,
      });
      expect(added.name).toBe("Variation 1 (copy)");
    });

    it("rejects an unknown source variation", async () => {
      const owner = new ExperimentChangesetOwner(
        makeContext(),
        makeExperiment(),
      );
      await expect(
        owner.addVariation({ sourceVariationId: "var_missing" }),
      ).rejects.toThrow("Source variation not found in this experiment");
      expect(mockUpdateExperiment).not.toHaveBeenCalled();
    });
  });

  describe("removeVariation", () => {
    const third = { ...TREATMENT, id: "var_third", key: "2", name: "Third" };

    it("refuses to delete control", async () => {
      const owner = new ExperimentChangesetOwner(
        makeContext(),
        makeExperiment({ variations: [CONTROL, TREATMENT, third] }),
      );
      await expect(owner.removeVariation(CONTROL.id)).rejects.toThrow(
        "The control variation can't be deleted",
      );
    });

    it("keeps at least one variant besides control", async () => {
      const owner = new ExperimentChangesetOwner(
        makeContext(),
        makeExperiment(),
      );
      await expect(owner.removeVariation(TREATMENT.id)).rejects.toThrow(
        "An experiment must keep at least one variant besides control",
      );
    });

    it("removes the variation, renormalizes weights and can roll back", async () => {
      const original = makeExperiment({
        variations: [CONTROL, TREATMENT, third],
        phases: [
          {
            variations: [
              { id: CONTROL.id, status: "active" },
              { id: TREATMENT.id, status: "active" },
              { id: third.id, status: "active" },
            ],
            variationWeights: [0.5, 0.25, 0.25],
          },
        ] as unknown as ExperimentInterface["phases"],
      });
      const owner = new ExperimentChangesetOwner(makeContext(), original);
      const { rollback } = await owner.removeVariation(TREATMENT.id);
      const { changes } = mockUpdateExperiment.mock.calls[0][0];
      expect(changes.variations?.map((v) => v.id)).toEqual([
        CONTROL.id,
        third.id,
      ]);
      expect(changes.phases?.[0].variationWeights).toEqual([0.6667, 0.3333]);

      await rollback?.();
      const rollbackChanges = mockUpdateExperiment.mock.calls[1][0].changes;
      expect(rollbackChanges.variations?.map((v) => v.id)).toEqual([
        CONTROL.id,
        TREATMENT.id,
        third.id,
      ]);
      expect(rollbackChanges.phases?.[0].variationWeights).toEqual([
        0.5, 0.25, 0.25,
      ]);
    });
  });

  it("renames a variation and skips an unchanged name", async () => {
    const owner = new ExperimentChangesetOwner(makeContext(), makeExperiment());
    await expect(owner.renameVariation("var_missing", "x")).rejects.toThrow(
      "Variation not found in this experiment",
    );
    expect(await owner.renameVariation(TREATMENT.id, "Variation 1")).toBe(
      "Variation 1",
    );
    expect(mockUpdateExperiment).not.toHaveBeenCalled();
    expect(await owner.renameVariation(TREATMENT.id, " Promo ")).toBe("Promo");
    const { changes } = mockUpdateExperiment.mock.calls[0][0];
    expect(changes.variations?.[1].name).toBe("Promo");
  });

  describe("toEditorExperiment", () => {
    it("returns the experiment's API shape without re-reading it", async () => {
      mockToApi.mockResolvedValue({ id: "exp_1", name: "Fresh" } as never);
      const experiment = makeExperiment({ name: "Fresh" });
      const owner = new ExperimentChangesetOwner(makeContext(), experiment);
      expect(await owner.toEditorExperiment()).toEqual({
        id: "exp_1",
        name: "Fresh",
      });
      expect(mockToApi).toHaveBeenCalledWith(expect.anything(), experiment);
      expect(mockGetExperimentById).not.toHaveBeenCalled();
    });

    it("returns null for a holdout", async () => {
      const owner = new ExperimentChangesetOwner(
        makeContext(),
        makeExperiment({ type: "holdout" }),
      );
      expect(await owner.toEditorExperiment()).toBeNull();
      expect(mockToApi).not.toHaveBeenCalled();
    });
  });

  it("grounds AI prompts in the experiment's hypothesis and project", () => {
    expect(
      new ExperimentChangesetOwner(
        makeContext(),
        makeExperiment(),
      ).promptContext(),
    ).toEqual({
      kind: "experiment",
      id: "exp_1",
      name: "Exp one",
      hypothesis: "Bigger buttons convert",
      description: undefined,
      project: "prj_1",
    });
  });
});

function makeCb(
  overrides: Partial<ContextualBanditInterface> = {},
): ContextualBanditInterface {
  return {
    id: "cb_1",
    organization: "org_1",
    trackingKey: "cb-1",
    name: "CB one",
    description: "Picks a hero per segment",
    status: "draft",
    archived: false,
    project: "prj_1",
    hashAttribute: "id",
    variations: [CONTROL, TREATMENT],
    hasVisualChangesets: true,
    dateCreated: new Date("2026-10-01"),
    dateUpdated: new Date("2026-10-02"),
    ...overrides,
  } as unknown as ContextualBanditInterface;
}

function fakeVariationService() {
  mockExecuteVariationChange.mockImplementation(async (_ctx, cb, args) => {
    let variations = [...cb.variations];
    for (const add of args.addVariations ?? []) {
      variations.push({
        id: add.id ?? `var_${variations.length}`,
        key: `${variations.length}`,
        name: add.name ?? "",
        description: "",
        screenshots: [],
        status: "pending",
      } as ContextualBanditInterface["variations"][number]);
    }
    for (const id of args.removeVariationIds ?? []) {
      variations = variations.map((v) =>
        v.id === id ? { ...v, status: "deactivated" as const } : v,
      );
    }
    for (const u of args.updateVariations ?? []) {
      variations = variations.map((v) => (v.id === u.id ? { ...v, ...u } : v));
    }
    return {
      updated: { ...cb, variations },
      featureDraftPublishFailures: [],
    };
  });
}

function linkedFeature(
  featureId: string,
  state: LinkedFeatureInfo["state"],
  valuesByVariation: Record<string, string>,
): LinkedFeatureInfo {
  return {
    feature: { id: featureId },
    state,
    values: Object.entries(valuesByVariation).map(([variationId, value]) => ({
      variationId,
      value,
    })),
  } as unknown as LinkedFeatureInfo;
}

describe("ContextualBanditChangesetOwner", () => {
  beforeEach(() => {
    mockCbUpdate.mockImplementation(async (cb, changes) => ({
      ...cb,
      ...changes,
    }));
    mockLinkedFeatureInfo.mockResolvedValue([]);
    fakeVariationService();
  });

  it("hides deactivated arms and exposes arm status on the editor stub", async () => {
    const owner = new ContextualBanditChangesetOwner(
      makeContext(),
      makeCb({
        variations: [
          CONTROL,
          TREATMENT,
          {
            ...TREATMENT,
            id: "var_pending",
            key: "2",
            name: "New",
            status: "pending",
          },
          {
            ...TREATMENT,
            id: "var_gone",
            key: "3",
            name: "Gone",
            status: "deactivated",
          },
        ] as ContextualBanditInterface["variations"],
      }),
    );
    expect(owner.editableVariations().map((v) => v.id)).toEqual([
      CONTROL.id,
      TREATMENT.id,
      "var_pending",
    ]);
    const stub = await owner.toEditorExperiment();
    expect(stub).toMatchObject({
      id: "cb_1",
      type: "contextual-bandit",
      hashVersion: 2,
      trackingKey: "cb-1",
    });
    expect(stub.variations.map((v) => v.status)).toEqual([
      undefined,
      undefined,
      "pending",
    ]);
  });

  it("is editable while draft or running, not stopped or archived", () => {
    const ctx = makeContext();
    expect(new ContextualBanditChangesetOwner(ctx, makeCb()).isEditable()).toBe(
      true,
    );
    expect(
      new ContextualBanditChangesetOwner(
        ctx,
        makeCb({ status: "running" }),
      ).isEditable(),
    ).toBe(true);
    expect(
      new ContextualBanditChangesetOwner(
        ctx,
        makeCb({ status: "stopped" }),
      ).isEditable(),
    ).toBe(false);
    expect(
      new ContextualBanditChangesetOwner(
        ctx,
        makeCb({ archived: true }),
      ).isEditable(),
    ).toBe(false);
  });

  it("lets a visual-editor-only user save changes but not touch the bandit", () => {
    const owner = new ContextualBanditChangesetOwner(
      makeContext(["canUpdateContextualBandit"]),
      makeCb(),
    );
    expect(owner.canUpdateVisualChange()).toBe(true);
    expect(owner.canUpdateOwner()).toBe(false);
    expect(owner.canManageVariations()).toBe(false);
    expect(owner.canCreateChangeset()).toBe(false);
  });

  it("lets a bandit-only user rename but not save visual changes", () => {
    const owner = new ContextualBanditChangesetOwner(
      makeContext(["canUpdateVisualChange"]),
      makeCb(),
    );
    expect(owner.canUpdateOwner()).toBe(true);
    expect(owner.canUpdateVisualChange()).toBe(false);
    expect(owner.canManageVariations()).toBe(false);
  });

  it("needs the visual-change create permission to create a changeset", () => {
    expect(
      new ContextualBanditChangesetOwner(
        makeContext(),
        makeCb(),
      ).canCreateChangeset(),
    ).toBe(true);
    expect(
      new ContextualBanditChangesetOwner(
        makeContext(["canCreateVisualChange"]),
        makeCb(),
      ).canCreateChangeset(),
    ).toBe(false);
  });

  it("refuses to create a changeset on a stopped bandit", () => {
    expect(() =>
      new ContextualBanditChangesetOwner(
        makeContext(),
        makeCb({ status: "stopped" }),
      ).assertCanCreateChangeset(),
    ).toThrow(
      "Only draft or running contextual bandits can have visual changes added",
    );
    expect(() =>
      new ContextualBanditChangesetOwner(
        makeContext(),
        makeCb(),
      ).assertCanCreateChangeset(),
    ).not.toThrow();
  });

  describe("requireWrite", () => {
    const opts = { allowRunning: false, visualChangesetId: "vcs_1" };

    it("allows a draft write without auditing", async () => {
      const req = writeReq(makeContext());
      await new ContextualBanditChangesetOwner(
        req.context,
        makeCb(),
      ).requireWrite(req, opts)();
      expect(req.audit).not.toHaveBeenCalled();
    });

    it.each([
      ["a stopped", { status: "stopped" }],
      ["an archived", { archived: true }],
    ] as const)("rejects %s bandit", (_label, overrides) => {
      const req = writeReq(makeContext());
      const owner = new ContextualBanditChangesetOwner(
        req.context,
        makeCb(overrides as Partial<ContextualBanditInterface>),
      );
      expect(() =>
        owner.requireWrite(req, { ...opts, allowRunning: true }),
      ).toThrow(
        "Only draft or running contextual bandits can have their visual changes edited",
      );
    });

    it("rejects a running bandit without the opt-in", () => {
      const req = writeReq(makeContext());
      const owner = new ContextualBanditChangesetOwner(
        req.context,
        makeCb({ status: "running" }),
      );
      expect(() => owner.requireWrite(req, opts)).toThrow(
        "This contextual bandit is running, so its visual changes reach live traffic immediately. Confirm the live edit to save.",
      );
    });

    it("checks run permission on every environment", () => {
      const req = writeReq(makeContext(["canRunContextualBandit"]));
      const cb = makeCb({ status: "running" });
      const owner = new ContextualBanditChangesetOwner(req.context, cb);
      expect(() =>
        owner.requireWrite(req, { ...opts, allowRunning: true }),
      ).toThrow("permission denied");
      expect(
        req.context.permissions.canRunContextualBandit,
      ).toHaveBeenCalledWith(cb, ["dev", "production"]);
    });

    it("audits an accepted live edit", async () => {
      const req = writeReq(makeContext());
      const owner = new ContextualBanditChangesetOwner(
        req.context,
        makeCb({ status: "running" }),
      );
      await owner.requireWrite(req, { ...opts, allowRunning: true })();
      expect(req.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "contextualBandit.update",
          entity: { object: "contextualBandit", id: "cb_1" },
          details: expect.stringContaining('"liveVisualChangeEdit":true'),
        }),
      );
    });
  });

  it("writes hasVisualChangesets only when it changes", async () => {
    const owner = new ContextualBanditChangesetOwner(makeContext(), makeCb());
    await owner.setHasVisualChangesets(true);
    expect(mockCbUpdate).not.toHaveBeenCalled();
    await owner.setHasVisualChangesets(false);
    expect(mockCbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cb_1" }),
      {
        hasVisualChangesets: false,
      },
    );
  });

  it("hands payload refreshes to the visual-state hook and keeps its result", async () => {
    const ctx = makeContext();
    const cb = makeCb();
    mockVisualStateChanged.mockResolvedValue({ ...cb, name: "After hook" });
    const owner = new ContextualBanditChangesetOwner(ctx, cb);
    await owner.refreshPayloads("updated");
    expect(mockVisualStateChanged).toHaveBeenCalledWith(ctx, cb, {
      changesetDeleted: false,
    });
    expect(owner.name).toBe("After hook");
  });

  it("tells the visual-state hook when a changeset was deleted", async () => {
    const ctx = makeContext();
    const cb = makeCb();
    mockVisualStateChanged.mockResolvedValue(cb);
    await new ContextualBanditChangesetOwner(ctx, cb).refreshPayloads(
      "deleted",
    );
    expect(mockVisualStateChanged).toHaveBeenCalledWith(ctx, cb, {
      changesetDeleted: true,
    });
  });

  it("renames the bandit and skips an unchanged name", async () => {
    const owner = new ContextualBanditChangesetOwner(makeContext(), makeCb());
    expect(await owner.rename("CB one")).toBe("CB one");
    expect(mockCbUpdate).not.toHaveBeenCalled();
    expect(await owner.rename(" Renamed ")).toBe("Renamed");
    expect(mockCbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cb_1" }),
      {
        name: "Renamed",
      },
    );
  });

  describe("addVariation", () => {
    it("adds an arm through the variation service", async () => {
      const owner = new ContextualBanditChangesetOwner(makeContext(), makeCb());
      const added = await owner.addVariation({});
      expect(mockExecuteVariationChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: "cb_1" }),
        {
          addVariations: [{ id: expect.any(String), name: "Variation 2" }],
        },
      );
      expect(added).toEqual({ id: expect.any(String), name: "Variation 2" });
      expect(owner.editableVariations()).toHaveLength(3);
    });

    it("returns its own arm when another request's arm lands first", async () => {
      mockExecuteVariationChange.mockImplementation(async (_ctx, cb, args) => {
        const other = {
          id: "var_other",
          key: "2",
          name: "Other",
          description: "",
          screenshots: [],
          status: "pending",
        } as ContextualBanditInterface["variations"][number];
        const mine = {
          ...other,
          id: args.addVariations?.[0]?.id ?? "",
          key: "3",
          name: args.addVariations?.[0]?.name ?? "",
        };
        return {
          updated: { ...cb, variations: [...cb.variations, other, mine] },
          featureDraftPublishFailures: [],
        };
      });
      const owner = new ContextualBanditChangesetOwner(makeContext(), makeCb());
      const added = await owner.addVariation({ name: "Mine" });
      expect(added.name).toBe("Mine");
      expect(added.id).not.toBe("var_other");
    });

    it("names a duplicate after its source", async () => {
      const owner = new ContextualBanditChangesetOwner(makeContext(), makeCb());
      const added = await owner.addVariation({
        sourceVariationId: TREATMENT.id,
      });
      expect(added.name).toBe("Variation 1 (copy)");
    });

    it("gives a new arm the control's linked feature values", async () => {
      mockLinkedFeatureInfo.mockResolvedValue([
        linkedFeature("feat_live", "live", {
          [CONTROL.id]: "red",
          [TREATMENT.id]: "blue",
        }),
        linkedFeature("feat_draft", "draft", { [CONTROL.id]: "1" }),
        linkedFeature("feat_discarded", "discarded", { [CONTROL.id]: "x" }),
      ]);
      const owner = new ContextualBanditChangesetOwner(makeContext(), makeCb());
      await owner.addVariation({});
      expect(mockExecuteVariationChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        {
          addVariations: [
            {
              id: expect.any(String),
              name: "Variation 2",
              values: { feat_live: "red", feat_draft: "1" },
            },
          ],
        },
      );
    });

    it("gives a duplicate its source arm's linked feature values", async () => {
      mockLinkedFeatureInfo.mockResolvedValue([
        linkedFeature("feat_live", "live", {
          [CONTROL.id]: "red",
          [TREATMENT.id]: "blue",
        }),
      ]);
      const owner = new ContextualBanditChangesetOwner(makeContext(), makeCb());
      await owner.addVariation({ sourceVariationId: TREATMENT.id });
      expect(mockExecuteVariationChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        {
          addVariations: [
            {
              id: expect.any(String),
              name: "Variation 1 (copy)",
              values: { feat_live: "blue" },
            },
          ],
        },
      );
    });

    it("rejects an unknown source arm", async () => {
      const owner = new ContextualBanditChangesetOwner(makeContext(), makeCb());
      await expect(
        owner.addVariation({ sourceVariationId: "var_missing" }),
      ).rejects.toThrow("Source variation not found in this contextual bandit");
      expect(mockExecuteVariationChange).not.toHaveBeenCalled();
    });

    it("passes the service's validation errors through", async () => {
      mockExecuteVariationChange.mockRejectedValue(
        new Error("Set a Feature Flag value for every new variation"),
      );
      const owner = new ContextualBanditChangesetOwner(makeContext(), makeCb());
      await expect(owner.addVariation({})).rejects.toThrow(
        "Set a Feature Flag value for every new variation",
      );
    });

    it("fails loudly when the service reports no new arm", async () => {
      mockExecuteVariationChange.mockImplementation(async (_ctx, cb) => ({
        updated: cb,
        featureDraftPublishFailures: [],
      }));
      const owner = new ContextualBanditChangesetOwner(makeContext(), makeCb());
      await expect(owner.addVariation({})).rejects.toThrow(
        "The contextual bandit did not report the new variation",
      );
    });
  });

  it("removes an arm through the variation service with no rollback", async () => {
    const owner = new ContextualBanditChangesetOwner(makeContext(), makeCb());
    const result = await owner.removeVariation(TREATMENT.id);
    expect(mockExecuteVariationChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "cb_1" }),
      { removeVariationIds: [TREATMENT.id] },
    );
    expect(result.rollback).toBeUndefined();
    expect(owner.editableVariations().map((v) => v.id)).toEqual([CONTROL.id]);
  });

  it("renames an arm and skips an unchanged or unknown one", async () => {
    const owner = new ContextualBanditChangesetOwner(makeContext(), makeCb());
    await expect(owner.renameVariation("var_missing", "x")).rejects.toThrow(
      "Variation not found in this contextual bandit",
    );
    expect(await owner.renameVariation(TREATMENT.id, "Variation 1")).toBe(
      "Variation 1",
    );
    expect(mockExecuteVariationChange).not.toHaveBeenCalled();
    expect(await owner.renameVariation(TREATMENT.id, " Promo ")).toBe("Promo");
    expect(mockExecuteVariationChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { updateVariations: [{ id: TREATMENT.id, name: "Promo" }] },
    );
  });

  it("grounds AI prompts in the bandit's name and description", () => {
    expect(
      new ContextualBanditChangesetOwner(
        makeContext(),
        makeCb(),
      ).promptContext(),
    ).toEqual({
      kind: "contextual-bandit",
      id: "cb_1",
      name: "CB one",
      description: "Picks a hero per segment",
      project: "prj_1",
    });
  });
});

describe("resolveChangesetOwner", () => {
  it("resolves an experiment-owned changeset", async () => {
    mockGetExperimentById.mockResolvedValue(makeExperiment());
    const owner = await resolveChangesetOwner(
      makeContext(),
      changeset({ experiment: "exp_1" }),
    );
    expect(owner).toBeInstanceOf(ExperimentChangesetOwner);
    expect(owner?.id).toBe("exp_1");
  });

  it("returns null when the experiment is gone", async () => {
    mockGetExperimentById.mockResolvedValue(null);
    expect(
      await resolveChangesetOwner(
        makeContext(),
        changeset({ experiment: "exp_1" }),
      ),
    ).toBeNull();
  });

  it("resolves a bandit-owned changeset", async () => {
    mockCbGetById.mockResolvedValue(makeCb());
    const owner = await resolveChangesetOwner(
      makeContext(),
      changeset({ contextualBandit: "cb_1" }),
    );
    expect(owner).toBeInstanceOf(ContextualBanditChangesetOwner);
    expect(mockCbGetById).toHaveBeenCalledWith("cb_1");
    expect(mockGetExperimentById).not.toHaveBeenCalled();
  });

  it("returns null when the bandit is gone", async () => {
    mockCbGetById.mockResolvedValue(null);
    expect(
      await resolveChangesetOwner(
        makeContext(),
        changeset({ contextualBandit: "cb_1" }),
      ),
    ).toBeNull();
  });
});

describe("loadChangesetWithOwner", () => {
  it("returns the changeset with its owner", async () => {
    const cs = changeset({ experiment: "exp_1" });
    mockFindVisualChangeset.mockResolvedValue(cs);
    mockGetExperimentById.mockResolvedValue(makeExperiment());
    const result = await loadChangesetWithOwner(makeContext(), "vcs_1");
    expect(result.changeset).toBe(cs);
    expect(result.owner.id).toBe("exp_1");
    expect(mockFindVisualChangeset).toHaveBeenCalledWith("vcs_1", "org_1");
  });

  it("404s a missing changeset", async () => {
    mockFindVisualChangeset.mockResolvedValue(null);
    await expect(
      loadChangesetWithOwner(makeContext(), "vcs_1"),
    ).rejects.toThrow("Visual changeset not found");
  });

  it("404s a changeset whose experiment is gone", async () => {
    mockFindVisualChangeset.mockResolvedValue(
      changeset({ experiment: "exp_1" }),
    );
    mockGetExperimentById.mockResolvedValue(null);
    await expect(
      loadChangesetWithOwner(makeContext(), "vcs_1"),
    ).rejects.toThrow("Experiment not found");
  });

  it("404s a changeset whose bandit is gone", async () => {
    mockFindVisualChangeset.mockResolvedValue(
      changeset({ contextualBandit: "cb_1" }),
    );
    mockCbGetById.mockResolvedValue(null);
    await expect(
      loadChangesetWithOwner(makeContext(), "vcs_1"),
    ).rejects.toThrow("Contextual Bandit not found");
  });
});
