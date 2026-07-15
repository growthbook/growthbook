import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { deriveRevisionEventEnvironments } from "back-end/src/events/eventEnvironments";

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
}));
jest.mock("back-end/src/models/EventModel", () => ({
  createEvent: jest.fn(),
}));
jest.mock("back-end/src/util/logger", () => ({
  logger: { error: jest.fn() },
}));
// The real services/features pulls in a heavy model/integration chain that
// this unit test must not load. Only referenced inside dispatch functions,
// which these tests never call.
jest.mock("back-end/src/services/features", () => ({
  revisionToApiInterface: jest.fn(),
  toApiRevision: jest.fn(),
}));
jest.mock("back-end/src/services/audit", () => ({
  auditDetailsUpdate: jest.fn(),
}));
jest.mock("back-end/src/util/organization.util", () => ({
  getEnvironments: jest.fn(() => []),
}));

import { getPublishedRevisionForEvents } from "back-end/src/services/featureRevisionEvents";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { logger } from "back-end/src/util/logger";

const mockGetRevision = getRevision as jest.MockedFunction<typeof getRevision>;

// Dispatch of `feature.revision.*` events fans out to webhook/Slack filters
// keyed by (project, tag, environment). The derivation here feeds that
// `environments` filter. Regression: `Object.keys(revision.rules)` returns
// numeric indices on the v2 `FeatureRule[]` array, silently dropping every
// project-scoped filter's subscribers. These tests pin the flat read path.

const mkFeature = (
  overrides: Partial<FeatureInterface> = {},
): FeatureInterface =>
  ({
    id: "f1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    defaultValue: "x",
    organization: "org-1",
    owner: "",
    valueType: "string",
    archived: false,
    description: "",
    version: 1,
    environmentSettings: {
      production: { enabled: true, rules: [] },
      dev: { enabled: true, rules: [] },
    },
    ...overrides,
  }) as FeatureInterface;

const mkRule = (
  id: string,
  scope: { allEnvironments?: boolean; environments?: string[] },
): FeatureRule =>
  ({
    type: "force",
    id,
    description: "",
    enabled: true,
    value: id,
    ...scope,
  }) as FeatureRule;

const mkRevision = (
  rules: FeatureRevisionInterface["rules"],
): FeatureRevisionInterface =>
  ({
    organization: "org-1",
    featureId: "f1",
    version: 2,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    createdBy: null,
    status: "published",
    baseVersion: 1,
    comment: "",
    defaultValue: "x",
    rules,
  }) as unknown as FeatureRevisionInterface;

const orgEnvs = (): Environment[] => [
  { id: "production" } as Environment,
  { id: "dev" } as Environment,
  { id: "staging" } as Environment,
];

