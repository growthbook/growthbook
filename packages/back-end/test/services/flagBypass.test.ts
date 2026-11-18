import type { FeatureInterface } from "shared/types/feature";
import type { ReqContext } from "back-end/types/request";
import { flagBypass } from "back-end/src/services/featurePublishGates";

const contextThat = (canBypass: boolean) =>
  ({
    permissions: { canBypassFlagApprovalChecks: () => canBypass },
  }) as unknown as ReqContext;
const feature = { id: "flag" } as FeatureInterface;

describe("flagBypass", () => {
  it.each([
    // The caller's own bypass counts only once they opt in.
    {
      canBypass: true,
      optIn: false,
      rest: false,
      approval: false,
      lockdown: false,
    },
    {
      canBypass: true,
      optIn: true,
      rest: false,
      approval: true,
      lockdown: true,
    },
    {
      canBypass: false,
      optIn: true,
      rest: false,
      approval: false,
      lockdown: false,
    },
    // The REST setting waives approval as the publish endpoints do; the
    // lockdown still needs the opt-in.
    {
      canBypass: false,
      optIn: false,
      rest: true,
      approval: true,
      lockdown: false,
    },
    {
      canBypass: false,
      optIn: true,
      rest: true,
      approval: true,
      lockdown: true,
    },
  ])(
    "can bypass $canBypass, opted in $optIn, REST setting $rest",
    ({ canBypass, optIn, rest, approval, lockdown }) => {
      expect(
        flagBypass(contextThat(canBypass), feature, {
          optIn,
          restApiBypassesReviews: rest,
        }),
      ).toEqual({ approval, lockdown });
    },
  );
});
