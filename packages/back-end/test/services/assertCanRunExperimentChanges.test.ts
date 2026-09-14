import { ExperimentInterface } from "shared/validators";
import { ReqContext } from "back-end/types/organization";
import { assertCanRunExperimentChanges } from "back-end/src/services/experiments";

// Import cycles: a lazy Proxy defers requireActual to first property access.
const getFeaturesByIdsMock = jest.fn();
const getFeatureProjectsByIdsMock = jest.fn();

jest.mock("back-end/src/models/FeatureModel", () => {
  const overrides: Record<string, unknown> = {
    getFeaturesByIds: (...args: unknown[]) => getFeaturesByIdsMock(...args),
    getFeatureProjectsByIds: (...args: unknown[]) =>
      getFeatureProjectsByIdsMock(...args),
  };
  return new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop in overrides
          ? overrides[prop]
          : jest.requireActual("back-end/src/models/FeatureModel")[prop],
    },
  );
});

const experiment = (over: Partial<ExperimentInterface> = {}) =>
  ({
    id: "exp_1",
    project: "proj_1",
    linkedFeatures: [],
    hasVisualChangesets: false,
    hasURLRedirects: false,
    ...over,
  }) as ExperimentInterface;

const canRunExperiment = jest.fn();
const throwPermissionError = jest.fn(() => {
  throw new Error("permission denied");
});

const context = {
  org: { id: "org_1", settings: { environments: [{ id: "production" }] } },
  permissions: { canRunExperiment, throwPermissionError },
} as unknown as ReqContext;

describe("assertCanRunExperimentChanges", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getFeaturesByIdsMock.mockResolvedValue([]);
    getFeatureProjectsByIdsMock.mockResolvedValue(new Map());
    canRunExperiment.mockReturnValue(false);
  });

  it("skips the check for changes that never reach a payload", async () => {
    await assertCanRunExperimentChanges(
      context,
      experiment({ hasVisualChangesets: true }),
      { description: "new text" },
    );
    expect(canRunExperiment).not.toHaveBeenCalled();
  });

  it("checks bucketing fields, which do reach the payload", async () => {
    await expect(
      assertCanRunExperimentChanges(
        context,
        experiment({ hasVisualChangesets: true }),
        { bucketVersion: 2 },
      ),
    ).rejects.toThrow("permission denied");
  });

  it("asks for every environment when a linked feature cannot be read", async () => {
    getFeatureProjectsByIdsMock.mockResolvedValue(
      new Map([["feat_1", "proj_2"]]),
    );

    await expect(
      assertCanRunExperimentChanges(
        context,
        experiment({ linkedFeatures: ["feat_1"] }),
        { status: "stopped" },
      ),
    ).rejects.toThrow("permission denied");
    expect(canRunExperiment).toHaveBeenCalledWith({ project: "proj_1" }, [
      "__ALL__",
    ]);
  });

  it("ignores ids left behind by a deleted feature", async () => {
    await assertCanRunExperimentChanges(
      context,
      experiment({ linkedFeatures: ["feat_gone"] }),
      { status: "stopped" },
    );
    expect(canRunExperiment).not.toHaveBeenCalled();
  });
});
