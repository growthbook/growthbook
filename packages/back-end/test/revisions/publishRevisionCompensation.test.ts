import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { Context } from "back-end/src/models/BaseModel";
import { publishRevision } from "back-end/src/models/FeatureModel";
import { withBufferedPayloadRefreshes } from "back-end/src/revisions/landingSequence";

const FEATURE_ID = "feat_compensated";

const feature = {
  id: FEATURE_ID,
  organization: "org_spike",
  version: 1,
  valueType: "boolean",
  defaultValue: "false",
  owner: "",
  tags: [],
  project: "",
  rules: [],
  environmentSettings: { production: { enabled: true, rules: [] } },
  dateCreated: new Date(0),
  dateUpdated: new Date(0),
} as unknown as FeatureInterface;

const revision = {
  organization: "org_spike",
  featureId: FEATURE_ID,
  version: 2,
  status: "draft",
  baseVersion: 1,
  rules: {},
  rampActions: [
    { mode: "create", ruleId: "rule_1", steps: [], endActions: [] },
  ],
} as unknown as FeatureRevisionInterface;

function ctx(): Context {
  return {
    org: {
      id: "org_spike",
      settings: { environments: [{ id: "production", description: "" }] },
    },
    auditUser: { type: "api_key", apiKey: "key_spike" },
    hasPremiumFeature: () => false,
    throwPlanDoesNotAllowError: (msg: string) => {
      throw new Error(msg);
    },
    models: {},
    sdkPayloadRefreshBuffer: null,
    bulkPublishDeferredEvents: null,
  } as unknown as Context;
}

/**
 * The single-entity feature landing reports what it put back.
 *
 * That recording is what decides the fate of the `feature.updated` its apply deferred,
 * and deleting the call outright left the whole suite green — the predicate had tests,
 * its invocation did not.
 *
 * No module mocks. A `create` ramp action makes `createRampSchedulesForRevision` the
 * first step inside the try, and its premium gate is entirely context-owned, so a
 * context without the feature throws mid-landing. `bypassLockdown` and
 * `skipPrevalidateValidation` keep everything before that point off mongoose, and an
 * inert `result` skips the authority gate. The outer `withBufferedPayloadRefreshes`
 * makes the landing's own wrapper a pass-through so the test owns the `restored` set.
 *
 * Covers the branch where the predicate returns TRUE with nothing written. The
 * doc-rewind-failed and ownership-lost branches need `applyRevisionChanges` to really
 * land — mongodb-memory-server, as `updateFeatureGuard` and `stranded-merge-recovery`
 * do — and are covered at the predicate instead.
 */
it("reports the feature as restored when a failed publish wrote nothing", async () => {
  const context = ctx();
  let restored: Set<string> | undefined;

  await expect(
    withBufferedPayloadRefreshes(context, "outer", async () => {
      restored = context.bulkPublishRestoredEntities;
      return publishRevision({
        context,
        feature,
        revision,
        result: {},
        bypassLockdown: true,
        skipPrevalidateValidation: true,
      });
    }),
  ).rejects.toThrow(/Pro plan/);

  expect(restored && [...restored]).toEqual([FEATURE_ID]);
});
