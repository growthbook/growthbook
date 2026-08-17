import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { Context } from "back-end/src/models/BaseModel";
import { runInSandbox } from "back-end/src/enterprise/sandbox/sandbox-pool";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import {
  collectValidateFeatureRevisionHookResults,
  runValidateFeatureRevisionHooks,
} from "back-end/src/enterprise/sandbox/sandbox-eval";

// The derivation formula is covered in shared/test/util/features.test.ts; this
// only confirms the hook runner wires it in at every call site.
jest.mock("back-end/src/enterprise/sandbox/sandbox-pool", () => ({
  runInSandbox: jest.fn(),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: jest.fn(),
}));

const mockRunInSandbox = runInSandbox as jest.MockedFunction<
  typeof runInSandbox
>;
const mockAgendaContext =
  getContextForAgendaJobByOrgObject as jest.MockedFunction<
    typeof getContextForAgendaJobByOrgObject
  >;

const feature = { id: "feat_test", tags: ["live"] } as FeatureInterface;
const withTags = (tags: string[]) =>
  ({ metadata: { tags } }) as FeatureRevisionInterface;

const context = {
  hasPremiumFeature: () => true,
  canSkipHooksFor: () => false,
  ignoreWarnings: false,
  models: {
    customHooks: {
      getByHook: jest.fn(async () => [
        { hook: "validateFeatureRevision", incrementalChangesOnly: true },
      ]),
      logSuccess: jest.fn(),
      logFailure: jest.fn(),
    },
  },
} as unknown as Context;

function tagsArg(call: number) {
  return (mockRunInSandbox.mock.calls[call][1].revision as { tags: string[] })
    .tags;
}

describe("validateFeatureRevision hook input", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAgendaContext.mockReturnValue(context);
    // Both calls fail identically, so incrementalChangesOnly's re-run against
    // `original` happens without throwing — letting both args be inspected.
    mockRunInSandbox.mockResolvedValue({ ok: false, error: "x", warnings: [] });
  });

  it("derives tags for both the staged and original revision args", async () => {
    await runValidateFeatureRevisionHooks({
      context,
      feature,
      revision: withTags(["staged"]),
      original: withTags(["base"]),
    });

    expect(tagsArg(0)).toEqual(["staged"]);
    expect(tagsArg(1)).toEqual(["base"]);
  });

  it("does the same for the non-throwing publish-gate variant", async () => {
    await collectValidateFeatureRevisionHookResults({
      context,
      feature,
      revision: withTags(["staged"]),
      original: withTags(["base"]),
    });

    expect(tagsArg(0)).toEqual(["staged"]);
    expect(tagsArg(1)).toEqual(["base"]);
  });

  it("does not mutate the revision object, which gets persisted after this call", async () => {
    const revision = withTags(["staged"]);
    await runValidateFeatureRevisionHooks({
      context,
      feature,
      revision,
      original: withTags(["base"]),
    });

    expect(revision).not.toHaveProperty("tags");
  });
});