describe("deriveRevisionEventEnvironments", () => {
  it("honors caller override above all other sources", () => {
    const feature = mkFeature();
    const revision = mkRevision([mkRule("r1", { allEnvironments: true })]);
    const out = deriveRevisionEventEnvironments(feature, revision, orgEnvs(), [
      "production",
    ]);
    expect(out).toEqual(["production"]);
  });

  it("honors empty caller override (explicit no-op) over v2 scope expansion", () => {
    const feature = mkFeature();
    const revision = mkRevision([mkRule("r1", { allEnvironments: true })]);
    const out = deriveRevisionEventEnvironments(
      feature,
      revision,
      orgEnvs(),
      [],
    );
    expect(out).toEqual([]);
  });

  it("expands v2 allEnvironments rules to every applicable org env", () => {
    const feature = mkFeature();
    const revision = mkRevision([mkRule("r1", { allEnvironments: true })]);
    const out = deriveRevisionEventEnvironments(feature, revision, orgEnvs());
    expect(out.sort()).toEqual(["dev", "production", "staging"]);
  });

  it("unions env-scoped v2 rules across the revision", () => {
    const feature = mkFeature();
    const revision = mkRevision([
      mkRule("r1", { environments: ["production"] }),
      mkRule("r2", { environments: ["dev"] }),
      mkRule("r3", { environments: ["production"] }),
    ]);
    const out = deriveRevisionEventEnvironments(feature, revision, orgEnvs());
    expect(out.sort()).toEqual(["dev", "production"]);
  });

  it("mixes allEnvironments + env-scoped v2 rules into a single union", () => {
    const feature = mkFeature();
    const revision = mkRevision([
      mkRule("r1", { environments: ["production"] }),
      mkRule("r2", { allEnvironments: true }),
    ]);
    const out = deriveRevisionEventEnvironments(feature, revision, orgEnvs());
    expect(out.sort()).toEqual(["dev", "production", "staging"]);
  });

  it("filters out org envs not applicable to the feature's project", () => {
    const feature = mkFeature({ project: "proj-a" });
    const envs: Environment[] = [
      { id: "production" } as Environment,
      { id: "dev", projects: ["proj-a"] } as Environment,
      { id: "staging", projects: ["proj-b"] } as Environment,
    ];
    // allEnvironments rule expands to applicable set only — staging (proj-b)
    // must NOT appear even though it exists on the org.
    const revision = mkRevision([mkRule("r1", { allEnvironments: true })]);
    const out = deriveRevisionEventEnvironments(feature, revision, envs);
    expect(out.sort()).toEqual(["dev", "production"]);
  });

  it("filters rule-declared envs excluded from the feature's project", () => {
    const feature = mkFeature({ project: "proj-a" });
    const envs: Environment[] = [
      { id: "production" } as Environment,
      { id: "dev", projects: ["proj-a"] } as Environment,
      { id: "staging", projects: ["proj-b"] } as Environment,
    ];
    // Rule explicitly targets staging even though it's excluded from proj-a.
    // Final inProject filter must drop it.
    const revision = mkRevision([
      mkRule("r1", { environments: ["production", "staging"] }),
    ]);
    const out = deriveRevisionEventEnvironments(feature, revision, envs);
    expect(out.sort()).toEqual(["production"]);
  });

  it("falls back to feature.environmentSettings keys when revision has zero rules", () => {
    const feature = mkFeature();
    const revision = mkRevision([]);
    const out = deriveRevisionEventEnvironments(feature, revision, orgEnvs());
    expect(out.sort()).toEqual(["dev", "production"]);
  });

  it("falls back to feature.environmentSettings keys when revision.rules is a legacy v1 Record", () => {
    // For a v1 `Record<env, rules>` we can't trust `Object.keys` (env keys)
    // vs the v2 array case (numeric indices). Detect the non-array shape and
    // fall through to envSettings for a sensible env list.
    const feature = mkFeature();
    const v1LikeRevision = {
      organization: "org-1",
      featureId: "f1",
      version: 2,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      createdBy: null,
      status: "published",
      baseVersion: 1,
      comment: "",
      defaultValue: "x",
      rules: {
        production: [mkRule("r1", { allEnvironments: true })],
        dev: [],
      },
    } as unknown as FeatureRevisionInterface;
    const out = deriveRevisionEventEnvironments(
      feature,
      v1LikeRevision,
      orgEnvs(),
    );
    expect(out.sort()).toEqual(["dev", "production"]);
  });

  it("ignores malformed rules (no allEnvironments, no environments[]) when deriving from v2", () => {
    // A malformed rule doesn't contribute any envs — we don't expand it to
    // "all applicable" the way `ruleAppliesToEnv` does for a single-env
    // check, because an event fanout should have an explicit scope signal.
    // Other rules in the revision still drive the list.
    const feature = mkFeature();
    const revision = mkRevision([
      mkRule("r-malformed", {}),
      mkRule("r-typed", { environments: ["production"] }),
    ]);
    const out = deriveRevisionEventEnvironments(feature, revision, orgEnvs());
    expect(out).toEqual(["production"]);
  });

  it("returns empty when every source is empty", () => {
    const feature = mkFeature({ environmentSettings: {} });
    const revision = mkRevision([]);
    const out = deriveRevisionEventEnvironments(feature, revision, []);
    expect(out).toEqual([]);
  });

  it("dedupes envs declared by multiple rules", () => {
    const feature = mkFeature();
    const revision = mkRevision([
      mkRule("r1", { environments: ["production"] }),
      mkRule("r2", { environments: ["production", "dev"] }),
      mkRule("r3", { allEnvironments: true }),
    ]);
    const out = deriveRevisionEventEnvironments(feature, revision, orgEnvs());
    expect(out.sort()).toEqual(["dev", "production", "staging"]);
    // Each env listed exactly once.
    expect(new Set(out).size).toBe(out.length);
  });
});

describe("getPublishedRevisionForEvents", () => {
  const ctx = { org: { id: "org-1" } } as never;
  const feature = mkFeature();
  const fallback = {
    version: 7,
    status: "draft",
  } as unknown as FeatureRevisionInterface;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the re-read revision when the read succeeds", async () => {
    const published = { version: 7, status: "published" } as never;
    mockGetRevision.mockResolvedValue(published);

    const result = await getPublishedRevisionForEvents(ctx, feature, fallback);

    expect(result).toBe(published);
    expect(mockGetRevision).toHaveBeenCalledWith({
      context: ctx,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version: 7,
    });
  });

  it("returns the fallback when the read finds nothing", async () => {
    mockGetRevision.mockResolvedValue(null);

    const result = await getPublishedRevisionForEvents(ctx, feature, fallback);

    expect(result).toBe(fallback);
  });

  it("returns the fallback and logs instead of throwing when the read fails", async () => {
    mockGetRevision.mockRejectedValue(new Error("mongo unavailable"));

    const result = await getPublishedRevisionForEvents(ctx, feature, fallback);

    expect(result).toBe(fallback);
    expect(logger.error).toHaveBeenCalled();
  });
});
