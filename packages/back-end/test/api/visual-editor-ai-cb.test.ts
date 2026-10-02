import request from "supertest";
import { VisualChangesetModel } from "back-end/src/models/VisualChangesetModel";
import { setupApp } from "./api.setup";

const mockParsePrompt = jest.fn();

jest.mock("back-end/src/enterprise/services/ai", () => {
  const overrides: Record<string, unknown> = {
    parsePrompt: (...args: unknown[]) => mockParsePrompt(...args),
  };
  return new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop in overrides
          ? overrides[prop]
          : jest.requireActual("back-end/src/enterprise/services/ai")[prop],
    },
  );
});

const mockCbGetById = jest.fn();
const mockCbUpdate = jest.fn();

describe("visual editor AI on a contextual bandit changeset", () => {
  const { app, auditMock, setReqContext } = setupApp();
  const org = { id: "org_1", settings: {}, members: [] };

  const CHANGESET_ID = "vcs_cb";
  const VISUAL_CHANGE_ID = "vc_1";
  const VARIATION_ID = "var_treatment";

  const draftCb = {
    id: "cb_1",
    organization: org.id,
    trackingKey: "cb-1",
    name: "Checkout arms",
    description: "Try three checkout layouts",
    status: "draft",
    archived: false,
    project: "",
    hashAttribute: "id",
    variations: [
      { id: "var_control", key: "0", name: "Control", description: "" },
      { id: VARIATION_ID, key: "1", name: "Variation 1", description: "" },
    ],
    hasVisualChangesets: true,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };

  const seedChangeset = async () =>
    VisualChangesetModel.create({
      id: CHANGESET_ID,
      organization: org.id,
      contextualBandit: draftCb.id,
      editorUrl: "https://example.com/checkout",
      urlPatterns: [
        {
          include: true,
          type: "simple",
          pattern: "https://example.com/checkout",
        },
      ],
      visualChanges: [
        {
          id: VISUAL_CHANGE_ID,
          variation: VARIATION_ID,
          description: "",
          css: "",
          domMutations: [],
        },
      ],
    });

  const readVisualChange = async () => {
    const doc = await VisualChangesetModel.findOne({ id: CHANGESET_ID });
    return doc
      ?.toJSON()
      .visualChanges.find(
        (vc: { variation: string }) => vc.variation === VARIATION_ID,
      );
  };

  const setContext = (grant = true) => {
    setReqContext({
      org,
      organization: org,
      userId: "u_1",
      permissions: {
        canUpdateContextualBandit: () => grant,
        canRunContextualBandit: () => grant,
        throwPermissionError: () => {
          throw new Error("permission error");
        },
      },
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

  const editBody = (overrides: Record<string, unknown> = {}) => ({
    prompt: "make the headline shorter",
    variationId: VARIATION_ID,
    visualChangesetId: CHANGESET_ID,
    elementContext: [],
    ...overrides,
  });

  beforeEach(() => {
    setContext(true);
    mockCbGetById.mockResolvedValue(draftCb);
    mockCbUpdate.mockImplementation(async (cb, changes) => ({
      ...cb,
      ...changes,
    }));
    mockParsePrompt.mockResolvedValue({
      mutations: [
        {
          selector: "h1",
          action: "set",
          attribute: "html",
          value: "Shorter",
          parentSelector: null,
          insertBeforeSelector: null,
          options: null,
        },
      ],
      css: null,
      js: null,
      insert: [],
      explanation: "Shortened the headline.",
    });
  });

  it("previews an AI edit for a CB changeset", async () => {
    await seedChangeset();
    const res = await request(app)
      .post("/api/v1/visual-editor/ai/edit")
      .send(editBody());
    expect(res.status).toBe(200);
    expect(res.body.mutations).toHaveLength(1);
    expect(mockParsePrompt).toHaveBeenCalledTimes(1);
    expect((await readVisualChange()).domMutations).toHaveLength(0);
  });

  it("persists an AI edit on a draft CB", async () => {
    await seedChangeset();
    const res = await request(app)
      .post("/api/v1/visual-editor/ai/edit")
      .send(editBody({ persist: true }));
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
    const saved = await readVisualChange();
    expect(saved.domMutations).toHaveLength(1);
    expect(saved.domMutations[0]).toMatchObject({ selector: "h1" });
  });

  it("refuses to persist on a running CB without the opt-in, before the model runs", async () => {
    await seedChangeset();
    mockCbGetById.mockResolvedValue({ ...draftCb, status: "running" });
    const res = await request(app)
      .post("/api/v1/visual-editor/ai/edit")
      .send(editBody({ persist: true }));
    expect(res.status).toBe(400);
    expect(mockParsePrompt).not.toHaveBeenCalled();
  });

  it("persists and audits on a running CB with the opt-in", async () => {
    await seedChangeset();
    mockCbGetById.mockResolvedValue({ ...draftCb, status: "running" });
    const res = await request(app)
      .post("/api/v1/visual-editor/ai/edit")
      .send(editBody({ persist: true, allowRunningExperiment: true }));
    expect(res.status).toBe(200);
    expect((await readVisualChange()).domMutations).toHaveLength(1);
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][0].event).toBe("contextualBandit.update");
  });

  it("rejects the edit without the CB update permission", async () => {
    await seedChangeset();
    setContext(false);
    const res = await request(app)
      .post("/api/v1/visual-editor/ai/edit")
      .send(editBody());
    expect(res.status).not.toBe(200);
    expect(mockParsePrompt).not.toHaveBeenCalled();
  });

  it("grounds suggestions in the CB's name and description", async () => {
    await seedChangeset();
    mockParsePrompt.mockResolvedValue({
      suggestions: [
        "Make the CTA bigger",
        "Shorten the headline",
        "Add a trust badge",
      ],
    });
    const res = await request(app)
      .post("/api/v1/visual-editor/ai/suggestions")
      .send({ visualChangesetId: CHANGESET_ID });
    expect(res.status).toBe(200);
    const prompt: string = mockParsePrompt.mock.calls[0][0].prompt;
    expect(prompt).toContain("Current contextual bandit");
    expect(prompt).toContain("Checkout arms");
    expect(prompt).toContain("Try three checkout layouts");
  });
});
