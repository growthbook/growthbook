import { generateImageTool } from "back-end/src/api/visual-editor-ai/aiTools/generateImage";
import { uploadFile } from "back-end/src/services/files";
import type { ApiReqContext } from "back-end/types/api";

// Inverting `quarantine` fails silently — the experiment renders and the image
// 404s a week later when the gen/ prefix expires — so assert it both ways.

// jest.config stubs `ai` globally; here `tool()` must pass its definition through.
jest.mock("ai", () => ({ tool: (definition: unknown) => definition }));
jest.mock("back-end/src/services/files", () => ({
  uploadFile: jest.fn(async (p: string) => `https://cdn.test/${p}`),
}));
jest.mock("back-end/src/services/imageGeneration", () => ({
  generateImages: jest.fn(async () => [{ base64: "x" }]),
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

it("only writes under gen/ when quarantining", async () => {
  const uploadedPath = async (quarantine: boolean) => {
    (uploadFile as jest.Mock).mockClear();
    const tool = generateImageTool({
      context: {
        org: { id: "org_1" },
        userId: "u_1",
      } as unknown as ApiReqContext,
      turnCounter: { count: 0, max: 3, generated: [], warnings: [] },
      quarantine,
    });
    await tool.execute!({ prompt: "a dog", aspectRatio: "16:9" }, {} as never);
    return (uploadFile as jest.Mock).mock.calls[0][0];
  };

  expect(await uploadedPath(true)).toMatch(
    /^gen\/org_1\/visual-editor\/img_.+\.webp$/,
  );
  expect(await uploadedPath(false)).toMatch(
    /^org_1\/visual-editor\/img_.+\.webp$/,
  );
});
