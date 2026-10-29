import { LinkedFeatureInfo } from "shared/types/experiment";
import { hasUnpublishedChanges } from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";

type PendingDraft = NonNullable<LinkedFeatureInfo["pendingDraft"]>;

const draft = (overrides: Partial<PendingDraft>): PendingDraft =>
  ({
    version: 2,
    status: "draft",
    values: [],
    environmentStates: {},
    sparse: false,
    defaultValue: "{}",
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
    {
      name: "is true when only sparse turns on",
      liveValues: live,
      liveEnvs: prod,
      draftValues: live,
      draftEnvs: prod,
      draftSparse: true,
      expected: true,
    },
    {
      name: "is true when only sparse turns off",
      liveValues: live,
      liveSparse: true,
      liveEnvs: prod,
      draftValues: live,
      draftEnvs: prod,
      expected: true,
    },
    {
      name: "is true when only the default under sparse values moves",
      liveValues: live,
      liveSparse: true,
      liveEnvs: prod,
      draftValues: live,
      draftEnvs: prod,
      draftSparse: true,
      draftDefault: '{"color":"blue"}',
      expected: true,
    },
    {
      name: "is false when sparse values merge onto the same default",
      liveValues: live,
      liveSparse: true,
      liveEnvs: prod,
      draftValues: live,
      draftEnvs: prod,
      draftSparse: true,
      expected: false,
    },
    {
      name: "is false when only the default moves under whole values",
      liveValues: live,
      liveEnvs: prod,
      draftValues: live,
      draftEnvs: prod,
      draftDefault: '{"color":"blue"}',
      expected: false,
    },
  ] as {
    name: string;
    liveValues?: LinkedFeatureInfo["liveValues"];
    liveSparse?: boolean;
    liveEnvs?: LinkedFeatureInfo["liveEnvironmentStates"];
    draftValues?: PendingDraft["values"];
    draftEnvs?: PendingDraft["environmentStates"];
    draftSparse?: boolean;
    draftDefault?: string;
    expected: boolean;
  }[])(
    "$name",
    ({
      liveValues,
      liveSparse,
      liveEnvs,
      draftValues,
      draftEnvs,
      draftSparse = false,
      draftDefault = "{}",
      expected,
    }) => {
      expect(
        hasUnpublishedChanges({
          feature: { defaultValue: "{}" },
          liveValues,
          liveSparse,
          liveEnvironmentStates: liveEnvs,
          pendingDraft: draftValues
            ? draft({
                values: draftValues,
                environmentStates: draftEnvs,
                sparse: draftSparse,
                defaultValue: draftDefault,
              })
            : undefined,
        }),
      ).toBe(expected);
    },
  );
});
