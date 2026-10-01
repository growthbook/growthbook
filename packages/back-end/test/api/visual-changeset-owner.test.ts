import request from "supertest";
import { VisualChangesetModel } from "back-end/src/models/VisualChangesetModel";
import { setupApp } from "./api.setup";

const mockGetExperimentById = jest.fn();
const mockUpdateExperiment = jest.fn();

jest.mock("back-end/src/models/ExperimentModel", () => {
  const overrides: Record<string, unknown> = {
    getExperimentById: (...args: unknown[]) => mockGetExperimentById(...args),
    updateExperiment: (...args: unknown[]) => mockUpdateExperiment(...args),
  };
  return new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop in overrides
          ? overrides[prop]
          : jest.requireActual("back-end/src/models/ExperimentModel")[prop],
    },
  );
});

const mockExecuteVariationChange = jest.fn();

jest.mock("back-end/src/enterprise/services/contextualBandits", () => {
  const overrides: Record<string, unknown> = {
    executeContextualBanditVariationChange: (...args: unknown[]) =>
      mockExecuteVariationChange(...args),
  };
  return new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop in overrides
          ? overrides[prop]
          : jest.requireActual(
              "back-end/src/enterprise/services/contextualBandits",
            )[prop],
    },
  );
});

jest.mock(
  "back-end/src/services/experimentChanges/changeExperimentStatus",
  () => ({
    ...jest.requireActual(
      "back-end/src/services/experimentChanges/changeExperimentStatus",
    ),
    validateExperimentChange: jest.fn(),
  }),
);

const ORG = { id: "org_1", settings: {}, members: [] };
const CHANGESET_ID = "vcs_1";
const CONTROL_ID = "var_control";
const TREATMENT_ID = "var_treatment";
const VISUAL_CHANGE_ID = "vc_1";

const baseVariations = [
  { id: CONTROL_ID, key: "0", name: "Control", description: "" },
  { id: TREATMENT_ID, key: "1", name: "Variation 1", description: "" },
];

const draftExperiment = {
  id: "exp_1",
  organization: ORG.id,
  trackingKey: "exp-1",
  name: "Exp one",
  status: "draft",
  archived: false,
  project: "",
  hashAttribute: "id",
  variations: baseVariations.map((v) => ({ ...v, screenshots: [] })),
  phases: [],
  hasVisualChangesets: true,
};

const draftCb = {
  id: "cb_1",
  organization: ORG.id,
  trackingKey: "cb-1",
  name: "CB one",
  status: "draft",
  archived: false,
  project: "",
  hashAttribute: "id",
  variations: baseVariations.map((v) => ({ ...v, screenshots: [] })),
  hasVisualChangesets: true,
  dateCreated: new Date(),
  dateUpdated: new Date(),
};

type OwnerCase = {
  kind: "experiment" | "contextual-bandit";
  ownerField: "experiment" | "contextualBandit";
  ownerId: string;
  seedOwner: (overrides?: Record<string, unknown>) => void;
  permissionKeys: string[];
  ownerUpdateKeys: string[];
};

const OWNERS: OwnerCase[] = [
  {
    kind: "experiment",
    ownerField: "experiment",
    ownerId: draftExperiment.id,
    seedOwner: (overrides = {}) => {
      mockGetExperimentById.mockResolvedValue({
        ...draftExperiment,
        ...overrides,
      });
    },
    permissionKeys: ["canUpdateVisualChange", "canCreateVisualChange"],
    ownerUpdateKeys: ["canUpdateExperiment"],
  },
  {
    kind: "contextual-bandit",
    ownerField: "contextualBandit",
    ownerId: draftCb.id,
    seedOwner: (overrides = {}) => {
      mockCbGetById.mockResolvedValue({ ...draftCb, ...overrides });
    },
    permissionKeys: ["canUpdateContextualBandit"],
    ownerUpdateKeys: ["canUpdateContextualBandit"],
  },
];

const mockCbGetById = jest.fn();
const mockCbUpdate = jest.fn();

