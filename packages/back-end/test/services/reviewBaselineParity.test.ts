import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/validators";
import type { RequireReview } from "shared/types/organization";
import type { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
}));

import { revisionRequiresReview } from "back-end/src/services/features";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";

const mockGetRevision = getRevision as jest.MockedFunction<typeof getRevision>;

/**
 * Whether a draft needs review is decided by diffing it against a baseline. The
 * draft is always a complete snapshot — `createRevision` writes every field —
 * but the stored revision it is diffed against may be a legacy document that
 * predates half of them.
 *
 * Left raw, every field the base is missing reads as a change, so
 * `revisionHasGlobalChange` returns "all" and review is demanded for a draft
 * that changed nothing. `fillRevisionFromFeature` exists to prevent exactly
 * that, and the three paths that ask this question must all use it:
 * `createAndPublishRevision`, `postFeaturePublish`, and this one.
 *
 * The matrix below pins each field that a sparse base would otherwise trip.
 */

const REVIEW_ALL: RequireReview = {
  requireReviewOn: true,
  resetReviewOnChange: false,
  // Empty = every environment is gated, so nothing here depends on env scoping.
  environments: [],
  projects: [],
};

const feature = {
  organization: "org",
  id: "feat",
  project: "",
  version: 4,
  valueType: "boolean",
  defaultValue: "false",
  rules: [],
  prerequisites: [{ id: "other", condition: "{}" }],
  archived: false,
  description: "d",
  owner: "o",
  tags: [],
  neverStale: null,
  customFields: null,
  baseConfig: null,
  environmentSettings: {
    production: { enabled: true, rules: [] },
    dev: { enabled: true, rules: [] },
  },
} as unknown as FeatureInterface;

const context = {
  org: {
    id: "org",
    settings: {
      requireReviews: [REVIEW_ALL],
      environments: [{ id: "production" }, { id: "dev" }],
    },
  },
  hasPremiumFeature: () => true,
} as unknown as ReqContext;

// What `createRevision` writes for a draft that changes nothing: a complete
// snapshot of the live feature.
const unchangedDraft = {
  version: 5,
  baseVersion: 4,
  status: "draft",
  featureId: "feat",
  organization: "org",
  defaultValue: feature.defaultValue,
  rules: [],
  environmentsEnabled: { production: true, dev: true },
  prerequisites: feature.prerequisites,
  archived: false,
  holdout: null,
  metadata: {
    description: "d",
    owner: "o",
    project: "",
    tags: [],
    neverStale: null,
    customFields: null,
    jsonSchema: undefined,
    valueType: "boolean",
    baseConfig: null,
  },
} as unknown as FeatureRevisionInterface;

// A fully-recorded base, then the same document with one envelope field
// missing — the shapes legacy documents actually take on disk.
const fullBase = {
  version: 4,
  status: "published",
  featureId: "feat",
  organization: "org",
  defaultValue: feature.defaultValue,
  rules: [],
  environmentsEnabled: { production: true, dev: true },
  prerequisites: feature.prerequisites,
  archived: false,
  holdout: null,
  metadata: unchangedDraft.metadata,
} as unknown as FeatureRevisionInterface;

const withoutField = (field: string): FeatureRevisionInterface => {
  const base = { ...fullBase } as Record<string, unknown>;
  delete base[field];
  return base as unknown as FeatureRevisionInterface;
};

const SPARSE_SHAPES: { name: string; base: FeatureRevisionInterface }[] = [
  { name: "a fully-recorded base", base: fullBase },
  { name: "a base missing defaultValue", base: withoutField("defaultValue") },
  { name: "a base missing prerequisites", base: withoutField("prerequisites") },
  { name: "a base missing archived", base: withoutField("archived") },
  { name: "a base missing holdout", base: withoutField("holdout") },
  { name: "a base missing metadata", base: withoutField("metadata") },
  {
    name: "a base missing environmentsEnabled",
    base: withoutField("environmentsEnabled"),
  },
  {
    name: "a legacy base recording only rules",
    base: {
      version: 4,
      status: "published",
      featureId: "feat",
      organization: "org",
      rules: [],
    } as unknown as FeatureRevisionInterface,
  },
];

describe("revisionRequiresReview — baseline parity", () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each(SPARSE_SHAPES)(
    "$name",
    ({ base }: { base: FeatureRevisionInterface }) => {
      it("does not demand review for a draft that changed nothing", async () => {
        mockGetRevision.mockResolvedValue(base);

        await expect(
          revisionRequiresReview(context, feature, unchangedDraft),
        ).resolves.toBe(false);
      });
    },
  );

  it("still demands review for a draft that really changed something", async () => {
    mockGetRevision.mockResolvedValue(fullBase);

    await expect(
      revisionRequiresReview(context, feature, {
        ...unchangedDraft,
        defaultValue: "true",
      } as FeatureRevisionInterface),
    ).resolves.toBe(true);
  });

  it("still demands review when a sparse base hides a real change", async () => {
    // The base never recorded prerequisites, and the draft removes the ones the
    // live feature carries. Backfilling must not paper over that.
    mockGetRevision.mockResolvedValue(withoutField("prerequisites"));

    await expect(
      revisionRequiresReview(context, feature, {
        ...unchangedDraft,
        prerequisites: [],
      } as unknown as FeatureRevisionInterface),
    ).resolves.toBe(true);
  });

  it("treats an unresolvable base by the caller's flag, not the baseline", async () => {
    mockGetRevision.mockResolvedValue(null);

    await expect(
      revisionRequiresReview(context, feature, unchangedDraft),
    ).resolves.toBe(false);
    await expect(
      revisionRequiresReview(context, feature, unchangedDraft, {
        treatUnresolvedBaseAsReview: true,
      }),
    ).resolves.toBe(true);
  });
});
