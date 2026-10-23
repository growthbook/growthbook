import {
  deriveExperimentIdeaStates,
  getExperimentIdeaStages,
  getRemovedStagesInUse,
  sortExperimentIdeas,
  toggleVisibleStage,
  validateExperimentIdeaStages,
} from "shared/experiment-ideas";
import { DEFAULT_EXPERIMENT_IDEA_STAGES } from "shared/constants";

describe("getExperimentIdeaStages", () => {
  it("falls back to the defaults", () => {
    const { stages, defaultStageId } = getExperimentIdeaStages({});
    expect(stages).toEqual(DEFAULT_EXPERIMENT_IDEA_STAGES);
    expect(defaultStageId).toBe("new");
  });

  it("uses the configured default when it exists", () => {
    const { defaultStageId } = getExperimentIdeaStages({
      experimentIdeaStages: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      defaultExperimentIdeaStage: "b",
    });
    expect(defaultStageId).toBe("b");
  });

  it("ignores a default that no longer exists", () => {
    const { defaultStageId } = getExperimentIdeaStages({
      experimentIdeaStages: [{ id: "a", label: "A" }],
      defaultExperimentIdeaStage: "gone",
    });
    expect(defaultStageId).toBe("a");
  });
});

describe("validateExperimentIdeaStages", () => {
  it("accepts the defaults", () => {
    expect(
      validateExperimentIdeaStages(DEFAULT_EXPERIMENT_IDEA_STAGES, "new"),
    ).toBeNull();
  });

  it("rejects an empty list", () => {
    expect(validateExperimentIdeaStages([], undefined)).toMatch(/at least/i);
  });

  it("rejects case-insensitive duplicate labels", () => {
    expect(
      validateExperimentIdeaStages(
        [
          { id: "a", label: "Ready" },
          { id: "b", label: "ready " },
        ],
        "a",
      ),
    ).toMatch(/duplicate stage label/i);
  });

  it("rejects reserved system-derived labels", () => {
    expect(
      validateExperimentIdeaStages([{ id: "x", label: "Archived" }], "x"),
    ).toMatch(/reserved/);
    expect(
      validateExperimentIdeaStages(
        [{ id: "x", label: "Learning available" }],
        "x",
      ),
    ).toMatch(/reserved/);
  });

  it("rejects a default stage that is not configured", () => {
    expect(
      validateExperimentIdeaStages([{ id: "a", label: "A" }], "b"),
    ).toMatch(/default stage/i);
  });
});

describe("getRemovedStagesInUse", () => {
  it("returns only removed stages that ideas still reference", () => {
    const prev = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ];
    const next = [{ id: "a", label: "A" }];
    expect(getRemovedStagesInUse(prev, next, ["a", "c"])).toEqual(["c"]);
  });
});

describe("deriveExperimentIdeaStates", () => {
  it("is empty with no linked experiments", () => {
    expect(
      deriveExperimentIdeaStates({ experiments: [], hasLearning: false }),
    ).toEqual([]);
  });

  it("derives every applicable state", () => {
    expect(
      deriveExperimentIdeaStates({
        experiments: [{ status: "running" }, { status: "stopped" }],
        hasLearning: true,
      }),
    ).toEqual(["converted", "testing", "tested", "learning"]);
  });

  it("marks a draft-only conversion as converted", () => {
    expect(
      deriveExperimentIdeaStates({
        experiments: [{ status: "draft" }],
        hasLearning: false,
      }),
    ).toEqual(["converted"]);
  });
});

describe("sortExperimentIdeas", () => {
  const ideas = [
    {
      id: "1",
      title: "banana",
      dateCreated: "2026-01-01",
      dateUpdated: "2026-03-01",
      upvoteCount: 2,
    },
    {
      id: "2",
      title: "Apple",
      dateCreated: "2026-02-01",
      dateUpdated: "2026-02-01",
      upvoteCount: 5,
    },
    {
      id: "3",
      title: "cherry",
      dateCreated: "2026-03-01",
      dateUpdated: "2026-04-01",
      upvoteCount: 2,
    },
  ];
  const ids = (sort: Parameters<typeof sortExperimentIdeas>[1]) =>
    sortExperimentIdeas(ideas, sort).map((i) => i.id);

  it("sorts by recently updated", () => {
    expect(ids("updated")).toEqual(["3", "1", "2"]);
  });
  it("sorts by upvotes with recency tie-break", () => {
    expect(ids("upvotes")).toEqual(["2", "3", "1"]);
  });
  it("sorts newest and oldest", () => {
    expect(ids("newest")).toEqual(["3", "2", "1"]);
    expect(ids("oldest")).toEqual(["1", "2", "3"]);
  });
  it("sorts by title case-insensitively", () => {
    expect(ids("title")).toEqual(["2", "1", "3"]);
  });
  it("does not mutate the input", () => {
    sortExperimentIdeas(ideas, "title");
    expect(ideas.map((i) => i.id)).toEqual(["1", "2", "3"]);
  });
});

describe("toggleVisibleStage", () => {
  it("adds and removes stages", () => {
    expect(toggleVisibleStage(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleVisibleStage(["a", "b"], "a")).toEqual(["b"]);
  });
  it("never hides the last visible stage", () => {
    expect(toggleVisibleStage(["a"], "a")).toEqual(["a"]);
  });
});