describe("visual changeset owner adapter", () => {
  const { app, auditMock, setReqContext } = setupApp();

  const permissions = (
    grant: boolean,
    overrides: Record<string, boolean> = {},
  ) => {
    const value = (name: string) => () => overrides[name] ?? grant;
    return {
      canUpdateVisualChange: value("canUpdateVisualChange"),
      canCreateVisualChange: value("canCreateVisualChange"),
      canUpdateExperiment: value("canUpdateExperiment"),
      canRunExperiment: value("canRunExperiment"),
      canUpdateContextualBandit: value("canUpdateContextualBandit"),
      canRunContextualBandit: value("canRunContextualBandit"),
      throwPermissionError: () => {
        throw new Error("permission error");
      },
    };
  };

  const setContext = (
    grant = true,
    overrides: Record<string, boolean> = {},
  ) => {
    setReqContext({
      org: ORG,
      organization: ORG,
      userId: "u_1",
      permissions: permissions(grant, overrides),
      hasPremiumFeature: () => true,
      getAllProjectIds: async () => [],
      models: {
        contextualBandits: {
          getById: (...args: unknown[]) => mockCbGetById(...args),
          update: (...args: unknown[]) => mockCbUpdate(...args),
        },
      },
    });
  };

  const seedChangeset = async (owner: OwnerCase) =>
    VisualChangesetModel.create({
      id: CHANGESET_ID,
      organization: ORG.id,
      [owner.ownerField]: owner.ownerId,
      editorUrl: "https://example.com/pricing",
      urlPatterns: [
        {
          include: true,
          type: "simple",
          pattern: "https://example.com/pricing",
        },
      ],
      visualChanges: [
        {
          id: VISUAL_CHANGE_ID,
          variation: TREATMENT_ID,
          description: "",
          css: "",
          domMutations: [],
        },
      ],
    });

  const readChangeset = async () => {
    const doc = await VisualChangesetModel.findOne({ id: CHANGESET_ID });
    return doc?.toJSON();
  };
  const readTreatmentChange = async () =>
    (await readChangeset()).visualChanges.find(
      (vc: { variation: string }) => vc.variation === TREATMENT_ID,
    );

  beforeEach(() => {
    setContext(true);
    mockUpdateExperiment.mockImplementation(
      async ({ experiment, changes }) => ({ ...experiment, ...changes }),
    );
    mockCbUpdate.mockImplementation(async (cb, changes) => ({
      ...cb,
      ...changes,
    }));
  });

  describe.each(OWNERS)("$kind owner", (owner) => {
    beforeEach(() => owner.seedOwner());

    it("saves a visual change on a draft", async () => {
      await seedChangeset(owner);
      const res = await request(app)
        .put(
          `/api/v1/visual-changesets/${CHANGESET_ID}/visual-change/${VISUAL_CHANGE_ID}`,
        )
        .send({ variation: TREATMENT_ID, css: "h1 { color: red; }" });
      expect(res.status).toBe(200);
      expect((await readTreatmentChange()).css).toBe("h1 { color: red; }");
    });

    it("rejects a visual change save without update permission", async () => {
      await seedChangeset(owner);
      setContext(false);
      const res = await request(app)
        .put(
          `/api/v1/visual-changesets/${CHANGESET_ID}/visual-change/${VISUAL_CHANGE_ID}`,
        )
        .send({ variation: TREATMENT_ID, css: "h1 { color: red; }" });
      expect(res.status).not.toBe(200);
      expect(res.body.message).toMatch(/permission error/);
      expect((await readTreatmentChange()).css).toBe("");
    });

    it("rejects a visual change save on a stopped owner", async () => {
      await seedChangeset(owner);
      owner.seedOwner({ status: "stopped" });
      const res = await request(app)
        .put(
          `/api/v1/visual-changesets/${CHANGESET_ID}/visual-change/${VISUAL_CHANGE_ID}`,
        )
        .send({ variation: TREATMENT_ID, css: "h1 { color: red; }" });
      expect(res.status).toBe(400);
      expect((await readTreatmentChange()).css).toBe("");
    });

    it("rejects a visual change save on an archived owner", async () => {
      await seedChangeset(owner);
      owner.seedOwner({ archived: true });
      const res = await request(app)
        .put(
          `/api/v1/visual-changesets/${CHANGESET_ID}/visual-change/${VISUAL_CHANGE_ID}`,
        )
        .send({ variation: TREATMENT_ID, css: "h1 { color: red; }" });
      expect(res.status).toBe(400);
    });

    it("adds a visual change", async () => {
      await seedChangeset(owner);
      const res = await request(app)
        .post(`/api/v1/visual-changesets/${CHANGESET_ID}/visual-change`)
        .send({ variation: CONTROL_ID, css: ".x { display: none; }" });
      expect(res.status).toBe(200);
      const saved = await readChangeset();
      expect(saved.visualChanges).toHaveLength(2);
      expect(
        saved.visualChanges.find(
          (vc: { variation: string }) => vc.variation === CONTROL_ID,
        ).css,
      ).toBe(".x { display: none; }");
    });

    it("rejects a live edit on a running owner without the opt-in", async () => {
      await seedChangeset(owner);
      owner.seedOwner({ status: "running" });
      const res = await request(app)
        .put(
          `/api/v1/visual-changesets/${CHANGESET_ID}/visual-change/${VISUAL_CHANGE_ID}`,
        )
        .send({ variation: TREATMENT_ID, css: "h1 { color: red; }" });
      expect(res.status).toBe(400);
      expect((await readTreatmentChange()).css).toBe("");
      expect(auditMock).not.toHaveBeenCalled();
    });

    it("accepts and audits a live edit on a running owner with the opt-in", async () => {
      await seedChangeset(owner);
      owner.seedOwner({ status: "running" });
      const res = await request(app)
        .put(
          `/api/v1/visual-changesets/${CHANGESET_ID}/visual-change/${VISUAL_CHANGE_ID}`,
        )
        .send({
          variation: TREATMENT_ID,
          css: "h1 { color: red; }",
          allowRunningExperiment: true,
        });
      expect(res.status).toBe(200);
      expect((await readTreatmentChange()).css).toBe("h1 { color: red; }");
      expect(auditMock).toHaveBeenCalledTimes(1);
      const details = JSON.parse(auditMock.mock.calls[0][0].details);
      expect(details.context).toMatchObject({
        visualChangesetId: CHANGESET_ID,
        liveVisualChangeEdit: true,
      });
    });

    it("rejects a live edit with the opt-in but no run permission", async () => {
      await seedChangeset(owner);
      owner.seedOwner({ status: "running" });
      setContext(true, {
        canRunExperiment: false,
        canRunContextualBandit: false,
      });
      const res = await request(app)
        .put(
          `/api/v1/visual-changesets/${CHANGESET_ID}/visual-change/${VISUAL_CHANGE_ID}`,
        )
        .send({
          variation: TREATMENT_ID,
          css: "h1 { color: red; }",
          allowRunningExperiment: true,
        });
      expect(res.status).not.toBe(200);
      expect(res.body.message).toMatch(/permission error/);
      expect((await readTreatmentChange()).css).toBe("");
    });

    it("updates the changeset's url patterns", async () => {
      await seedChangeset(owner);
      const res = await request(app)
        .put(`/api/v1/visual-changesets/${CHANGESET_ID}`)
        .send({
          urlPatterns: [
            { include: true, type: "simple", pattern: "https://example.com/" },
          ],
        });
      expect(res.status).toBe(200);
      expect((await readChangeset()).urlPatterns[0].pattern).toBe(
        "https://example.com/",
      );
    });

    it("returns the owner as an experiment-shaped record on load", async () => {
      await seedChangeset(owner);
      const res = await request(app).get(
        `/api/v1/visual-changesets/${CHANGESET_ID}?includeExperiment=1`,
      );
      expect(res.status).toBe(200);
      expect(res.body.experiment.id).toBe(owner.ownerId);
      expect(res.body.experiment.variations).toHaveLength(2);
    });

    it("creates a second changeset on the same owner", async () => {
      await seedChangeset(owner);
      const res = await request(app)
        .post("/api/v1/visual-editor/create-changeset")
        .send({
          visualChangesetId: CHANGESET_ID,
          pageUrl: "https://example.com/checkout",
          urlPatterns: [{ pattern: "https://example.com/checkout" }],
        });
      expect(res.status).toBe(200);
      const created = await VisualChangesetModel.findOne({
        id: res.body.visualChangeset.id,
      });
      expect(created?.toJSON()[owner.ownerField]).toBe(owner.ownerId);
      expect(created?.toJSON().visualChanges).toHaveLength(2);
    });

    it("renames the owner", async () => {
      await seedChangeset(owner);
      const res = await request(app)
        .post("/api/v1/visual-editor/rename-experiment")
        .send({ visualChangesetId: CHANGESET_ID, name: "Renamed" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Renamed");
      const updater =
        owner.kind === "experiment" ? mockUpdateExperiment : mockCbUpdate;
      expect(updater).toHaveBeenCalledTimes(1);
    });

    it("skips the owner write when the name is unchanged", async () => {
      await seedChangeset(owner);
      const currentName =
        owner.kind === "experiment" ? draftExperiment.name : draftCb.name;
      const res = await request(app)
        .post("/api/v1/visual-editor/rename-experiment")
        .send({ visualChangesetId: CHANGESET_ID, name: currentName });
      expect(res.status).toBe(200);
      expect(mockUpdateExperiment).not.toHaveBeenCalled();
      expect(mockCbUpdate).not.toHaveBeenCalled();
    });
  });

  describe("experiment owner variations", () => {
    beforeEach(() => OWNERS[0].seedOwner());

    it("adds a variation and a matching visual change", async () => {
      await seedChangeset(OWNERS[0]);
      const res = await request(app)
        .post("/api/v1/visual-editor/add-variant")
        .send({ visualChangesetId: CHANGESET_ID, name: "Variation 2" });
      expect(res.status).toBe(200);
      expect(res.body.newVariationId).toBeTruthy();
      const changes = mockUpdateExperiment.mock.calls[0][0].changes;
      expect(changes.variations).toHaveLength(3);
      expect(changes.variations[2].name).toBe("Variation 2");
      const saved = await readChangeset();
      expect(saved.visualChanges).toHaveLength(2);
      expect(saved.visualChanges[1].variation).toBe(res.body.newVariationId);
    });

    it("refuses to delete control", async () => {
      await seedChangeset(OWNERS[0]);
      const res = await request(app)
        .post("/api/v1/visual-editor/delete-variant")
        .send({ visualChangesetId: CHANGESET_ID, variationId: CONTROL_ID });
      expect(res.status).toBe(400);
      expect(mockUpdateExperiment).not.toHaveBeenCalled();
    });

    it("renames a variation", async () => {
      await seedChangeset(OWNERS[0]);
      const res = await request(app)
        .post("/api/v1/visual-editor/rename-variant")
        .send({
          visualChangesetId: CHANGESET_ID,
          variationId: TREATMENT_ID,
          name: "Treatment",
        });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Treatment");
      const changes = mockUpdateExperiment.mock.calls[0][0].changes;
      expect(changes.variations[1].name).toBe("Treatment");
    });
  });

  describe("changeset creation on a stopped owner", () => {
    const createChangeset = () =>
      request(app)
        .post("/api/v1/visual-editor/create-changeset")
        .send({
          visualChangesetId: CHANGESET_ID,
          pageUrl: "https://example.com/checkout",
          urlPatterns: [{ pattern: "https://example.com/checkout" }],
        });

    it("still creates a changeset on a stopped experiment", async () => {
      OWNERS[0].seedOwner({ status: "stopped" });
      await seedChangeset(OWNERS[0]);
      const res = await createChangeset();
      expect(res.status).toBe(200);
    });

    it("refuses to create a changeset on a stopped contextual bandit", async () => {
      OWNERS[1].seedOwner({ status: "stopped" });
      await seedChangeset(OWNERS[1]);
      const res = await createChangeset();
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/stopped/);
      expect(
        await VisualChangesetModel.countDocuments({ contextualBandit: "cb_1" }),
      ).toBe(1);
    });
  });

  describe("contextual bandit owner variations", () => {
    it("exposes each arm's status on the editor stub", async () => {
      OWNERS[1].seedOwner({
        variations: [
          ...draftCb.variations,
          {
            id: "var_2",
            key: "2",
            name: "Variation 2",
            description: "",
            screenshots: [],
            status: "pending",
          },
        ],
      });
      await seedChangeset(OWNERS[1]);
      const res = await request(app).get(
        `/api/v1/visual-changesets/${CHANGESET_ID}?includeExperiment=1`,
      );
      expect(res.status).toBe(200);
      expect(res.body.experiment.variations).toHaveLength(3);
      expect(res.body.experiment.variations[2].status).toBe("pending");
    });

    beforeEach(() => {
      OWNERS[1].seedOwner();
      mockExecuteVariationChange.mockImplementation(async (_ctx, cb, args) => {
        let variations = [...cb.variations];
        for (const add of args.addVariations ?? []) {
          variations.push({
            id: `var_${variations.length}`,
            key: `${variations.length}`,
            name: add.name,
            description: "",
            screenshots: [],
            status: "pending",
          });
        }
        for (const id of args.removeVariationIds ?? []) {
          variations = variations.map((v) =>
            v.id === id ? { ...v, status: "deactivated" } : v,
          );
        }
        for (const u of args.updateVariations ?? []) {
          variations = variations.map((v) =>
            v.id === u.id ? { ...v, ...u } : v,
          );
        }
        return {
          updated: { ...cb, variations },
          featureDraftPublishFailures: [],
        };
      });
    });

    it("adds an arm through the CB variation service and seeds its visual change", async () => {
      await seedChangeset(OWNERS[1]);
      const res = await request(app)
        .post("/api/v1/visual-editor/add-variant")
        .send({
          visualChangesetId: CHANGESET_ID,
          name: "Variation 2",
          sourceVariationId: TREATMENT_ID,
        });
      expect(res.status).toBe(200);
      expect(mockExecuteVariationChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: draftCb.id }),
        { addVariations: [{ name: "Variation 2" }] },
      );
      expect(res.body.newVariationId).toBe("var_2");
      const saved = await readChangeset();
      const entry = saved.visualChanges.find(
        (vc: { variation: string }) => vc.variation === "var_2",
      );
      expect(entry).toBeTruthy();
      expect(res.body.experiment.variations).toHaveLength(3);
      expect(res.body.experiment.variations[2].status).toBe("pending");
    });

    it("removes an arm through the CB variation service", async () => {
      await seedChangeset(OWNERS[1]);
      const res = await request(app)
        .post("/api/v1/visual-editor/delete-variant")
        .send({ visualChangesetId: CHANGESET_ID, variationId: TREATMENT_ID });
      expect(res.status).toBe(200);
      expect(mockExecuteVariationChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { removeVariationIds: [TREATMENT_ID] },
      );
      expect(
        (await readChangeset()).visualChanges.find(
          (vc: { variation: string }) => vc.variation === TREATMENT_ID,
        ),
      ).toBeUndefined();
      expect(res.body.experiment.variations).toHaveLength(1);
    });

    it("renames an arm through the CB variation service", async () => {
      await seedChangeset(OWNERS[1]);
      const res = await request(app)
        .post("/api/v1/visual-editor/rename-variant")
        .send({
          visualChangesetId: CHANGESET_ID,
          variationId: TREATMENT_ID,
          name: "Promo",
        });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Promo");
      expect(mockExecuteVariationChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { updateVariations: [{ id: TREATMENT_ID, name: "Promo" }] },
      );
    });

    it("surfaces the service's validation errors as 400s", async () => {
      await seedChangeset(OWNERS[1]);
      mockExecuteVariationChange.mockRejectedValue(
        new Error("A contextual bandit must have at least 2 variations."),
      );
      const res = await request(app)
        .post("/api/v1/visual-editor/delete-variant")
        .send({ visualChangesetId: CHANGESET_ID, variationId: TREATMENT_ID });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/at least 2 variations/);
      expect((await readChangeset()).visualChanges).toHaveLength(1);
    });
  });
});
