import { describe, expect, it } from "vitest";
import {
  PlanDiagnostics,
  planFromFixture,
  planFromModel,
} from "@/components/Experiment/TabbedPage/SetupPage/aiSetupPlan";
import { AI_SETUP_FIXTURE } from "@/components/Experiment/TabbedPage/SetupPage/aiSetupFixture";

const now = new Date("2026-06-01T12:00:00Z");
const ctx = {
  attributes: ["country", "deviceType"],
  metricIds: ["met_1", "met_2", "met_3"],
  now,
};

// Everything null but the hypothesis: what a minimal answer looks like.
const minimal = {
  hypothesis: "A bigger button increases signups.",
  description: null,
  variations: null,
  experimentType: null,
  targeting: null,
  trafficSplit: null,
  goalMetricId: null,
  secondaryMetricIds: null,
  guardrailMetricIds: null,
  duration: null,
  scheduledStart: null,
};

const full = {
  ...minimal,
  hypothesis: "  A bigger button increases signups. ",
  description: "Makes the signup button bigger.",
  variations: [
    { name: "Control", description: "Today's button", value: "false" },
    { name: "Big", description: null, value: "TRUE" },
    { name: null, description: null, value: "true" },
  ],
  experimentType: "values",
  targeting: [{ attribute: "country", operator: "is", values: ["US"] }],
  trafficSplit: { coveragePercent: 50, variationPercents: [50, 25, 25] },
  goalMetricId: "met_1",
  secondaryMetricIds: ["met_2"],
  guardrailMetricIds: ["met_3"],
  duration: { amount: 2, unit: "weeks" },
  scheduledStart: "2026-06-15",
};

const diagnose = (): PlanDiagnostics => ({
  malformed: false,
  missingCore: false,
  issues: [],
});

describe("planFromModel", () => {
  it("applies every stated field", () => {
    expect(planFromModel(full, ctx)).toEqual({
      deliveryType: "values",
      hypothesis: "A bigger button increases signups.",
      description: "Makes the signup button bigger.",
      variations: [
        { name: "Control", description: "Today's button" },
        { name: "Big", description: "" },
        { name: null, description: "" },
      ],
      values: { dataType: "boolean", byIndex: ["false", "true", "true"] },
      scheduledStart: new Date(2026, 5, 15).toISOString(),
      condition: JSON.stringify({ country: "US" }),
      coverage: 0.5,
      variationWeights: [0.5, 0.25, 0.25],
      goalMetricId: "met_1",
      secondaryMetrics: ["met_2"],
      guardrailMetrics: ["met_3"],
      duration: { endAfter: 2, endUnit: "weeks" },
    });
  });

  it("keeps known secondary and guardrail metrics only, each once", () => {
    const d = diagnose();
    const plan = planFromModel(
      {
        ...full,
        secondaryMetricIds: ["met_2", "met_x", "met_2", "met_1"],
        guardrailMetricIds: ["met_2", "met_3"],
      },
      ctx,
      d,
    );
    // The goal metric isn't repeated as secondary, nor a secondary as a
    // guardrail.
    expect(plan?.secondaryMetrics).toEqual(["met_2"]);
    expect(plan?.guardrailMetrics).toEqual(["met_3"]);
    expect(d.issues).toContain('secondaryMetricIds: unknown metric "met_x"');
  });

  it("fills only what's stated: a hypothesis and variation names", () => {
    const plan = planFromModel(
      {
        ...minimal,
        variations: [
          { name: "Y", description: null, value: null },
          { name: "Z", description: null, value: null },
        ],
      },
      ctx,
    );
    expect(plan).toMatchObject({
      hypothesis: "A bigger button increases signups.",
      variations: [
        { name: "Y", description: "" },
        { name: "Z", description: "" },
      ],
      // Everything else stays at the form's defaults, not the fixture's.
      deliveryType: "values",
      condition: "",
      coverage: 1,
      variationWeights: [0.5, 0.5],
      goalMetricId: null,
      secondaryMetrics: [],
      guardrailMetrics: [],
      duration: null,
      values: null,
      scheduledStart: null,
    });
    expect(plan?.condition).not.toBe(AI_SETUP_FIXTURE.targeting.condition);
  });

  it("fails without a hypothesis, the one required field", () => {
    const d = diagnose();
    expect(planFromModel({ ...full, hypothesis: "  " }, ctx, d)).toBeNull();
    expect(d.missingCore).toBe(true);
  });

  it("fails on a malformed answer", () => {
    const d = diagnose();
    expect(planFromModel({ hypothesis: 3 }, ctx, d)).toBeNull();
    expect(d.malformed).toBe(true);
    expect(planFromModel(null, ctx)).toBeNull();
  });

  it("drops unusable optional fields without failing", () => {
    const d = diagnose();
    const plan = planFromModel(
      {
        ...full,
        targeting: [{ attribute: "plan", operator: "is", values: ["pro"] }],
        goalMetricId: "met_unknown",
        scheduledStart: "2026-05-01",
      },
      ctx,
      d,
    );
    expect(plan).not.toBeNull();
    expect(plan?.condition).toBe("");
    expect(plan?.goalMetricId).toBeNull();
    expect(plan?.scheduledStart).toBeNull();
    expect(d.issues).toEqual([
      'targeting: unknown attribute "plan"',
      'goalMetricId: unknown metric "met_unknown"',
      "scheduledStart: date in the past",
    ]);
  });

  it("leaves values blank unless stated, and types only what's stated", () => {
    const plan = planFromModel(
      {
        ...full,
        variations: [
          { name: "A", description: null, value: null },
          { name: "B", description: null, value: "42" },
        ],
        trafficSplit: null,
      },
      ctx,
    );
    expect(plan?.values).toEqual({ dataType: "number", byIndex: [null, "42"] });
  });

  it("drops values when the type isn't Values", () => {
    const plan = planFromModel(
      { ...full, experimentType: "feature-flag" },
      ctx,
    );
    expect(plan?.values).toBeNull();
  });

  it("drops a split that doesn't match the listed variations", () => {
    const d = diagnose();
    const plan = planFromModel(
      {
        ...full,
        trafficSplit: { coveragePercent: 100, variationPercents: [50, 50] },
      },
      ctx,
      d,
    );
    expect(plan?.variations).toHaveLength(3);
    expect(plan?.variationWeights).toEqual([0.3333, 0.3333, 0.3334]);
    expect(d.issues).toContain("trafficSplit: 2 shares for 3 variations");
  });

  it("takes the variation count from the split when none are listed", () => {
    const plan = planFromModel(
      {
        ...minimal,
        trafficSplit: { coveragePercent: 80, variationPercents: [34, 33, 33] },
      },
      ctx,
    );
    expect(plan?.variations).toHaveLength(3);
    expect(plan?.coverage).toBe(0.8);
  });

  it("builds conditions for each operator", () => {
    const plan = planFromModel(
      {
        ...full,
        targeting: [
          {
            attribute: "country",
            operator: "is none of",
            values: ["CA", "MX"],
          },
          { attribute: "deviceType", operator: "is not", values: ["tablet"] },
        ],
      },
      ctx,
    );
    expect(plan?.condition).toBe(
      JSON.stringify({
        country: { $nin: ["CA", "MX"] },
        deviceType: { $ne: "tablet" },
      }),
    );
  });
});

