import type {
  ContextualBanditInterface,
  ExperimentInterface,
  ExperimentPhase,
} from "shared/validators";
import {
  contextualBanditChangeActions,
  experimentChangeActions,
} from "back-end/src/services/confirmations";

const phase = (overrides: Partial<ExperimentPhase> = {}): ExperimentPhase => ({
  dateStarted: new Date("2026-01-01"),
  name: "Main",
  reason: "",
  coverage: 1,
  condition: "",
  variationWeights: [0.5, 0.5],
  variations: [],
  ...overrides,
});
const running = {
  status: "running",
  phases: [phase({ name: "First" }), phase()],
} as unknown as ExperimentInterface;

describe("experimentChangeActions", () => {
  it("names taking a live experiment back to draft, or clearing its schedule", () => {
    expect(experimentChangeActions(running, { status: "draft" })).toEqual([
      "experiment.stop",
    ]);
    expect(
      experimentChangeActions(
        { ...running, status: "draft" } as unknown as ExperimentInterface,
        { status: "stopped" },
      ),
    ).toEqual(["experiment.stop"]);
    expect(
      experimentChangeActions(
        { ...running, statusUpdateSchedule: { stopAt: new Date() } },
        { statusUpdateSchedule: null },
      ),
    ).toEqual(["experiment.other"]);
  });

  it("names a live tracking key change as re-randomizing", () => {
    expect(
      experimentChangeActions(running, { trackingKey: "renamed" }),
    ).toEqual(["experiment.phases"]);
  });

  it("names an edit to a draft armed to start as the start", () => {
    const draft = {
      ...running,
      status: "draft",
    } as unknown as ExperimentInterface;
    expect(experimentChangeActions(draft, { name: "Renamed" })).toEqual([]);
    const armed = { ...draft, statusUpdateSchedule: { startAt: new Date() } };
    // Its edits go live when it starts, so they hold as on a live experiment.
    expect(experimentChangeActions(armed, { name: "Renamed" }).sort()).toEqual([
      "experiment.other",
      "experiment.start",
    ]);
    expect(
      experimentChangeActions(armed, {
        phases: [phase({ name: "First" }), phase({ coverage: 0.5 })],
      }).sort(),
    ).toEqual(["experiment.start", "experiment.traffic"]);
    // Echoing the draft status leaves it armed.
    expect(
      experimentChangeActions(armed, {
        status: "draft",
        phases: [phase({ name: "First" }), phase({ coverage: 0.5 })],
      }).sort(),
    ).toEqual(["experiment.start", "experiment.traffic"]);
  });

  it("names what a new latest phase changes from the old one", () => {
    expect(
      experimentChangeActions(running, {
        phases: [
          phase({ name: "First" }),
          phase(),
          phase({ condition: '{"country":"US"}', coverage: 1 }),
        ],
      }).sort(),
    ).toEqual(["experiment.phases", "experiment.targeting"]);
  });

  it("names Make Changes edits to the live phase", () => {
    expect(
      experimentChangeActions(running, {
        phases: [
          phase({ name: "First" }),
          phase({
            coverage: 0.5,
            variationWeights: [0.3, 0.7],
            condition: '{"country":"US"}',
          }),
        ],
      }).sort(),
    ).toEqual(["experiment.targeting", "experiment.traffic"]);
    // A changed variation set reaches users; the reweight log doesn't.
    expect(
      experimentChangeActions(running, {
        phases: [
          phase({ name: "First" }),
          phase({ variations: [{ id: "v0", status: "active" }] }),
        ],
      }),
    ).toEqual(["experiment.traffic"]);
    expect(
      experimentChangeActions(running, {
        phases: [
          phase({ name: "First" }),
          phase({
            banditEvents: [{}] as unknown as ExperimentPhase["banditEvents"],
          }),
        ],
      }),
    ).toEqual([]);
  });

  it("names a new phase, a re-randomize and edits to past phases or dates", () => {
    const labels = (changes: Partial<ExperimentInterface>) =>
      experimentChangeActions(running, changes);
    expect(labels({ bucketVersion: 2 })).toEqual(["experiment.phases"]);
    expect(
      labels({ phases: [phase({ name: "First" }), phase(), phase()] }),
    ).toEqual(["experiment.phases"]);
    expect(
      labels({
        phases: [
          phase({ name: "First", dateStarted: new Date("2025-12-01") }),
          phase(),
        ],
      }),
    ).toEqual(["experiment.phases"]);
  });

  it("names a field a replacement phase drops", () => {
    expect(
      experimentChangeActions(
        {
          ...running,
          phases: [phase({ name: "First" }), phase({ seed: "s" })],
        },
        { phases: [phase({ name: "First" }), phase()] },
      ),
    ).toEqual(["experiment.phases"]);
  });

  it("names any other change to what a live experiment serves", () => {
    expect(experimentChangeActions(running, { archived: true })).toEqual([
      "experiment.other",
    ]);
    expect(
      experimentChangeActions(
        { ...running, status: "draft" },
        { archived: true },
      ),
    ).toEqual([]);
  });

  it("ignores echoed fields, and counts only status on a draft", () => {
    expect(
      experimentChangeActions(running, {
        phases: [phase({ name: "First", savedGroups: [] }), phase()],
      }),
    ).toEqual([]);
    expect(
      experimentChangeActions(
        { ...running, status: "draft" },
        { status: "running", phases: [phase({ coverage: 0.1 })] },
      ),
    ).toEqual(["experiment.start"]);
    expect(experimentChangeActions(running, { status: "stopped" })).toEqual([
      "experiment.stop",
    ]);
  });
});

describe("contextualBanditChangeActions", () => {
  const bandit = (status: string) =>
    ({
      status,
      condition: "",
      seed: "a",
      maxLeaves: 12,
    }) as ContextualBanditInterface;

  it("names targeting, re-randomizing and anything else a live bandit serves", () => {
    expect(
      contextualBanditChangeActions(bandit("running"), {
        condition: '{"country":"US"}',
        seed: "b",
        maxLeaves: 6,
      }).sort(),
    ).toEqual([
      "experiment.other",
      "experiment.phases",
      "experiment.targeting",
    ]);
    expect(
      contextualBanditChangeActions(bandit("draft"), { status: "running" }),
    ).toEqual(["experiment.start"]);
    expect(
      contextualBanditChangeActions(bandit("draft"), { maxLeaves: 6 }),
    ).toEqual(["experiment.draft"]);
  });

  it("holds archiving a running bandit as a stop and unarchiving it as a start", () => {
    expect(
      contextualBanditChangeActions(bandit("running"), { archived: true }),
    ).toEqual(["experiment.stop"]);
    expect(
      contextualBanditChangeActions(
        { ...bandit("running"), archived: true },
        { archived: false },
      ),
    ).toEqual(["experiment.start"]);
    expect(
      contextualBanditChangeActions(bandit("stopped"), { archived: true }),
    ).toEqual(["experiment.other"]);
    expect(
      contextualBanditChangeActions(bandit("draft"), { archived: true }),
    ).toEqual(["experiment.draft"]);
  });
});
