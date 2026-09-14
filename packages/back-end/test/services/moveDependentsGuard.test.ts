import type { ReqContext } from "back-end/types/request";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
import { getAllExperimentsForStaleGraph } from "back-end/src/models/ExperimentModel";
import { findSDKConnectionsByOrganization } from "back-end/src/models/SdkConnectionModel";
import {
  assertFeatureMoveDependentsGuard,
  deliveryScopeNarrowed,
  getAffectedConnections,
  getStrandedDependents,
} from "back-end/src/services/moveDependentsGuard";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeaturesWithoutEditorFields: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getAllExperimentsForStaleGraph: jest.fn(),
}));
jest.mock("back-end/src/models/SdkConnectionModel", () => ({
  findSDKConnectionsByOrganization: jest.fn(),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: jest.fn((org) => ({ org })),
  getEnvironments: jest.fn(() => [{ id: "production" }]),
}));

const inA = { project: "A" };
const inB = { project: "B" };
const conn = (
  projects: string[],
  extra: {
    includeReferencedPrerequisites?: boolean;
    sdkVersion?: string;
  } = {},
) => ({
  projects,
  languages: ["javascript"],
  sdkVersion: "1.5.0",
  ...extra,
});

describe("deliveryScopeNarrowed", () => {
  it.each([
    ["moving to another project", inA, inB, true],
    [
      "dropping a targeting project",
      { ...inA, targetingProjects: ["B"] },
      inA,
      true,
    ],
    ["leaving all-projects", { targetingAllProjects: true }, inA, true],
    [
      "keeping the old project as a targeting project",
      inA,
      { ...inB, targetingProjects: ["A"] },
      false,
    ],
    [
      "adding a targeting project",
      inA,
      { ...inA, targetingProjects: ["B"] },
      false,
    ],
    ["going all-projects", inA, { ...inA, targetingAllProjects: true }, false],
  ])("%s → %s", (_label, before, after, expected) => {
    expect(deliveryScopeNarrowed(before, after)).toBe(expected);
  });
});

describe("getAffectedConnections", () => {
  // The parent leaves B for A.
  it.each([
    ["no project filter", conn([]), false],
    ["a connection that keeps the parent", conn(["A", "B"]), false],
    ["a connection serving another project", conn(["C"]), false],
    [
      "a connection that carries prerequisites",
      conn(["B"], { includeReferencedPrerequisites: true }),
      false,
    ],
    [
      "an SDK too old to evaluate prerequisites",
      conn(["B"], {
        includeReferencedPrerequisites: true,
        sdkVersion: "0.20.0",
      }),
      true,
    ],
    ["a connection without prerequisite carrying", conn(["B"]), true],
  ])("%s → affected: %s", (_label, connection, affected) => {
    expect(getAffectedConnections(inB, inA, [connection])).toHaveLength(
      affected ? 1 : 0,
    );
  });
});

describe("getStrandedDependents", () => {
  const dependents = {
    features: [{ id: "dep", ...inB }],
    experiments: [{ id: "exp", project: "B" }],
  };

  it("counts each dependent once across connections and skips connections serving none", () => {
    expect(
      getStrandedDependents(dependents, [
        conn(["B"]),
        conn(["B", "C"]),
        conn(["C"]),
      ]),
    ).toEqual({ connections: 2, features: 1, experiments: 1 });
  });

  it("matches an all-projects dependent through any connection", () => {
    const res = getStrandedDependents(
      {
        features: [{ id: "dep", targetingAllProjects: true }],
        experiments: [],
      },
      [conn(["B"])],
    );
    expect(res.features).toBe(1);
  });
});

describe("assertFeatureMoveDependentsGuard", () => {
  const context = {
    org: { id: "org" },
    ignoreWarnings: false,
  } as unknown as ReqContext;
  const parent = { id: "parent", ...inB };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getAllFeaturesWithoutEditorFields).mockResolvedValue([
      {
        id: "dep",
        ...inB,
        prerequisites: [{ id: "parent", condition: "{}" }],
      },
    ] as never);
    jest.mocked(getAllExperimentsForStaleGraph).mockResolvedValue([]);
    jest
      .mocked(findSDKConnectionsByOrganization)
      .mockResolvedValue([conn(["B"])] as never);
  });

  it("warns with the stranded counts, and lets ignoreWarnings through", async () => {
    await expect(
      assertFeatureMoveDependentsGuard(context, parent, inA),
    ).rejects.toMatchObject({
      status: 422,
      warnings: ["1 feature flag(s)"],
    });
    await expect(
      assertFeatureMoveDependentsGuard(
        { ...context, ignoreWarnings: true } as ReqContext,
        parent,
        inA,
      ),
    ).resolves.toBeUndefined();
  });

  it("does not scan when the scope only widens, is unchanged, or no connection is affected", async () => {
    await assertFeatureMoveDependentsGuard(context, parent, {
      targetingProjects: ["A"],
    });
    await assertFeatureMoveDependentsGuard(context, parent, undefined);
    jest
      .mocked(findSDKConnectionsByOrganization)
      .mockResolvedValue([
        conn(["B"], { includeReferencedPrerequisites: true }),
      ] as never);
    await assertFeatureMoveDependentsGuard(context, parent, inA);
    expect(getAllFeaturesWithoutEditorFields).not.toHaveBeenCalled();
  });
});
