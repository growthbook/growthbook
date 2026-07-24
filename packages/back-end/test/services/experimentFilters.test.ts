import { ExperimentInterface } from "shared/types/experiment";
import {
  parseExperimentSearchString,
  normalizeExperimentFilters,
  filterExperiments,
  ExperimentFilterResolvers,
} from "back-end/src/services/experimentFilters";

describe("parseExperimentSearchString", () => {
  it("returns empty filters for empty input", () => {
    expect(parseExperimentSearchString("")).toEqual({});
    expect(parseExperimentSearchString("   ")).toEqual({});
  });

  it("parses known filter keys", () => {
    expect(
      parseExperimentSearchString("status:running tag:checkout is:won"),
    ).toEqual({
      statuses: ["running"],
      tags: ["checkout"],
      results: ["won"],
    });
  });

  it("parses comma-separated and quoted values", () => {
    expect(
      parseExperimentSearchString(
        'owner:"Jane Doe",john status:running,stopped',
      ),
    ).toEqual({
      owners: ["Jane Doe", "john"],
      statuses: ["running", "stopped"],
    });
  });

  it("normalizes has tokens to experiment types", () => {
    expect(
      parseExperimentSearchString("has:feature,redirects,visualChange"),
    ).toEqual({
      types: ["feature", "redirect", "visualChange"],
    });
  });

  it("captures free text as search", () => {
    expect(parseExperimentSearchString("homepage status:running")).toEqual({
      statuses: ["running"],
      search: "homepage",
    });
  });

  it("ignores negated filters", () => {
    expect(parseExperimentSearchString("status:!running")).toEqual({});
  });

  it("throws on negated filters in strict mode", () => {
    expect(() =>
      parseExperimentSearchString("status:!stopped", { strict: true }),
    ).toThrow(/Unsupported search syntax: status:!stopped/);
  });

  it("throws on operator tokens in strict mode", () => {
    expect(() =>
      parseExperimentSearchString("owner:~smith", { strict: true }),
    ).toThrow(/Unsupported search syntax: owner:~smith/);
  });

  it("lists all unsupported tokens in strict mode", () => {
    expect(() =>
      parseExperimentSearchString("status:!stopped owner:~smith tag:checkout", {
        strict: true,
      }),
    ).toThrow(/status:!stopped, owner:~smith/);
  });

  it("leaves plain filters unaffected in strict mode", () => {
    expect(
      parseExperimentSearchString("status:running tag:checkout homepage", {
        strict: true,
      }),
    ).toEqual({
      statuses: ["running"],
      tags: ["checkout"],
      search: "homepage",
    });
  });
});

describe("normalizeExperimentFilters", () => {
  it("merges parsed string with structured filters and dedupes", () => {
    expect(
      normalizeExperimentFilters({
        searchString: "tag:a status:running",
        filters: { tags: ["b"], owners: ["jane"] },
      }),
    ).toEqual({
      projects: undefined,
      metrics: undefined,
      owners: ["jane"],
      results: undefined,
      statuses: ["running"],
      tags: ["a", "b"],
      types: undefined,
      search: undefined,
    });
  });

  it("normalizes structured type tokens", () => {
    const result = normalizeExperimentFilters({
      filters: { types: ["features", "redirects"] },
    });
    expect(result.types).toEqual(["feature", "redirect"]);
  });
});

function makeExperiment(
  overrides: Partial<ExperimentInterface>,
): ExperimentInterface {
  return {
    id: "exp_1",
    organization: "org",
    name: "My Experiment",
    owner: "u_1",
    project: "prj_1",
    tags: [],
    status: "running",
    type: "standard",
    phases: [],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    ...overrides,
  } as ExperimentInterface;
}

const resolvers: ExperimentFilterResolvers = {
  ownerCandidates: new Map([["u_1", ["Jane Doe", "jane@example.com"]]]),
  projectNameById: new Map([["prj_1", "Checkout"]]),
};

