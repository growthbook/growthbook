import {
  isAvailableInProject,
  coversAllRequiredProjects,
  isProjectScopeUnchangedOrExpanded,
  getInvalidMetricGroupMetrics,
  getMetricGroupMetricsToValidate,
  doesMetricProjectChangeReduceGroupAvailability,
} from "../../src/util";

describe("isAvailableInProject", () => {
  it("should return true when item has no project restrictions", () => {
    expect(isAvailableInProject([], "project-a")).toBe(true);
    expect(isAvailableInProject(undefined, "project-a")).toBe(true);
  });

  it("should return true when no project is selected", () => {
    expect(isAvailableInProject(["project-a"], undefined)).toBe(true);
    expect(isAvailableInProject(["project-a"], "")).toBe(true);
  });

  it("should return true when item includes the selected project", () => {
    expect(isAvailableInProject(["project-a"], "project-a")).toBe(true);
    expect(isAvailableInProject(["project-a", "project-b"], "project-a")).toBe(
      true,
    );
  });

  it("should return false when item does not include the selected project", () => {
    expect(isAvailableInProject(["project-a"], "project-b")).toBe(false);
    expect(isAvailableInProject(["project-a", "project-c"], "project-b")).toBe(
      false,
    );
  });
});

describe("coversAllRequiredProjects", () => {
  it("requires unrestricted metrics for All Projects", () => {
    expect(coversAllRequiredProjects(["project-a"], [])).toBe(false);
    expect(coversAllRequiredProjects(["project-a"], undefined)).toBe(false);
    expect(coversAllRequiredProjects([], [])).toBe(true);
    expect(coversAllRequiredProjects(undefined, [])).toBe(true);
    expect(coversAllRequiredProjects([], undefined)).toBe(true);
  });

  it("should return true when item has no project restrictions", () => {
    expect(coversAllRequiredProjects([], ["project-a"])).toBe(true);
    expect(coversAllRequiredProjects(undefined, ["project-a"])).toBe(true);
    expect(coversAllRequiredProjects([], ["project-a", "project-b"])).toBe(
      true,
    );
  });

  it("should return true when item is available in all required projects", () => {
    expect(coversAllRequiredProjects(["project-a"], ["project-a"])).toBe(true);
    expect(
      coversAllRequiredProjects(
        ["project-a", "project-b"],
        ["project-a", "project-b"],
      ),
    ).toBe(true);
    expect(
      coversAllRequiredProjects(
        ["project-a", "project-b", "project-c"],
        ["project-a", "project-b"],
      ),
    ).toBe(true);
  });

  it("should return false when item is missing any required project", () => {
    expect(coversAllRequiredProjects(["project-a"], ["project-b"])).toBe(false);
    expect(
      coversAllRequiredProjects(["project-a"], ["project-a", "project-b"]),
    ).toBe(false);
    expect(
      coversAllRequiredProjects(
        ["project-a", "project-c"],
        ["project-a", "project-b"],
      ),
    ).toBe(false);
  });
});

describe("isProjectScopeUnchangedOrExpanded", () => {
  it.each([
    { before: ["a", "b"], after: ["b", "a"], expected: true },
    { before: ["a"], after: ["a", "b"], expected: true },
    { before: ["a", "b"], after: ["a"], expected: false },
    { before: ["a"], after: ["b"], expected: false },
    { before: ["a"], after: [], expected: true },
    { before: [], after: ["a"], expected: false },
    { before: undefined, after: [], expected: true },
  ])("$before -> $after: $expected", ({ before, after, expected }) => {
    expect(isProjectScopeUnchangedOrExpanded(before, after)).toBe(expected);
  });
});

describe("getInvalidMetricGroupMetrics", () => {
  const metrics = [
    { id: "global", projects: [] },
    { id: "a", projects: ["a"] },
    { id: "ab", projects: ["a", "b"] },
    { id: "archived", projects: ["a", "b"], status: "archived" },
    { id: "fact__archived", projects: ["a", "b"], archived: true },
  ];

  it("validates every member, retaining compatible archived members", () => {
    expect(
      getInvalidMetricGroupMetrics(
        {
          projects: ["a", "b"],
          metrics: [
            "global",
            "a",
            "ab",
            "archived",
            "fact__archived",
            "missing",
          ],
        },
        metrics,
      ),
    ).toEqual(["a", "missing"]);
  });

  it("requires global members when Projects are cleared", () => {
    expect(
      getInvalidMetricGroupMetrics(
        { projects: [], metrics: ["global", "a", "ab"] },
        metrics,
      ),
    ).toEqual(["a", "ab"]);
  });

  it("detects a member whose Projects were narrowed after being added", () => {
    expect(
      getInvalidMetricGroupMetrics({ projects: ["a", "b"], metrics: ["ab"] }, [
        { id: "ab", projects: ["a"] },
      ]),
    ).toEqual(["ab"]);
  });

  it("allows empty groups and does not mutate membership", () => {
    const group = { projects: ["b"], metrics: ["a", "global"] };
    expect(getInvalidMetricGroupMetrics(group, metrics)).toEqual(["a"]);
    expect(group.metrics).toEqual(["a", "global"]);
    expect(
      getInvalidMetricGroupMetrics({ projects: [], metrics: [] }, []),
    ).toEqual([]);
  });
});

