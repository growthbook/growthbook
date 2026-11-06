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
    ...overrides,
  } as ExperimentInterfaceStringDates;
}

describe("experimentRefSkipReason", () => {
  it("serves a running experiment, and a draft while viewing a draft", () => {
    expect(experimentRefSkipReason(experiment({}), false)).toBeNull();
    expect(
      experimentRefSkipReason(experiment({ status: "draft" }), true),
    ).toBeNull();
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
    ["a draft", experiment({ status: "draft" }), "draft state"],
  ])("explains %s", (_, exp, reason) => {
    expect(text(experimentRefSkipReason(exp, false))).toContain(reason);
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

  it("serves a running one, and a draft while viewing a draft", () => {
    expect(contextualBanditSkipReason(cb({}), false)).toBeNull();
    expect(
      contextualBanditSkipReason(cb({ status: "draft" }), true),
    ).toBeNull();
  });

  it.each([
    ["archived", cb({ archived: true }), "is archived"],
    ["stopped", cb({ status: "stopped" }), "is stopped"],
    ["a draft", cb({ status: "draft" }), "draft state"],
  ])("explains %s", (_, bandit, reason) => {
    expect(text(contextualBanditSkipReason(bandit, false))).toContain(reason);
  });
});
