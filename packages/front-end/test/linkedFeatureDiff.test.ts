import { LinkedFeatureInfo } from "shared/types/experiment";
import {
  environmentStatesDiffer,
  hasUnpublishedChanges,
} from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";

type PendingDraft = NonNullable<LinkedFeatureInfo["pendingDraft"]>;
type DiffInfo = Pick<
  LinkedFeatureInfo,
  "liveValues" | "pendingDraft" | "liveEnvironmentStates"
>;
type EnvInfo = Pick<
  LinkedFeatureInfo,
  "liveEnvironmentStates" | "pendingDraft"
>;

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

  it("is false without a draft", () => {
    const info: DiffInfo = {
      liveValues: live,
      liveEnvironmentStates: { prod: "active" },
      pendingDraft: undefined,
    };
    expect(hasUnpublishedChanges(info)).toBe(false);
  });

  it("is false for a draft that moves no value or environment", () => {
    const info: DiffInfo = {
      liveValues: live,
      liveEnvironmentStates: { prod: "active" },
      pendingDraft: draft({
        values: live,
        environmentStates: { prod: "active" },
      }),
    };
    expect(hasUnpublishedChanges(info)).toBe(false);
  });

  it("is true when a draft value moves against live", () => {
    const info: DiffInfo = {
      liveValues: live,
      liveEnvironmentStates: { prod: "active" },
      pendingDraft: draft({
        values: [
          { variationId: "a", value: "1" },
          { variationId: "b", value: "3" },
        ],
        environmentStates: { prod: "active" },
      }),
    };
    expect(hasUnpublishedChanges(info)).toBe(true);
  });

  it("is true when nothing is live yet", () => {
    const info: DiffInfo = {
      liveValues: undefined,
      liveEnvironmentStates: { prod: "active" },
      pendingDraft: draft({
        values: [{ variationId: "a", value: "x" }],
        environmentStates: { prod: "active" },
      }),
    };
    expect(hasUnpublishedChanges(info)).toBe(true);
  });

  it("is true when only the environments move", () => {
    const info: DiffInfo = {
      liveValues: live,
      liveEnvironmentStates: { prod: "active" },
      pendingDraft: draft({
        values: live,
        environmentStates: { prod: "disabled-env" },
      }),
    };
    expect(hasUnpublishedChanges(info)).toBe(true);
  });
});

describe("environmentStatesDiffer", () => {
  it("is false without a draft", () => {
    const info: EnvInfo = {
      liveEnvironmentStates: { prod: "active" },
      pendingDraft: undefined,
    };
    expect(environmentStatesDiffer(info)).toBe(false);
  });

  it("is true when the draft is the first thing to set environments", () => {
    const info: EnvInfo = {
      liveEnvironmentStates: undefined,
      pendingDraft: draft({ environmentStates: { prod: "active" } }),
    };
    expect(environmentStatesDiffer(info)).toBe(true);
  });

  it("compares the draft's environments against live", () => {
    const same: EnvInfo = {
      liveEnvironmentStates: { prod: "active", dev: "disabled-env" },
      pendingDraft: draft({
        environmentStates: { prod: "active", dev: "disabled-env" },
      }),
    };
    const moved: EnvInfo = {
      liveEnvironmentStates: { prod: "active", dev: "disabled-env" },
      pendingDraft: draft({
        environmentStates: { prod: "active", dev: "active" },
      }),
    };
    expect(environmentStatesDiffer(same)).toBe(false);
    expect(environmentStatesDiffer(moved)).toBe(true);
  });
});