describe("getMetricGroupMetricsToValidate", () => {
  const existing = {
    projects: ["a", "b"],
    metrics: ["global", "a-only", "missing", "archived"],
  };

  it("validates every member when creating a group", () => {
    expect(getMetricGroupMetricsToValidate(existing, null)).toEqual([
      "global",
      "a-only",
      "missing",
      "archived",
    ]);
  });

  it("allows metadata-only edits of an incompatible group", () => {
    expect(getMetricGroupMetricsToValidate({ ...existing }, existing)).toEqual(
      [],
    );
  });

  it("allows reordering incompatible and missing members", () => {
    expect(
      getMetricGroupMetricsToValidate(
        {
          ...existing,
          metrics: ["missing", "archived", "a-only", "global"],
        },
        existing,
      ),
    ).toEqual([]);
  });

  it("allows partial cleanup without forcing all incompatible members out", () => {
    expect(
      getMetricGroupMetricsToValidate(
        {
          ...existing,
          metrics: ["global", "a-only"],
        },
        existing,
      ),
    ).toEqual([]);
  });

  it("checks only newly added members while Projects are unchanged", () => {
    expect(
      getMetricGroupMetricsToValidate(
        {
          ...existing,
          metrics: [
            ...existing.metrics,
            "new-compatible",
            "new-incompatible",
            "new-missing",
          ],
        },
        existing,
      ),
    ).toEqual(["new-compatible", "new-incompatible", "new-missing"]);
  });

  it("validates a previously removed member when it is added again", () => {
    expect(
      getMetricGroupMetricsToValidate(existing, {
        ...existing,
        metrics: ["global", "archived"],
      }),
    ).toEqual(["a-only", "missing"]);
  });

  it("ignores Project order and duplicate Project IDs", () => {
    expect(
      getMetricGroupMetricsToValidate(
        {
          ...existing,
          projects: ["b", "a", "a"],
          metrics: [...existing.metrics, "new"],
        },
        existing,
      ),
    ).toEqual(["new"]);
  });

  it.each(
    [["a"], ["b", "c"], ["a", "b", "c"], []].map((projects) => ({ projects })),
  )(
    "validates all remaining members after changing Projects to $projects",
    ({ projects }) => {
      expect(
        getMetricGroupMetricsToValidate(
          {
            projects,
            metrics: ["global", "a-only", "missing"],
          },
          existing,
        ),
      ).toEqual(["global", "a-only", "missing"]);
    },
  );

  it("permits removing all members while changing Projects", () => {
    expect(
      getMetricGroupMetricsToValidate({ projects: [], metrics: [] }, existing),
    ).toEqual([]);
  });

  it("preserves incompatible members in All Projects while checking additions", () => {
    const previousGroup = { projects: [], metrics: ["a-only", "missing"] };
    const group = {
      projects: [],
      metrics: ["a-only", "missing", "new-a-only", "global"],
    };
    const toValidate = getMetricGroupMetricsToValidate(group, previousGroup);
    expect(toValidate).toEqual(["new-a-only", "global"]);
    expect(
      getInvalidMetricGroupMetrics({ ...group, metrics: toValidate }, [
        { id: "new-a-only", projects: ["a"] },
        { id: "global", projects: [] },
      ]),
    ).toEqual(["new-a-only"]);
  });

  it("validates inherited incompatibilities when leaving All Projects", () => {
    expect(
      getMetricGroupMetricsToValidate(existing, { ...existing, projects: [] }),
    ).toEqual(existing.metrics);
  });
});

describe("doesMetricProjectChangeReduceGroupAvailability", () => {
  it.each([
    {
      before: ["a", "b"],
      after: ["b", "a"],
      group: ["a", "b"],
      reduced: false,
    },
    { before: ["a"], after: ["a", "b"], group: ["a", "b"], reduced: false },
    { before: ["a"], after: [], group: ["a", "b"], reduced: false },
    { before: [], after: ["a"], group: ["a", "b"], reduced: true },
    { before: undefined, after: ["a"], group: ["a", "b"], reduced: true },
    { before: [], after: ["a", "b"], group: ["a", "b"], reduced: false },
    { before: ["a", "b"], after: ["a"], group: ["a", "b"], reduced: true },
    { before: ["a", "c"], after: ["a"], group: ["a", "b"], reduced: false },
    { before: ["a", "c"], after: ["c"], group: ["a", "b"], reduced: true },
    { before: ["a", "c"], after: ["b", "c"], group: ["a", "b"], reduced: true },
    { before: ["c", "d"], after: ["c"], group: ["a", "b"], reduced: false },
    { before: ["c"], after: ["a"], group: ["a", "b"], reduced: false },
    { before: [], after: [], group: [], reduced: false },
    { before: [], after: undefined, group: [], reduced: false },
    { before: [], after: ["a"], group: [], reduced: true },
    { before: ["a", "b"], after: ["a"], group: [], reduced: true },
    { before: ["a"], after: ["a", "b"], group: [], reduced: false },
    { before: ["a"], after: [], group: [], reduced: false },
  ])(
    "$before -> $after in group $group: reduced=$reduced",
    ({ before, after, group, reduced }) => {
      expect(
        doesMetricProjectChangeReduceGroupAvailability(before, after, group),
      ).toBe(reduced);
    },
  );
});
