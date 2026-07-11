import {
  nodeStatusToken,
  resolveNodeStatus,
} from "@/components/RampSchedule/rampTimelineStatus";

type StatusInput = Parameters<typeof nodeStatusToken>[1];

const approvalReady: StatusInput = {
  status: "running",
  currentStepIndex: 0,
  steps: [{ interval: null, holdConditions: { requiresApproval: true } }],
  stepApproval: null,
};

const running: StatusInput = {
  status: "running",
  currentStepIndex: 0,
  steps: [{ interval: 3600 }],
};

describe("rampTimelineStatus", () => {
  it("resolves completed/future from node state regardless of schedule status", () => {
    expect(nodeStatusToken("completed", running, false)).toBe("completed");
    expect(nodeStatusToken("completed", approvalReady, true)).toBe("completed");
    expect(nodeStatusToken("future", approvalReady, true)).toBe("future");
  });

  // The regression this whole file exists to prevent: an active step holding
  // for approval must resolve to orange, not the running green.
  it("resolves an awaiting-approval active step to orange with a gray outgoing edge", () => {
    const v = resolveNodeStatus("active", approvalReady, false);
    expect(v.token).toBe("awaiting-approval");
    expect(v.label).toBe("Needs Approval");
    expect(v.dotColor).toBe("var(--orange-9)");
    expect(v.labelColor).toBe("var(--orange-11)");
    expect(v.connectorColor).toBe("var(--ramp-future-connector)");
  });

  it("resolves a monitored active step to blue with a blue outgoing edge", () => {
    const v = resolveNodeStatus("active", running, true);
    expect(v.token).toBe("monitoring");
    expect(v.dotColor).toBe("var(--blue-9)");
    expect(v.connectorColor).toBe("var(--blue-9)");
  });

  it("keeps a rolled-back node's dot and outgoing edge the same gray", () => {
    const v = resolveNodeStatus(
      "active",
      { ...running, status: "rolled-back" },
      false,
    );
    expect(v.dotColor).toBe("var(--gray-8)");
    expect(v.connectorColor).toBe("var(--gray-8)");
  });

  it("resolves a plain running active step to green", () => {
    const v = resolveNodeStatus("active", running, false);
    expect(v.token).toBe("running");
    expect(v.dotColor).toBe("var(--green-9)");
  });

  it("resolves paused / scheduled / rolled-back active steps", () => {
    expect(
      nodeStatusToken("active", { ...running, status: "paused" }, false),
    ).toBe("paused");
    expect(
      nodeStatusToken("active", { ...running, status: "pending" }, false),
    ).toBe("scheduled");
    expect(
      nodeStatusToken("active", { ...running, status: "ready" }, false),
    ).toBe("scheduled");
    expect(
      nodeStatusToken("active", { ...running, status: "rolled-back" }, false),
    ).toBe("rolled-back");
  });

  it("falls back to a neutral, non-live state for an unknown status", () => {
    const v = resolveNodeStatus(
      "active",
      { ...running, status: "some-future-status" },
      false,
    );
    expect(v.token).toBe("scheduled");
    expect(v.pulse).toBe(false);
  });

  it("gives approval priority over monitoring on the same step", () => {
    expect(nodeStatusToken("active", approvalReady, true)).toBe(
      "awaiting-approval",
    );
  });

  it("pulses only for live states, not holds/pauses/stops", () => {
    expect(resolveNodeStatus("active", running, false).pulse).toBe(true);
    expect(resolveNodeStatus("active", running, true).pulse).toBe(true);
    expect(resolveNodeStatus("active", approvalReady, false).pulse).toBe(false);
    expect(
      resolveNodeStatus("active", { ...running, status: "paused" }, false)
        .pulse,
    ).toBe(false);
    expect(
      resolveNodeStatus("active", { ...running, status: "rolled-back" }, false)
        .pulse,
    ).toBe(false);
  });
});
