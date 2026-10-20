import { formatChunkValue } from "@/components/DraftConflicts/conflictValues";

describe("formatChunkValue", () => {
  const envs = ["environments", "allEnvironments"];

  it("renders a flagged pair as the scope in force", () => {
    expect(formatChunkValue({ allEnvironments: true }, envs)).toBe(
      "All Environments",
    );
    expect(
      formatChunkValue(
        { allEnvironments: false, environments: ["production", "test"] },
        envs,
      ),
    ).toBe('["production", "test"]');
  });

  it("lets the flag win when the pair disagrees", () => {
    expect(
      formatChunkValue(
        { allEnvironments: true, environments: ["production"] },
        envs,
      ),
    ).toBe("All Environments");
  });

  it("reads the scope label off any prefixed flag", () => {
    expect(
      formatChunkValue({ targetingAllProjects: true }, [
        "targetingAllProjects",
        "targetingProjects",
      ]),
    ).toBe("All Projects");
  });

  it("renders a lone list without an object wrapper", () => {
    expect(formatChunkValue({ values: ["x", "y"] }, ["values"])).toBe(
      '["x", "y"]',
    );
  });

  it("reports a removed entity", () => {
    expect(formatChunkValue(null, envs)).toBe("(removed)");
  });
});

describe("formatChunkValue with per-field formatters", () => {
  const pct = { coverage: (v: unknown) => `${(v as number) * 100}%` };

  it("uses the formatter for a single field", () => {
    expect(formatChunkValue({ coverage: 0.35 }, ["coverage"], pct)).toBe("35%");
  });

  it("falls back when the field is absent", () => {
    expect(formatChunkValue({}, ["coverage"], pct)).toBe("(removed)");
  });
});
