import { generateImageTool } from "back-end/src/api/visual-editor-ai/aiTools/generateImage";
import { uploadFile } from "back-end/src/services/files";
import { generateImages } from "back-end/src/services/imageGeneration";
import type { ImageTurnState } from "back-end/src/api/visual-editor-ai/aiTools/generateImage";
import type { ApiReqContext } from "back-end/types/api";

// The `quarantine` flag decides whether a generated image lands under the
// `gen/` prefix (7-day bucket TTL, promoted when the extension user accepts)
// or straight into permanent storage (a persisting caller has no accept step).
// Getting it backwards fails silently — the experiment renders fine and the
// image 404s a week later — so the prefix is asserted both ways.

// jest.config stubs the whole `ai` package for import cost ("no test exercises
// these"). This one does: `tool()` must return its definition intact or the
// execute closure under test is swallowed by the stub.
jest.mock("ai", () => ({
  tool: (definition: unknown) => definition,
}));

jest.mock("back-end/src/services/files", () => ({
  uploadFile: jest.fn(
    async (filePath: string) => `https://cdn.test/${filePath}`,
  ),
}));
jest.mock("back-end/src/services/imageGeneration", () => ({
  generateImages: jest.fn(),
}));
jest.mock("back-end/src/services/imageOptimization", () => ({
  optimizeAIImage: jest.fn(async () => ({
    buffer: Buffer.from("x"),
    contentType: "image/webp",
    ext: "webp",
    width: 1600,
    height: 900,
  })),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getAISettingsForOrg: jest.fn(async () => ({
    visualEditorImageModel: "test-image-model",
    visualEditorAIContext: "",
    keySource: {},
  })),
}));
jest.mock("back-end/src/enterprise/services/ai", () => ({
  secondsUntilAICanBeUsedAgainForProvider: jest.fn(async () => 0),
}));
jest.mock("back-end/src/models/AITokenUsageModel", () => ({
  updateTokenUsage: jest.fn(),
}));
jest.mock("back-end/src/services/growthbook", () => ({
  trackAIUsage: jest.fn(),
}));
jest.mock("shared/ai", () => {
  const overrides: Record<string, unknown> = {
    getImageModelMeta: () => ({ provider: "openai" }),
  };
  return new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop in overrides
          ? overrides[prop]
          : jest.requireActual("shared/ai")[prop],
    },
  );
});

const context = {
  org: { id: "org_1" },
  userId: "u_1",
} as unknown as ApiReqContext;

const newTurnState = (): ImageTurnState => ({
  count: 0,
  max: 3,
  generated: [],
  warnings: [],
});

const run = async (quarantine: boolean) => {
  const turnCounter = newTurnState();
  const tool = generateImageTool({ context, turnCounter, quarantine });
  const result = await tool.execute!(
    { prompt: "a dog", aspectRatio: "16:9" },
    // The AI SDK passes call metadata the tool doesn't read.
    {} as never,
  );
  return { result, turnCounter };
};

describe("generateImage quarantine prefix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (generateImages as jest.Mock).mockResolvedValue([{ base64: "x" }]);
  });

  it("writes under gen/ when quarantining (the extension's preview flow)", async () => {
    const { result, turnCounter } = await run(true);
    const [filePath] = (uploadFile as jest.Mock).mock.calls[0];
    expect(filePath).toMatch(/^gen\/org_1\/visual-editor\/img_.+\.webp$/);
    expect(result).toMatchObject({ ok: true });
    expect(turnCounter.generated).toHaveLength(1);
  });

  it("writes straight to permanent storage when not quarantining", async () => {
    const { result, turnCounter } = await run(false);
    const [filePath] = (uploadFile as jest.Mock).mock.calls[0];
    expect(filePath).toMatch(/^org_1\/visual-editor\/img_.+\.webp$/);
    expect(filePath.startsWith("gen/")).toBe(false);
    expect(result).toMatchObject({ ok: true });
    expect(turnCounter.generated[0].url).toBe(`https://cdn.test/${filePath}`);
  });

  it("records a soft failure as a warning instead of throwing", async () => {
    (generateImages as jest.Mock).mockRejectedValue(new Error("provider down"));
    const { result, turnCounter } = await run(false);
    expect(result).toMatchObject({ ok: false });
    expect(turnCounter.warnings).toEqual([
      "Image generation failed: provider down",
    ]);
    expect(turnCounter.generated).toHaveLength(0);
  });

  it("stops at the per-turn budget and says so", async () => {
    const turnCounter = newTurnState();
    turnCounter.count = turnCounter.max;
    const tool = generateImageTool({ context, turnCounter, quarantine: false });
    const result = await tool.execute!(
      { prompt: "a dog", aspectRatio: "16:9" },
      {} as never,
    );
    expect(result).toMatchObject({ ok: false });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(turnCounter.warnings[0]).toContain("budget exhausted");
  });
});
