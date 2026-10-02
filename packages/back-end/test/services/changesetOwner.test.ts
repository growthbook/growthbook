import type { ExperimentInterface } from "shared/types/experiment";
import type { VisualChangesetInterface } from "shared/types/visual-changeset";
import type { ApiReqContext } from "back-end/types/api";
import {
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

const mockGetExperimentById = jest.mocked(getExperimentById);
const mockGetPayloadKeys = jest.mocked(getPayloadKeys);
const mockUpdateExperiment = jest.mocked(updateExperiment);
const mockFindVisualChangeset = jest.mocked(findVisualChangesetById);
const mockQueueRefresh = jest.mocked(queueSDKPayloadRefresh);
const mockValidateChange = jest.mocked(validateExperimentChange);
const mockToApi = jest.mocked(toExperimentApiInterface);

type Permission =
  | "canUpdateVisualChange"
  | "canCreateVisualChange"
  | "canUpdateExperiment"
  | "canRunExperiment";

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
      throwPermissionError: jest.fn(() => {
        throw new Error("permission denied");
      }),
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
  owner: Partial<Pick<VisualChangesetInterface, "experiment">>,
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
});
