import type { FeatureInterface } from "shared/types/feature";
import type { ReqContext } from "back-end/types/request";
import {
  canEnableFeatureAutoPublishOnApproval,
  canPublishFeatureRevision,
  canScheduleFeaturePublish,
} from "back-end/src/api/features/autoPublishOnApproval";

const feature = {
  id: "flag",
  organization: "org",
  project: "prj_b",
  targetingProjects: [],
  environmentSettings: { production: { enabled: true, rules: [] } },
} as unknown as FeatureInterface;

// No version, so the environment scope resolves without loading revisions.
const stagesA = { metadata: { targetingProjects: ["prj_a"] } };

function contextWith(canTarget: boolean): ReqContext {
  return {
    org: {
      settings: {
        environments: [{ id: "production" }],
        requireReviews: [
          {
            requireReviewOn: true,
            projects: [],
            environments: [],
            autopublishOnApproval: true,
          },
        ],
      },
    },
    hasPremiumFeature: () => true,
    getTargetingOptOutProjectIds: async () => [],
    permissions: {
      canPublishFeature: () => true,
      canTargetFeatureProjects: () => canTarget,
    },
  } as unknown as ReqContext;
}

describe("arming a future publish that widens targeting", () => {
  it("takes the targeting atom to arm, but not to cancel or disarm", async () => {
    const context = contextWith(false);
    expect(await canScheduleFeaturePublish(context, feature, stagesA)).toBe(
      false,
    );
    expect(
      await canEnableFeatureAutoPublishOnApproval(context, feature, stagesA),
    ).toBe(false);
    expect(await canPublishFeatureRevision(context, feature, stagesA)).toBe(
      true,
    );
  });

  it("arms once the atom is held", async () => {
    const context = contextWith(true);
    expect(await canScheduleFeaturePublish(context, feature, stagesA)).toBe(
      true,
    );
    expect(
      await canEnableFeatureAutoPublishOnApproval(context, feature, stagesA),
    ).toBe(true);
  });
});
