import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "back-end/types/feature-revision";
import type { MergeResultChanges } from "shared/util";
import type { ReqContext } from "back-end/types/request";
import {
  authoredFeatureDraft,
  assertCanCreateFeatureInState,
  canAdvanceFeatureDraft,
  canRebaseFeatureDraft,
  canRecallFeatureReview,
  mergeResultTouchesPayload,
  rebasePullsInNothing,
} from "back-end/src/revisions/featureDraftAuthority";

// draftIsPureRevert reads the target revision; the narrow-atom cases here are
// about the ARCHIVE arm and about authorship, so the revert lookup is stubbed to
// "no such revision" and never decides an assertion.
jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(async () => null),
}));

/**
 * The feature family's draft-authority rules, called directly.
 *
 * They were only ever exercised through endpoints, which meant the narrow-atom
 * reach — what a revert-only or delete-only role may do to a draft, and whose
 * draft — was asserted nowhere in isolation. These are the rules the endpoints
 * delegate to, so each is worth stating on its own.
 */

const feature = {
  id: "flag",
  organization: "org",
  project: "",
  archived: false,
  defaultValue: "false",
  valueType: "boolean",
  rules: [],
  prerequisites: [],
  environmentSettings: {
    dev: { enabled: true, rules: [] },
    production: { enabled: false, rules: [] },
  },
} as unknown as FeatureInterface;

type Atoms = {
  draft?: boolean;
  revert?: boolean;
  delete?: boolean;
  publish?: boolean | ((envs: string[]) => boolean);
};

function contextWith(atoms: Atoms, userId = "u_me"): ReqContext {
  const thrown = new Error("permission denied");
  return {
    userId,
    permissions: {
      canEditFeatureDrafts: () => !!atoms.draft,
      canRevertFeature: () => !!atoms.revert,
      canDeleteFeature: () => !!atoms.delete,
      canPublishFeature: (_f: unknown, envs: string[]) =>
        typeof atoms.publish === "function"
          ? atoms.publish(envs)
          : !!atoms.publish,
      throwPermissionError: () => {
        throw thrown;
      },
    },
  } as unknown as ReqContext;
}

function draft(
  overrides: Partial<FeatureRevisionInterface> = {},
): FeatureRevisionInterface {
  return {
    organization: "org",
    featureId: "flag",
    version: 2,
    baseVersion: 1,
    status: "draft",
    createdBy: { type: "dashboard", id: "u_author", email: "", name: "" },
    contributors: [],
    ...overrides,
  } as unknown as FeatureRevisionInterface;
}

/** A draft that flips `archived` and matches live on everything else. */
function pureArchiveDraft(
  overrides: Partial<FeatureRevisionInterface> = {},
): FeatureRevisionInterface {
  return draft({
    archived: true,
    defaultValue: feature.defaultValue,
    rules: [],
    prerequisites: [],
    ...overrides,
  });
}

describe("authoredFeatureDraft", () => {
  it("counts the opener", () => {
    expect(authoredFeatureDraft(contextWith({}, "u_author"), draft())).toBe(
      true,
    );
  });

  // Co-authors have skin in the draft too — a contributor who saved changes into
  // it can recall its review request.
  it("counts a contributor", () => {
    expect(
      authoredFeatureDraft(
        contextWith({}, "u_helper"),
        draft({ contributors: ["u_helper"] }),
      ),
    ).toBe(true);
  });

  it("counts nobody else, and no API key", () => {
    expect(authoredFeatureDraft(contextWith({}, "u_other"), draft())).toBe(
      false,
    );
    const keyContext = { permissions: {} } as unknown as ReqContext;
    expect(authoredFeatureDraft(keyContext, draft())).toBe(false);
  });
});

describe("assertCanCreateFeatureInState", () => {
  const environmentIds = ["dev", "production"];

  // A flag that starts disabled everywhere reaches no SDK payload, so Create
  // alone carries it. The dashboard used to demand publish here while REST did
  // not, and the same body was accepted by one and refused by the other.
  it("asks for nothing extra when the flag starts disabled everywhere", () => {
    const disabled = {
      ...feature,
      environmentSettings: {
        dev: { enabled: false, rules: [] },
        production: { enabled: false, rules: [] },
      },
    } as unknown as FeatureInterface;
    expect(() =>
      assertCanCreateFeatureInState({
        context: contextWith({ publish: false }),
        feature: disabled,
        environmentIds,
      }),
    ).not.toThrow();
  });

  it("asks for publish in exactly the environments it starts enabled in", () => {
    const asked: string[][] = [];
    expect(() =>
      assertCanCreateFeatureInState({
        context: contextWith({
          publish: (envs) => {
            asked.push(envs);
            return true;
          },
        }),
        feature,
        environmentIds,
      }),
    ).not.toThrow();
    expect(asked).toEqual([["dev"]]);
  });

  it("refuses when publish is missing in one it starts enabled in", () => {
    expect(() =>
      assertCanCreateFeatureInState({
        context: contextWith({ publish: (envs) => !envs.includes("dev") }),
        feature,
        environmentIds,
      }),
    ).toThrow("permission denied");
  });
});

