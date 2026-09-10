import {
  digestEventMatchesSubscription,
  digestEventPassesFilters,
} from "back-end/src/services/slack/digestFilters";

const event = (
  objectId: string,
  projects: string[] = [],
  tags: string[] = [],
  environment?: string,
) => ({
  objectId,
  data: { projects, tags, ...(environment ? { environment } : {}) },
});

describe("digestEventPassesFilters", () => {
  it("matches project, tag, environment, and object filters", () => {
    const filters = {
      projects: ["proj_a"],
      tags: ["urgent"],
      environments: ["production"],
      ids: ["exp_1"],
    };
    expect(
      digestEventPassesFilters(
        event("exp_1", ["proj_a"], ["urgent"], "production"),
        filters,
      ),
    ).toBe(true);
    expect(
      digestEventPassesFilters(
        event("exp_1", ["proj_b"], ["urgent"], "production"),
        filters,
      ),
    ).toBe(false);
    expect(
      digestEventPassesFilters(
        event("exp_1", ["proj_a"], ["other"], "production"),
        filters,
      ),
    ).toBe(false);
    expect(
      digestEventPassesFilters(
        event("exp_1", ["proj_a"], ["urgent"], "staging"),
        filters,
      ),
    ).toBe(false);
    expect(
      digestEventPassesFilters(
        event("exp_2", ["proj_a"], ["urgent"], "production"),
        filters,
      ),
    ).toBe(false);
  });

  it("treats empty filters as unbounded", () => {
    expect(
      digestEventPassesFilters(event("exp_1"), {
        projects: [],
        tags: [],
        environments: [],
        ids: [],
      }),
    ).toBe(true);
  });

  it("matches exact and wildcard event subscriptions", () => {
    expect(
      digestEventMatchesSubscription({ event: "experiment.started" }, [
        "experiment.*",
      ]),
    ).toBe(true);
    expect(
      digestEventMatchesSubscription({ event: "feature.updated" }, [
        "experiment.started",
      ]),
    ).toBe(false);
  });
});
