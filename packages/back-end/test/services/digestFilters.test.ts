import {
  digestEventMatchesSubscription,
  digestEventLine,
  summarizeDigestEvents,
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

const filters = { projects: ["allowed"], tags: [], environments: [], ids: [] };
it("uses immutable richer event names and limits every line", () => {
  expect(
    digestEventLine({
      event: "experiment.started",
      data: { data: { object: { experimentName: "Checkout" } } },
    }),
  ).toBe("• experiment.started — Checkout");
  expect(
    digestEventLine({
      event: "feature.revision.published",
      objectId: "feature-key",
    }),
  ).toContain("feature-key");
  expect(
    digestEventLine({ data: { object: { name: "a".repeat(5000) } } }).length,
  ).toBe(130);
});
it("filters before limiting displayed updates while counting all matches", async () => {
  async function* events() {
    for (let i = 0; i < 100; i++)
      yield {
        event: "experiment.started",
        ...event(`excluded${i}`, ["other"]),
      };
    for (let i = 0; i < 40; i++)
      yield {
        event: "experiment.started",
        ...event(`included${i}`, ["allowed"]),
      };
    yield {
      event: "feature.updated",
      ...event("excluded-feature", ["allowed"]),
    };
  }
  const result = await summarizeDigestEvents(
    events(),
    ["experiment.*"],
    filters,
    new Date(Date.now() + 10000),
  );
  expect(result.count).toBe(40);
  expect(result.lines).toHaveLength(20);
  expect(result.lines[0]).toContain("included0");
  expect(result.lines.join("\n").length).toBeLessThan(3000);
});
it("aborts rather than posting after the delivery lease expires", async () => {
  async function* events() {
    yield { event: "experiment.started" };
  }
  await expect(
    summarizeDigestEvents(events(), ["experiment.*"], filters, new Date(0)),
  ).rejects.toThrow("delivery lease");
});
