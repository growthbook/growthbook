import type { FeatureInterface } from "shared/validators";
import {
  assertFeatureNotManaged,
  assertLoadedFeatureNotManaged,
  blockManagedFeatureWrites,
  guardManagedFeatureRoutes,
} from "back-end/src/services/managedFeatures";
import { ManagedFeatureError } from "back-end/src/util/errors";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getContextFromReq } from "back-end/src/services/organizations";
import type { OpenApiRoute } from "back-end/src/util/handler";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextFromReq: jest.fn(() => ({})),
  getEnvironments: jest.fn(() => []),
}));

const mockGetFeature = getFeature as jest.Mock;
const mockGetContextFromReq = getContextFromReq as jest.Mock;

const feature = (managed: boolean) =>
  ({
    id: "flag",
    managedBy: managed
      ? { type: "experiment" as const, experimentId: "exp_1" }
      : undefined,
  }) as FeatureInterface;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetContextFromReq.mockReturnValue({});
});

describe("assertLoadedFeatureNotManaged", () => {
  it("throws for an experiment-managed flag, carrying the owning experiment", () => {
    expect.assertions(2);
    try {
      assertLoadedFeatureNotManaged(feature(true));
    } catch (e) {
      expect(e).toBeInstanceOf(ManagedFeatureError);
      expect((e as ManagedFeatureError).message).toContain("exp_1");
    }
  });
});

describe("assertFeatureNotManaged", () => {
  it("stays silent when the flag cannot be read, leaving the 404 to the handler", async () => {
    mockGetFeature.mockResolvedValue(null);
    await expect(
      assertFeatureNotManaged({} as never, "missing"),
    ).resolves.toBeUndefined();
  });
});

describe("blockManagedFeatureWrites", () => {
  const run = (method: string, path: string, id?: string) =>
    new Promise<unknown>((resolve) => {
      blockManagedFeatureWrites(
        { method, path, params: id ? { id } : {} } as never,
        {} as never,
        resolve as () => void,
      );
    });

  it("blocks a mutating request to a managed flag", async () => {
    mockGetFeature.mockResolvedValue(feature(true));
    expect(await run("PUT", "/feature/flag", "flag")).toBeInstanceOf(
      ManagedFeatureError,
    );
  });

  it("allows reads of a managed flag", async () => {
    mockGetFeature.mockResolvedValue(feature(true));
    expect(await run("GET", "/feature/flag", "flag")).toBeUndefined();
    expect(mockGetFeature).not.toHaveBeenCalled();
  });

  it("allows the read-only eval POST on a managed flag", async () => {
    mockGetFeature.mockResolvedValue(feature(true));
    expect(await run("POST", "/feature/flag/3/eval", "flag")).toBeUndefined();
    expect(mockGetFeature).not.toHaveBeenCalled();
  });

  it("allows a mutating request to an unmanaged flag", async () => {
    mockGetFeature.mockResolvedValue(feature(false));
    expect(await run("POST", "/feature/flag/toggle", "flag")).toBeUndefined();
  });
});

describe("guardManagedFeatureRoutes", () => {
  const route = (method: string): OpenApiRoute =>
    ({
      method,
      path: "/features/:id",
      rawHandler: jest.fn(async () => ({ ok: true })),
    }) as unknown as OpenApiRoute;

  it("guards the rawHandler the agent dispatcher calls directly", async () => {
    mockGetFeature.mockResolvedValue(feature(true));
    const [guarded] = guardManagedFeatureRoutes([route("post")]);
    await expect(
      guarded.rawHandler({ params: { id: "flag" }, context: {} } as never),
    ).rejects.toBeInstanceOf(ManagedFeatureError);
  });

  it("leaves read routes untouched", () => {
    const original = route("get");
    const [guarded] = guardManagedFeatureRoutes([original]);
    expect(guarded).toBe(original);
  });

  it("lets an unmanaged flag through to the original handler", async () => {
    mockGetFeature.mockResolvedValue(feature(false));
    const original = route("delete");
    const [guarded] = guardManagedFeatureRoutes([original]);
    await expect(
      guarded.rawHandler({ params: { id: "flag" }, context: {} } as never),
    ).resolves.toEqual({ ok: true });
    expect(original.rawHandler).toHaveBeenCalled();
  });
});
