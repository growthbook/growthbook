import type { Dimension } from "shared/types/integrations";
import { createIdentityPlanBuilder } from "back-end/src/queryRunners/buildIdentityPlan";

function userDimension(userIdType: string): Dimension {
  return {
    type: "user",
    dimension: {
      id: `dim_${userIdType}`,
      organization: "org",
      owner: "",
      datasource: "datasource",
      description: "",
      userIdType,
      name: userIdType,
      sql: "SELECT user_id, value FROM dimensions",
      dateCreated: null,
      dateUpdated: null,
    },
  };
}

describe("createIdentityPlanBuilder", () => {
  it("returns the exposure id type with no joins when nothing else is needed", () => {
    const buildIdentityPlan = createIdentityPlanBuilder({
      exposureBaseIdType: "user_id",
    });

    expect(buildIdentityPlan({})).toEqual({
      baseIdType: "user_id",
      joinsRequired: [],
      idJoinMap: {},
    });
  });

  it("adds joins for metric id types that do not match the exposure id type", () => {
    const buildIdentityPlan = createIdentityPlanBuilder({
      exposureBaseIdType: "user_id",
      availableIdJoins: [{ ids: ["user_id", "anonymous_id"] }],
    });

    expect(
      buildIdentityPlan({
        metricObjects: [["anonymous_id"]],
      }),
    ).toEqual({
      baseIdType: "user_id",
      joinsRequired: ["anonymous_id"],
      idJoinMap: {
        anonymous_id: "__identities_anonymous_id",
      },
    });
  });

  it("includes user dimension id types when planning inline units", () => {
    const buildIdentityPlan = createIdentityPlanBuilder({
      exposureBaseIdType: "user_id",
      availableIdJoins: [{ ids: ["user_id", "account_id"] }],
    });

    expect(
      buildIdentityPlan({
        unitDimensions: [userDimension("account_id")],
      }),
    ).toEqual({
      baseIdType: "user_id",
      joinsRequired: ["account_id"],
      idJoinMap: {
        account_id: "__identities_account_id",
      },
    });
  });

  it("respects activation and segment inclusion flags", () => {
    const buildIdentityPlan = createIdentityPlanBuilder({
      exposureBaseIdType: "user_id",
      activationIdTypes: ["anonymous_id"],
      segmentUserIdType: "account_id",
      availableIdJoins: [
        { ids: ["user_id", "anonymous_id"] },
        { ids: ["user_id", "account_id"] },
      ],
    });

    expect(buildIdentityPlan({})).toEqual({
      baseIdType: "user_id",
      joinsRequired: ["account_id", "anonymous_id"],
      idJoinMap: {
        account_id: "__identities_account_id",
        anonymous_id: "__identities_anonymous_id",
      },
    });
    expect(
      buildIdentityPlan({
        includeActivation: false,
        includeSegment: false,
      }),
    ).toEqual({
      baseIdType: "user_id",
      joinsRequired: [],
      idJoinMap: {},
    });
  });

  it("uses a forced base id type instead of the exposure id type", () => {
    const buildIdentityPlan = createIdentityPlanBuilder({
      exposureBaseIdType: "anonymous_id",
      forcedBaseIdType: "user_id",
      availableIdJoins: [{ ids: ["user_id", "anonymous_id"] }],
    });

    expect(
      buildIdentityPlan({
        metricObjects: [["user_id"]],
      }),
    ).toEqual({
      baseIdType: "user_id",
      joinsRequired: ["anonymous_id"],
      idJoinMap: {
        anonymous_id: "__identities_anonymous_id",
      },
    });
  });

  it("sanitizes identity join CTE names", () => {
    const buildIdentityPlan = createIdentityPlanBuilder({
      exposureBaseIdType: "user_id",
      availableIdJoins: [{ ids: ["user_id", "account-id.v2"] }],
    });

    expect(
      buildIdentityPlan({
        metricObjects: [["account-id.v2"]],
      }),
    ).toEqual({
      baseIdType: "user_id",
      joinsRequired: ["account-id.v2"],
      idJoinMap: {
        "account-id.v2": "__identities_accountidv2",
      },
    });
  });
});