describe("filterExperiments", () => {
  it("returns all experiments when no filters are provided", () => {
    const experiments = [
      makeExperiment({ id: "a" }),
      makeExperiment({ id: "b", status: "stopped" }),
    ];
    expect(
      filterExperiments({ experiments, filters: {}, resolvers }),
    ).toHaveLength(2);
  });

  it("filters by status", () => {
    const experiments = [
      makeExperiment({ id: "a", status: "running" }),
      makeExperiment({ id: "b", status: "stopped" }),
    ];
    const result = filterExperiments({
      experiments,
      filters: { statuses: ["stopped"] },
      resolvers,
    });
    expect(result.map((e) => e.id)).toEqual(["b"]);
  });

  it("matches owner by resolved display name or email", () => {
    const experiments = [makeExperiment({ id: "a", owner: "u_1" })];
    expect(
      filterExperiments({
        experiments,
        filters: { owners: ["jane@example.com"] },
        resolvers,
      }),
    ).toHaveLength(1);
    expect(
      filterExperiments({
        experiments,
        filters: { owners: ["Jane Doe"] },
        resolvers,
      }),
    ).toHaveLength(1);
    expect(
      filterExperiments({
        experiments,
        filters: { owners: ["someone else"] },
        resolvers,
      }),
    ).toHaveLength(0);
  });

  it("matches project by id or resolved name", () => {
    const experiments = [makeExperiment({ id: "a", project: "prj_1" })];
    expect(
      filterExperiments({
        experiments,
        filters: { projects: ["Checkout"] },
        resolvers,
      }),
    ).toHaveLength(1);
    expect(
      filterExperiments({
        experiments,
        filters: { projects: ["prj_1"] },
        resolvers,
      }),
    ).toHaveLength(1);
  });

  it("filters by experiment type via has/types", () => {
    const experiments = [
      makeExperiment({ id: "feat", linkedFeatures: ["feat_1"] }),
      makeExperiment({ id: "redir", hasURLRedirects: true }),
      makeExperiment({ id: "plain" }),
    ];
    const result = filterExperiments({
      experiments,
      filters: { types: ["feature"] },
      resolvers,
    });
    expect(result.map((e) => e.id)).toEqual(["feat"]);
  });

  it("scopes bandits when requested", () => {
    const experiments = [
      makeExperiment({ id: "std", type: "standard" }),
      makeExperiment({ id: "bandit", type: "multi-armed-bandit" }),
    ];
    expect(
      filterExperiments({
        experiments,
        filters: {},
        resolvers,
        bandits: true,
      }).map((e) => e.id),
    ).toEqual(["bandit"]);
    expect(
      filterExperiments({
        experiments,
        filters: {},
        resolvers,
        bandits: false,
      }).map((e) => e.id),
    ).toEqual(["std"]);
  });

  it("filters by free-text search across name", () => {
    const experiments = [
      makeExperiment({ id: "a", name: "Homepage redesign" }),
      makeExperiment({ id: "b", name: "Checkout flow" }),
    ];
    const result = filterExperiments({
      experiments,
      filters: { search: "homepage" },
      resolvers,
    });
    expect(result.map((e) => e.id)).toEqual(["a"]);
  });

  it("filters by phase end date range", () => {
    const experiments = [
      makeExperiment({
        id: "old",
        phases: [
          {
            dateStarted: new Date("2023-01-01"),
            dateEnded: new Date("2023-02-01"),
            name: "Main",
          },
        ] as ExperimentInterface["phases"],
      }),
      makeExperiment({
        id: "recent",
        phases: [
          {
            dateStarted: new Date("2024-01-01"),
            dateEnded: new Date("2024-02-01"),
            name: "Main",
          },
        ] as ExperimentInterface["phases"],
      }),
    ];
    const result = filterExperiments({
      experiments,
      filters: {},
      resolvers,
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-03-01"),
    });
    expect(result.map((e) => e.id)).toEqual(["recent"]);
  });

  it("ignores an invalid date instead of filtering everything out", () => {
    const experiments = [
      makeExperiment({
        id: "recent",
        phases: [
          {
            dateStarted: new Date("2024-01-01"),
            dateEnded: new Date("2024-02-01"),
            name: "Main",
          },
        ] as ExperimentInterface["phases"],
      }),
    ];
    const result = filterExperiments({
      experiments,
      filters: {},
      resolvers,
      // e.g. from a bad `?startDate=garbage` query param
      startDate: new Date("not a date"),
    });
    expect(result.map((e) => e.id)).toEqual(["recent"]);
  });
});
