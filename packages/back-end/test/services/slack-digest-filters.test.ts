import { digestEventPassesFilters } from "back-end/src/services/slack/scorecardData";

// The scope filters applied to a digest's source events. Event envelope
// tags/projects live on `data`; objectId is the experiment/feature id.
const ev = (
  objectId: string,
  projects: string[] = [],
  tags: string[] = [],
) => ({
  objectId,
  data: { projects, tags },
});

const NO_FILTERS = { projects: [], tags: [], ids: [] };

describe("digestEventPassesFilters", () => {
  it("passes everything when no filters are set", () => {
    expect(digestEventPassesFilters(ev("exp_1"), NO_FILTERS)).toBe(true);
  });

  it("applies the id filter (experiment/feature id)", () => {
    const filters = { ...NO_FILTERS, ids: ["exp_1"] };
    expect(digestEventPassesFilters(ev("exp_1"), filters)).toBe(true);
    expect(digestEventPassesFilters(ev("exp_2"), filters)).toBe(false);
    // An event with no objectId can't match a non-empty id filter.
    expect(digestEventPassesFilters({ data: {} }, filters)).toBe(false);
  });

  it("applies project and tag filters from the event envelope", () => {
    expect(
      digestEventPassesFilters(ev("exp_1", ["proj_a"]), {
        ...NO_FILTERS,
        projects: ["proj_a"],
      }),
    ).toBe(true);
    expect(
      digestEventPassesFilters(ev("exp_1", ["proj_b"]), {
        ...NO_FILTERS,
        projects: ["proj_a"],
      }),
    ).toBe(false);
    expect(
      digestEventPassesFilters(ev("exp_1", [], ["urgent"]), {
        ...NO_FILTERS,
        tags: ["urgent"],
      }),
    ).toBe(true);
  });

  it("combines filters with AND", () => {
    const filters = { projects: ["proj_a"], tags: ["urgent"], ids: ["exp_1"] };
    expect(
      digestEventPassesFilters(ev("exp_1", ["proj_a"], ["urgent"]), filters),
    ).toBe(true);
    // Right id + project but missing the tag → excluded.
    expect(
      digestEventPassesFilters(ev("exp_1", ["proj_a"], ["other"]), filters),
    ).toBe(false);
  });
});
