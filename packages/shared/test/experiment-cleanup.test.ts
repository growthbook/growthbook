import {
  canMaterializeLinkedChanges,
  getExperimentLinkageBlocker,
} from "../src/util/experiment-cleanup";

const live = [{ state: "live" as const }];
const draft = [{ state: "draft" as const }];

describe("getExperimentLinkageBlocker", () => {
  it("is null when nothing is serving", () => {
    expect(
      getExperimentLinkageBlocker({ status: "running" }, draft),
    ).toBeNull();
    expect(getExperimentLinkageBlocker({ status: "draft" }, live)).toBeNull();
  });

  it("flags a running experiment with live linked changes", () => {
    expect(getExperimentLinkageBlocker({ status: "running" }, live)).toBe(
      "running",
    );
    expect(
      getExperimentLinkageBlocker(
        { status: "running", hasVisualChangesets: true },
        [],
      ),
    ).toBe("running");
  });

  it("flags a stopped experiment whose temporary rollout still serves", () => {
    expect(
      getExperimentLinkageBlocker(
        { status: "stopped", releasedVariationId: "v1" },
        live,
      ),
    ).toBe("temporary-rollout");
    expect(
      getExperimentLinkageBlocker(
        {
          status: "stopped",
          releasedVariationId: "v1",
          excludeFromPayload: true,
        },
        live,
      ),
    ).toBeNull();
    expect(getExperimentLinkageBlocker({ status: "stopped" }, live)).toBeNull();
  });

  it("never blocks an archived experiment", () => {
    expect(
      getExperimentLinkageBlocker({ status: "running", archived: true }, live),
    ).toBeNull();
  });
});

describe("canMaterializeLinkedChanges", () => {
  it("only offers a permanent rule for flag-only temporary rollouts", () => {
    const exp = { status: "stopped", releasedVariationId: "v1" };
    expect(canMaterializeLinkedChanges(exp, "temporary-rollout")).toBe(true);
    expect(canMaterializeLinkedChanges(exp, "running")).toBe(false);
    expect(canMaterializeLinkedChanges(exp, null)).toBe(false);
    expect(
      canMaterializeLinkedChanges(
        { ...exp, hasURLRedirects: true },
        "temporary-rollout",
      ),
    ).toBe(false);
  });

  it("refuses a namespaced rollout, which a force rule cannot reproduce", () => {
    const exp = {
      status: "stopped",
      releasedVariationId: "v1",
      phases: [{ namespace: { enabled: true } }],
    };
    expect(canMaterializeLinkedChanges(exp, "temporary-rollout")).toBe(false);
    expect(
      canMaterializeLinkedChanges(
        { ...exp, phases: [{ namespace: { enabled: false } }] },
        "temporary-rollout",
      ),
    ).toBe(true);
  });
});
