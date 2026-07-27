import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  RevisionChanges,
} from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import {
  computeRevisionUpdate,
  computeRevisionPublishChanges,
} from "back-end/src/models/FeatureRevisionModel";
import { ReqContext } from "back-end/types/request";

const ORG_ENVS: Environment[] = [
  { id: "dev", description: "" },
  { id: "production", description: "" },
];

function mockContext(envs: Environment[] = ORG_ENVS): ReqContext {
  return {
    org: { settings: { environments: envs } },
  } as unknown as ReqContext;
}

const FEATURE = {
  id: "feat_test",
  organization: "org_test",
  project: "",
} as unknown as FeatureInterface;

function makeRevision(
  overrides: Partial<FeatureRevisionInterface> = {},
): FeatureRevisionInterface {
  return {
    organization: "org_test",
    featureId: "feat_test",
    version: 2,
    baseVersion: 1,
    dateCreated: new Date("2024-01-01"),
    dateUpdated: new Date("2024-01-01"),
    datePublished: null,
    createdBy: { type: "dashboard", id: "u", email: "", name: "" },
    comment: "",
    defaultValue: "true",
    rules: [],
    status: "draft",
    log: [],
    ...overrides,
  } as FeatureRevisionInterface;
}

function v2Rule(id: string) {
  return {
    id,
    type: "force" as const,
    description: "",
    value: "true",
    enabled: true,
    allEnvironments: true,
  };
}

describe("computeRevisionUpdate", () => {
  it("merges normalized changes and status into proposedRevision", () => {
    const revision = makeRevision();
    const changes: RevisionChanges = { defaultValue: "false" };

    const { normalizedChanges, status, proposedRevision } =
      computeRevisionUpdate(mockContext(), FEATURE, revision, changes, false);

    expect(status).toBe("draft");
    expect(normalizedChanges).toEqual(changes);
    expect(proposedRevision).toEqual({
      ...revision,
      ...normalizedChanges,
      status,
    });
  });

  it("throws for mutable changes on a published revision", () => {
    const revision = makeRevision({ status: "published" });

    expect(() =>
      computeRevisionUpdate(
        mockContext(),
        FEATURE,
        revision,
        { rules: [v2Rule("r1")] },
        false,
      ),
    ).toThrow("Can only update draft revisions");
  });

  it("allows non-mutable changes on a published revision", () => {
    const revision = makeRevision({ status: "published" });

    const { status } = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      {},
      false,
    );

    expect(status).toBe("published");
  });

  it("resets changes-requested to pending-review on content changes", () => {
    const revision = makeRevision({ status: "changes-requested" });

    const { status, proposedRevision } = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      { defaultValue: "false" },
      false,
    );

    expect(status).toBe("pending-review");
    expect(proposedRevision.status).toBe("pending-review");
  });

  it("resets approved to pending-review only when resetReview is set", () => {
    const revision = makeRevision({ status: "approved" });

    const kept = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      { defaultValue: "false" },
      false,
    );
    expect(kept.status).toBe("approved");

    const reset = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      { defaultValue: "false" },
      true,
    );
    expect(reset.status).toBe("pending-review");
  });

  it("normalizes v1 env-keyed rules into a flat v2 array", () => {
    const revision = makeRevision();
    const changes = {
      rules: {
        production: [
          {
            id: "r1",
            type: "force",
            description: "",
            value: "true",
            enabled: true,
          },
        ],
      },
    } as unknown as RevisionChanges;

    const { normalizedChanges, proposedRevision } = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      changes,
      false,
    );

    expect(Array.isArray(normalizedChanges.rules)).toBe(true);
    expect(proposedRevision.rules).toBe(normalizedChanges.rules);
  });

  it("is deterministic: identical inputs produce identical proposed states", () => {
    const revision = makeRevision({ status: "changes-requested" });
    const changes: RevisionChanges = { rules: [v2Rule("r1")] };

    const a = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      changes,
      false,
    );
    const b = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      changes,
      false,
    );

    expect(a.proposedRevision).toEqual(b.proposedRevision);
  });
});

describe("computeRevisionPublishChanges", () => {
  const user = { type: "dashboard" as const, id: "u", email: "", name: "" };

  it("computes the published status and publisher", () => {
    const revision = makeRevision();

    const changes = computeRevisionPublishChanges(
      revision,
      user,
      "publish comment",
    );

    expect(changes.status).toBe("published");
    expect(changes.publishedBy).toBe(user);
    expect(changes.datePublished).toBeInstanceOf(Date);
    expect(changes.comment).toBe("publish comment");
  });

  it("keeps the revision's own comment when present", () => {
    const revision = makeRevision({ comment: "original" });

    const changes = computeRevisionPublishChanges(revision, user, "ignored");

    expect(changes.comment).toBe("original");
  });
});
