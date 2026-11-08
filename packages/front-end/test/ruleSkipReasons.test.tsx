import { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ApiContextualBanditInterface } from "shared/validators";
import { experimentRefSkipReason } from "@/components/Features/ExperimentRefSummary";
import { contextualBanditSkipReason } from "@/components/ContextualBandit/ContextualBanditRefSummary";

const text = (node: ReactNode) =>
  node === null
    ? null
    : renderToStaticMarkup(<>{node}</>).replace(/<[^>]+>/g, "");

function experiment(
  overrides: Partial<ExperimentInterfaceStringDates>,
): ExperimentInterfaceStringDates {
  return {
    id: "exp_1",
    type: "standard",
    status: "running",
    archived: false,
    phases: [{}],
    linkedFeatures: ["f1"],
    ...overrides,
  } as ExperimentInterfaceStringDates;
}

describe("experimentRefSkipReason", () => {
  it("serves a running experiment", () => {
    expect(experimentRefSkipReason(experiment({}), false)).toBeNull();
    expect(
      experimentRefSkipReason(
        experiment({ status: "stopped", releasedVariationId: "v1" }),
        false,
      ),
    ).toBeNull();
  });

  it.each([
    ["missing", undefined, "could not be found"],
    ["archived", experiment({ archived: true }), "is archived"],
    [
      "no linked changes",
      experiment({ linkedFeatures: [] }),
      "has no linked changes",
    ],
    ["never started", experiment({ phases: [] }), "is not running"],
    [
      "stopped without a rollout",
      experiment({ status: "stopped", releasedVariationId: "" }),
      "stopped without a temporary rollout",
    ],
    [
      "stopped and excluded",
      experiment({
        status: "stopped",
        releasedVariationId: "v1",
        excludeFromPayload: true,
      }),
      "stopped without a temporary rollout",
    ],
    [
      "a draft",
      experiment({ status: "draft" }),
      "SDK connections that include draft experiments",
    ],
  ])("explains %s", (_, exp, reason) => {
    expect(text(experimentRefSkipReason(exp, false))).toContain(reason);
  });

  it("offers a draft's start on publish only while viewing a draft", () => {
    const draft = experiment({ status: "draft" });
    expect(text(experimentRefSkipReason(draft, true))).toContain(
      "You can start the experiment when you publish this feature draft.",
    );
    expect(text(experimentRefSkipReason(draft, false))).not.toContain(
      "publish",
    );
  });

  it("names a Bandit as one", () => {
    expect(
      text(
        experimentRefSkipReason(
          experiment({ type: "multi-armed-bandit", archived: true }),
          false,
        ),
      ),
    ).toContain("This Bandit is archived");
  });
});

describe("contextualBanditSkipReason", () => {
  const cb = (overrides: Partial<ApiContextualBanditInterface>) =>
    ({
      id: "cb_1",
      archived: false,
      status: "running",
      ...overrides,
    }) as ApiContextualBanditInterface;

  it("serves a running one", () => {
    expect(contextualBanditSkipReason(cb({}))).toBeNull();
  });

  it.each([
    ["archived", cb({ archived: true }), "is archived"],
    ["stopped", cb({ status: "stopped" }), "is stopped"],
    ["a draft", cb({ status: "draft" }), "is a draft"],
  ])("explains %s", (_, bandit, reason) => {
    expect(text(contextualBanditSkipReason(bandit))).toContain(reason);
  });
});