describe("canAdvanceFeatureDraft", () => {
  it("is open to draft authority, whatever the draft contains", async () => {
    await expect(
      canAdvanceFeatureDraft({
        context: contextWith({ draft: true }, "u_other"),
        feature,
        draft: draft(),
      }),
    ).resolves.toBe(true);
  });

  // The narrow atoms reach the caller's OWN draft: a revert-only role can carry
  // its own revert forward, which is what it could land in one step anyway.
  it("lets a narrow atom advance a draft it authored", async () => {
    await expect(
      canAdvanceFeatureDraft({
        context: contextWith({ revert: true }, "u_author"),
        feature,
        draft: draft(),
      }),
    ).resolves.toBe(true);
  });

  it("refuses a narrow atom on someone else's ordinary draft", async () => {
    await expect(
      canAdvanceFeatureDraft({
        context: contextWith({ revert: true }, "u_other"),
        feature,
        draft: draft(),
      }),
    ).resolves.toBe(false);
  });

  // Authorship is not enough on its own — it has to come with an atom.
  it("refuses an author holding no atom at all", async () => {
    await expect(
      canAdvanceFeatureDraft({
        context: contextWith({}, "u_author"),
        feature,
        draft: draft(),
      }),
    ).resolves.toBe(false);
  });

  // "Pure" means the draft matches live on every content field and only flips
  // `archived` — setting the flag alone isn't enough, which is what keeps the
  // delete atom from carrying an ordinary edit that happens to archive too.
  it("lets delete authority advance a pure archive opened by anyone", async () => {
    await expect(
      canAdvanceFeatureDraft({
        context: contextWith({ delete: true }, "u_other"),
        feature,
        draft: pureArchiveDraft(),
      }),
    ).resolves.toBe(true);
  });

  it("refuses delete authority on an archive that also edits the value", async () => {
    await expect(
      canAdvanceFeatureDraft({
        context: contextWith({ delete: true }, "u_other"),
        feature,
        draft: pureArchiveDraft({ defaultValue: "true" }),
      }),
    ).resolves.toBe(false);
  });
});

describe("canRecallFeatureReview", () => {
  // Deliberately narrower than advancing: retracting someone else's review
  // request isn't something a narrow atom should confer.
  it("refuses a narrow atom on a draft it did not author", async () => {
    await expect(
      canRecallFeatureReview({
        context: contextWith({ revert: true, delete: true }, "u_other"),
        feature,
        draft: pureArchiveDraft(),
      }),
    ).resolves.toBe(false);
  });

  it("allows the author holding a narrow atom", async () => {
    await expect(
      canRecallFeatureReview({
        context: contextWith({ delete: true }, "u_author"),
        feature,
        draft: draft(),
      }),
    ).resolves.toBe(true);
  });
});

describe("rebasePullsInNothing", () => {
  it("is true for an empty merge, and for an empty environment map", () => {
    expect(rebasePullsInNothing({})).toBe(true);
    expect(rebasePullsInNothing({ environmentsEnabled: {} })).toBe(true);
  });

  it("is false as soon as any field would be written", () => {
    const written: MergeResultChanges[] = [
      { defaultValue: "true" },
      { rules: [] },
      { environmentsEnabled: { dev: true } },
      { archived: false },
      { holdout: null },
      { metadata: {} },
    ];
    expect(written.map(rebasePullsInNothing)).toEqual(written.map(() => false));
  });
});

describe("canRebaseFeatureDraft", () => {
  it("needs draft authority when the merge failed, since resolutions are never a no-op", async () => {
    await expect(
      canRebaseFeatureDraft({
        context: contextWith({ revert: true }, "u_author"),
        feature,
        draft: draft(),
        mergeChanges: undefined,
      }),
    ).resolves.toBe(false);
  });

  it("lets a narrow atom rebase when the merge pulls in nothing", async () => {
    await expect(
      canRebaseFeatureDraft({
        context: contextWith({ delete: true }, "u_author"),
        feature,
        draft: draft(),
        mergeChanges: { environmentsEnabled: {} },
      }),
    ).resolves.toBe(true);
  });

  it("refuses a narrow atom when the rebase would sweep changes in", async () => {
    await expect(
      canRebaseFeatureDraft({
        context: contextWith({ delete: true }, "u_author"),
        feature,
        draft: draft(),
        mergeChanges: { defaultValue: "true" },
      }),
    ).resolves.toBe(false);
  });
});

describe("mergeResultTouchesPayload", () => {
  // Inert metadata lands without publish authority — the pre-split
  // `manageFeatures` semantic.
  it("is false for metadata that never reaches an SDK", () => {
    expect(
      mergeResultTouchesPayload({
        metadata: {
          description: "d",
          owner: "o",
          tags: ["t"],
          neverStale: true,
          customFields: {},
        },
      } as MergeResultChanges),
    ).toBe(false);
  });

  it("is false for a merge that changes nothing", () => {
    expect(mergeResultTouchesPayload({})).toBe(false);
  });

  it.each([
    ["defaultValue", { defaultValue: "true" }],
    ["rules", { rules: [] }],
    ["environmentsEnabled", { environmentsEnabled: {} }],
    ["prerequisites", { prerequisites: [] }],
    ["archived", { archived: true }],
    ["holdout", { holdout: null }],
  ])("is true for %s", (_label, result) => {
    expect(mergeResultTouchesPayload(result as MergeResultChanges)).toBe(true);
  });

  // Named keys rather than a complement, so a metadata field nobody classified
  // fails safe into "touches payload" instead of quietly landing unpublished.
  it("treats an unrecognized metadata key as payload-affecting", () => {
    expect(
      mergeResultTouchesPayload({
        metadata: { project: "prj_other" },
      } as MergeResultChanges),
    ).toBe(true);
    expect(
      mergeResultTouchesPayload({
        metadata: { somethingNew: 1 },
      } as unknown as MergeResultChanges),
    ).toBe(true);
  });
});
