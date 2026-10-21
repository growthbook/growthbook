import { LinkedFeatureInfo } from "shared/types/experiment";
import {
  environmentStatesDiffer,
  getVariationValueChanges,
} from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";

type PendingDraft = NonNullable<LinkedFeatureInfo["pendingDraft"]>;
type DiffInfo = Pick<
  LinkedFeatureInfo,
  "values" | "liveValues" | "pendingDraft"
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

describe("getVariationValueChanges", () => {
  it("diffs the draft against live per variation", () => {
    const info: DiffInfo = {
      values: [],
      liveValues: [
        { variationId: "a", value: "1" },
        { variationId: "b", value: "2" },
      ],
      pendingDraft: draft({
        values: [
          { variationId: "a", value: "1" },
          { variationId: "b", value: "3" },
        ],
      }),
    };
    expect(getVariationValueChanges(info, ["a", "b"])).toEqual([
      {
        variationId: "a",
        before: "1",
        after: "1",
        changed: false,
        unpublished: false,
      },
      {
        variationId: "b",
        before: "2",
        after: "3",
        changed: true,
        unpublished: true,
      },
    ]);
  });

  it("marks values unpublished when nothing is live yet", () => {
    const info: DiffInfo = {
      values: [{ variationId: "a", value: "x" }],
      liveValues: undefined,
      pendingDraft: undefined,
    };
    expect(getVariationValueChanges(info, ["a", "missing"])).toEqual([
      {
        variationId: "a",
        before: undefined,
        after: "x",
        changed: false,
        unpublished: true,
      },
      {
        variationId: "missing",
        before: undefined,
        after: "",
        changed: false,
        unpublished: true,
      },
    ]);
  });

  it("reads the rule's own values when there is no draft", () => {
    const info: DiffInfo = {
      values: [{ variationId: "a", value: "live" }],
      liveValues: [{ variationId: "a", value: "live" }],
      pendingDraft: undefined,
    };
    expect(getVariationValueChanges(info, ["a"])[0]).toMatchObject({
      after: "live",
      changed: false,
      unpublished: false,
    });
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
