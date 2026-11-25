import { getAnalysisSettingsDisplay } from "@/components/Experiment/TabbedPage/analysisSettingsDisplay";

type Args = Parameters<typeof getAnalysisSettingsDisplay>[0];

const experiment: Args["experiment"] = { status: "running" };
const results = [
  { name: "", srm: 1, variations: [{ users: 10, metrics: {} }] },
] as NonNullable<Args["analysis"]>["results"];
const analysis = (
  settings: Partial<NonNullable<Args["analysis"]>["settings"]>,
  withData = true,
) =>
  ({
    settings: { dimensions: [], differenceType: "relative", ...settings },
    results: withData ? results : [],
  }) as NonNullable<Args["analysis"]>;
const snapshot = (properPrior: boolean, endDate = new Date("2026-02-01")) =>
  ({
    settings: {
      endDate,
      metricSettings: [{ id: "m", computedSettings: { properPrior } }],
    },
  }) as unknown as NonNullable<Args["snapshot"]>;

describe("getAnalysisSettingsDisplay", () => {
  it("hides sequential testing on a Bayesian analysis", () => {
    const display = getAnalysisSettingsDisplay({
      experiment,
      snapshot: snapshot(true),
      analysis: analysis({ statsEngine: "bayesian", sequentialTesting: true }),
      disablePrecomputedDimensions: false,
    });
    expect(display.engine).toBe("Bayesian");
    expect(display.sequential).toBeNull();
    expect(display.priorUsed).toBe(true);
  });

  it("reports frequentist adjustments and ignores priors", () => {
    const display = getAnalysisSettingsDisplay({
      experiment,
      snapshot: snapshot(true),
      analysis: analysis({
        statsEngine: "frequentist",
        sequentialTesting: true,
        regressionAdjusted: true,
        postStratificationEnabled: true,
      }),
      disablePrecomputedDimensions: false,
    });
    expect(display).toMatchObject({
      engine: "Frequentist",
      sequential: true,
      cuped: true,
      cupedUsed: true,
      postStratification: true,
      postStratificationUsed: true,
      priorUsed: false,
    });
  });

  it("drops post-stratification when the org disables pre-computed dimensions", () => {
    const display = getAnalysisSettingsDisplay({
      experiment,
      snapshot: snapshot(false),
      analysis: analysis({ postStratificationEnabled: true }),
      disablePrecomputedDimensions: true,
    });
    expect(display.postStratification).toBeNull();
    expect(display.postStratificationUsed).toBe(false);
  });

  it("marks nothing as used before there is data", () => {
    const display = getAnalysisSettingsDisplay({
      experiment,
      snapshot: snapshot(true),
      analysis: analysis({ regressionAdjusted: true }, false),
      disablePrecomputedDimensions: false,
    });
    expect(display.hasData).toBe(false);
    expect(display.cuped).toBe(true);
    expect(display.cupedUsed).toBe(false);
    expect(display.priorUsed).toBe(false);
  });

  it("describes an enforced lookback, and only when it is in force", () => {
    const window = { type: "window", value: 14, valueUnit: "days" } as const;
    const args = {
      snapshot: snapshot(false),
      analysis: analysis({}),
      disablePrecomputedDimensions: false,
    };
    expect(
      getAnalysisSettingsDisplay({
        ...args,
        experiment: {
          status: "running",
          attributionModel: "lookbackOverride",
          lookbackOverride: window,
        },
      }).lookbackEnforced,
    ).toBe("14 days");
    expect(
      getAnalysisSettingsDisplay({
        ...args,
        experiment: {
          status: "running",
          attributionModel: "firstExposure",
          lookbackOverride: window,
        },
      }).lookbackEnforced,
    ).toBeNull();
  });

  it("ends a date lookback at the snapshot's end once the experiment stops", () => {
    const lookbackOverride = {
      type: "date",
      value: new Date("2026-01-01T00:00:00Z"),
    } as const;
    const args = {
      snapshot: snapshot(false, new Date("2026-02-01T00:00:00Z")),
      analysis: analysis({}),
      disablePrecomputedDimensions: false,
    };
    const running = getAnalysisSettingsDisplay({
      ...args,
      experiment: {
        status: "running",
        attributionModel: "lookbackOverride",
        lookbackOverride,
      },
    }).lookbackEnforced;
    const stopped = getAnalysisSettingsDisplay({
      ...args,
      experiment: {
        status: "stopped",
        attributionModel: "lookbackOverride",
        lookbackOverride,
      },
    }).lookbackEnforced;
    expect(running).toMatch(/ - now$/);
    expect(stopped).not.toMatch(/now/);
    expect(stopped?.startsWith(running?.replace(/now$/, "") ?? "x")).toBe(true);
  });
});
