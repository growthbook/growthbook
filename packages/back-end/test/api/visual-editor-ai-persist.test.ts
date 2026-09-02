import request from "supertest";
import { VisualChangesetModel } from "back-end/src/models/VisualChangesetModel";
import { setupApp } from "./api.setup";

// Coverage for the `persist` flag on POST /api/v1/visual-editor/ai/edit.
// The LLM is mocked; the changeset round-trips through the real model against
// in-memory Mongo, because the thing worth testing is the merge itself —
// mutations append, css/js replace, and an omitted field must not clobber.

// These three modules sit in import cycles with the model layer, so spreading
// `requireActual` at factory time throws "cannot access before initialization".
// A lazy Proxy defers it to first property access — same trick as
// release-publish-revisions-failure.test.ts. Factories are hoisted above every
// declaration here, so each Proxy is inlined and may only close over
// `mock`-prefixed variables.
const mockParsePrompt = jest.fn();
const mockGetExperimentById = jest.fn();

jest.mock("back-end/src/enterprise/services/ai", () => {
  const overrides: Record<string, unknown> = {
    parsePrompt: (...args: unknown[]) => mockParsePrompt(...args),
    secondsUntilAICanBeUsedAgainForModel: async () => 0,
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

jest.mock("back-end/src/services/organizations", () => {
  const overrides: Record<string, unknown> = {
    getAISettingsForOrg: async () => ({
      visualEditorAIModel: "gpt-4o",
      keySource: {},
    }),
  };
  return new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop in overrides
          ? overrides[prop]
          : jest.requireActual("back-end/src/services/organizations")[prop],
    },
  );
});

jest.mock("back-end/src/models/ExperimentModel", () => {
  const overrides: Record<string, unknown> = {
    getExperimentById: (...args: unknown[]) => mockGetExperimentById(...args),
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

describe("visual editor AI edit — persist", () => {
  const { app, setReqContext } = setupApp();
  const org = { id: "org_1", settings: {}, members: [] };

  const CHANGESET_ID = "vcs_1";
  const VISUAL_CHANGE_ID = "vc_1";
  const VARIATION_ID = "var_treatment";

  const draftExperiment = {
    id: "exp_1",
    organization: "org_1",
    status: "draft",
    archived: false,
    variations: [{ id: "var_control" }, { id: VARIATION_ID }],
  };

  const seedChangeset = async (visualChange: Record<string, unknown> = {}) =>
    VisualChangesetModel.create({
      id: CHANGESET_ID,
      organization: org.id,
      experiment: draftExperiment.id,
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
          variation: VARIATION_ID,
          description: "",
          css: "",
          domMutations: [],
          ...visualChange,
        },
      ],
    });

  const readVisualChange = async () => {
    const doc = await VisualChangesetModel.findOne({ id: CHANGESET_ID });
    return doc?.toJSON().visualChanges[0];
  };

  const editBody = (overrides: Record<string, unknown> = {}) => ({
    prompt: "make the headline shorter",
    variationId: VARIATION_ID,
    visualChangesetId: CHANGESET_ID,
    persist: true,
    ...overrides,
  });

  beforeEach(() => {
    setReqContext({
      org,
      organization: org,
      userId: "u_1",
      permissions: {
        canUpdateVisualChange: () => true,
        throwPermissionError: () => {
          throw new Error("permission error");
        },
      },
      hasPremiumFeature: () => true,
    });
    mockGetExperimentById.mockResolvedValue(draftExperiment);
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

  it("appends new mutations onto the existing ones", async () => {
    const existing = {
      selector: ".sub",
      action: "set",
      attribute: "html",
      value: "Existing",
    };
    await seedChangeset({ domMutations: [existing] });

    const res = await request(app)
      .post("/api/v1/visual-editor/ai/edit")
      .send(editBody());

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
    expect(res.body.visualChangeId).toBe(VISUAL_CHANGE_ID);

    const saved = await readVisualChange();
    expect(saved.domMutations).toHaveLength(2);
    expect(saved.domMutations[0]).toMatchObject(existing);
    expect(saved.domMutations[1]).toMatchObject({
      selector: "h1",
      value: "Shorter",
    });
  });

  it("leaves existing css untouched when the model returns none", async () => {
    await seedChangeset({ css: "h1 { color: red; }" });

    await request(app)
      .post("/api/v1/visual-editor/ai/edit")
      .send(editBody())
      .expect(200);

    expect((await readVisualChange()).css).toBe("h1 { color: red; }");
  });

  it("replaces css wholesale when the model returns new css", async () => {
    await seedChangeset({ css: "h1 { color: red; }" });
    mockParsePrompt.mockResolvedValue({
      mutations: [],
      css: "h1 { color: blue; }",
      js: null,
      insert: [],
      explanation: "Recoloured.",
    });

    await request(app)
      .post("/api/v1/visual-editor/ai/edit")
      .send(editBody())
      .expect(200);

    expect((await readVisualChange()).css).toBe("h1 { color: blue; }");
  });

  it("rejects a non-draft experiment before calling the model", async () => {
    await seedChangeset();
    mockGetExperimentById.mockResolvedValue({
      ...draftExperiment,
      status: "running",
    });

    const res = await request(app)
      .post("/api/v1/visual-editor/ai/edit")
      .send(editBody());

    expect(res.status).toBe(400);
    // The point of the early gate: no AI quota burned on a change that
    // could never have been saved.
    expect(mockParsePrompt).not.toHaveBeenCalled();
  });

  it("still generates without persist against a non-draft experiment", async () => {
    await seedChangeset();
    mockGetExperimentById.mockResolvedValue({
      ...draftExperiment,
      status: "running",
    });

    const res = await request(app)
      .post("/api/v1/visual-editor/ai/edit")
      .send(editBody({ persist: undefined }));

    expect(res.status).toBe(200);
    expect(res.body.saved).toBeUndefined();
    expect((await readVisualChange()).domMutations).toHaveLength(0);
  });

  // The flat `elements` catalog only earns its keep if its selectors count as
  // grounded — otherwise the self-correct pass treats every one of them as a
  // hallucination and burns a second LLM call "fixing" a valid selector.
  describe("flat domDigest.elements", () => {
    const digestWith = (selector: string) => ({
      url: "https://example.com/pricing",
      title: "Pricing",
      elements: [{ selector, tag: "div", text: "Promo" }],
    });

    const mutateOn = (selector: string) => ({
      mutations: [
        {
          selector,
          action: "set",
          attribute: "html",
          value: "New",
          parentSelector: null,
          insertBeforeSelector: null,
          options: null,
        },
      ],
      css: null,
      js: null,
      insert: [],
      explanation: "Done.",
    });

    it("treats a selector from elements as grounded (no self-correct retry)", async () => {
      await seedChangeset();
      mockParsePrompt.mockResolvedValue(mutateOn(".promo"));

      await request(app)
        .post("/api/v1/visual-editor/ai/edit")
        .send(editBody({ domDigest: digestWith(".promo") }))
        .expect(200);

      expect(mockParsePrompt).toHaveBeenCalledTimes(1);
      expect((await readVisualChange()).domMutations[0].selector).toBe(
        ".promo",
      );
    });

    it("still retries on a selector that is in no catalog", async () => {
      await seedChangeset();
      mockParsePrompt.mockResolvedValue(mutateOn(".invented"));

      await request(app)
        .post("/api/v1/visual-editor/ai/edit")
        .send(editBody({ domDigest: digestWith(".promo") }))
        .expect(200);

      expect(mockParsePrompt).toHaveBeenCalledTimes(2);
    });
  });

  it("rejects persist combined with streamingMode", async () => {
    await seedChangeset();

    const res = await request(app)
      .post("/api/v1/visual-editor/ai/edit")
      .send(editBody({ streamingMode: true }));

    expect(res.status).toBe(400);
    expect(mockParsePrompt).not.toHaveBeenCalled();
  });
});