describe("planFromFixture", () => {
  const orgMetrics = [
    { id: "fm_any", name: "Any Purchases" },
    { id: "fm_aov", name: "Average Order Value" },
    { id: "fm_rpu", name: "Revenue per User" },
    { id: "fm_d7", name: "D7 Purchase Retention" },
  ];

  it("is the spec, with its metrics found by name", () => {
    expect(
      planFromFixture({
        attributes: ["deviceType", "country"],
        metrics: orgMetrics,
      }),
    ).toEqual({
      deliveryType: "values",
      hypothesis: AI_SETUP_FIXTURE.hypothesis,
      description: AI_SETUP_FIXTURE.description,
      variations: [
        {
          name: "Banner above fold",
          description:
            "Current behaviour. The promo banner renders above the primary CTA.",
        },
        {
          name: "Banner below fold",
          description:
            "The promo banner renders beneath the primary CTA, inside the order summary block.",
        },
      ],
      values: { dataType: "string", byIndex: ["above", "below"] },
      scheduledStart: null,
      condition: JSON.stringify({ deviceType: "mobile", country: "US" }),
      coverage: 1,
      variationWeights: [0.65, 0.35],
      goalMetricId: "fm_any",
      secondaryMetrics: ["fm_aov"],
      guardrailMetrics: ["fm_rpu"],
      duration: { endAfter: 12, endUnit: "days" },
    });
  });

  it("leaves targeting at the default when an attribute is missing", () => {
    // This instance has deviceType but no country attribute.
    const plan = planFromFixture({
      attributes: ["id", "deviceType", "browser"],
      metrics: orgMetrics,
    });
    expect(plan.condition).toBe("");
  });

  it("leaves metrics it can't find empty", () => {
    const plan = planFromFixture({
      attributes: [],
      metrics: [{ id: "m1", name: "Page Views" }],
    });
    expect(plan.goalMetricId).toBeNull();
    expect(plan.secondaryMetrics).toEqual([]);
    expect(plan.guardrailMetrics).toEqual([]);
  });
});
