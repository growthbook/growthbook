import { LinkedFeatureInfo } from "shared/types/experiment";
import { hasUnpublishedChanges } from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";

type PendingDraft = NonNullable<LinkedFeatureInfo["pendingDraft"]>;

const draft = (overrides: Partial<PendingDraft>): PendingDraft =>
  ({
    version: 2,
    status: "draft",
    values: [],
    environmentStates: {},
    ...overrides,
  }) as PendingDraft;

describe("hasUnpublishedChanges", () => {
  const live = [
    { variationId: "a", value: "1" },
    { variationId: "b", value: "2" },
  ];
  const prod: PendingDraft["environmentStates"] = { prod: "active" };

  it.each([
    {
      name: "is false without a draft",
      liveValues: live,
      liveEnvs: prod,
      expected: false,
    },
    {
      name: "is false for a draft that moves no value or environment",
      liveValues: live,
      liveEnvs: prod,
      draftValues: live,
      draftEnvs: prod,
      expected: false,
    },
    {
      name: "is true when a draft value moves against live",
      liveValues: live,
      liveEnvs: prod,
      draftValues: [
        { variationId: "a", value: "1" },
        { variationId: "b", value: "3" },
      ],
      draftEnvs: prod,
      expected: true,
    },
    {
      name: "is true when nothing is live yet",
      liveEnvs: prod,
      draftValues: [{ variationId: "a", value: "x" }],
      draftEnvs: prod,
      expected: true,
    },
    {
      name: "is true when only the environments move",
      liveValues: live,
      liveEnvs: prod,
      draftValues: live,
      draftEnvs: { prod: "disabled-env" },
      expected: true,
    },
    {
      name: "is true when the draft is the first to set environments",
      liveValues: live,
      draftValues: live,
      draftEnvs: prod,
      expected: true,
    },
  ] as {
    name: string;
    liveValues?: LinkedFeatureInfo["liveValues"];
    liveEnvs?: LinkedFeatureInfo["liveEnvironmentStates"];
    draftValues?: PendingDraft["values"];
    draftEnvs?: PendingDraft["environmentStates"];
    expected: boolean;
  }[])(
    "$name",
    ({ liveValues, liveEnvs, draftValues, draftEnvs, expected }) => {
      expect(
        hasUnpublishedChanges({
          liveValues,
          liveEnvironmentStates: liveEnvs,
          pendingDraft: draftValues
            ? draft({ values: draftValues, environmentStates: draftEnvs })
            : undefined,
        }),
      ).toBe(expected);
    },
  );
});
