import type { DeliveryMethod } from "@/components/Experiment/TabbedPage/ManagedValuesContext";
import type { EndUnit } from "./setupDraft";

// PROTOTYPE ONLY: the "Set up with AI" path in Create Experiment, when the
// model can't be used (see aiSetupPlan.ts), in dev builds only; production
// builds show the failure instead. Nothing is generated: the new draft gets
// this same fixture every time, so a demo can't misbehave. It is
// packages/front-end/prototype-fixtures/promo-banner-spec.md, exactly (set
// in review): the spec a demo attaches, so the fallback lands on what the
// spec says.
//
// Two parts depend on the org, and are resolved when the experiment is
// created (planFromFixture): the metrics are named here and matched to the
// org's metrics by name (any not found are left empty), and the targeting
// is applied only if the org has every attribute it uses (otherwise it
// stays at the default, everyone, rather than naming attributes that don't
// exist). Data source and assignment query are left unset.

export const AI_SETUP_FIXTURE: {
  deliveryType: DeliveryMethod;
  hypothesis: string;
  description: string;
  // The phase's targeting condition, as the experiment stores it, and the
  // attributes it needs.
  targeting: { condition: string; attributes: string[] };
  // Share of matching users in the experiment, 0 to 1.
  coverage: number;
  // One per variation, summing to 1.
  variationWeights: number[];
  // One per variation, control first, aligned with variationWeights. The
  // values are the Values type's, as strings.
  variations: { name: string; description: string; value: string }[];
  // By metric name.
  metrics: { goal: string; secondary: string[]; guardrail: string[] };
  duration: { endAfter: number; endUnit: EndUnit };
} = {
  deliveryType: "values",
  hypothesis:
    "Moving the promo banner below the fold on the cart page will reduce bounce rate without reducing completed orders, because the primary CTA becomes visible without scrolling.",
  description:
    "The promo banner currently sits above the fold on the cart page. Session recordings show a meaningful share of mobile users scrolling straight past it, and we suspect it's pushing the primary CTA down far enough to cost us orders. Moving it below the fold should recover that space without losing the promo entirely.",
  // Mobile, United States.
  targeting: {
    condition: JSON.stringify({ deviceType: "mobile", country: "US" }),
    attributes: ["deviceType", "country"],
  },
  coverage: 1,
  variationWeights: [0.65, 0.35],
  variations: [
    {
      name: "Banner above fold",
      description:
        "Current behaviour. The promo banner renders above the primary CTA.",
      value: "above",
    },
    {
      name: "Banner below fold",
      description:
        "The promo banner renders beneath the primary CTA, inside the order summary block.",
      value: "below",
    },
  ],
  metrics: {
    goal: "Any Purchases",
    secondary: ["Average Order Value"],
    guardrail: ["Revenue per User"],
  },
  duration: { endAfter: 12, endUnit: "days" },
};

// Duration is a STUBBED Setup page field (no product field behind it; see
// setupDraft.ts), so the fixture's duration can't go in the create request.
// It's kept in this browser for the new experiment, as the experiment type
// is (storeExperimentDeliveryType), and the Setup page starts from it.
const DURATION_KEY = (experimentId: string) =>
  `gb-prototype-ai-duration:${experimentId}`;

export function storeAiSetupDuration(
  experimentId: string,
  duration: { endAfter: number; endUnit: EndUnit },
): void {
  try {
    window.localStorage.setItem(
      DURATION_KEY(experimentId),
      JSON.stringify(duration),
    );
  } catch {
    // Prototype-only convenience — fine to no-op if storage is unavailable.
  }
}

export function readAiSetupDuration(
  experimentId: string,
): { endAfter: number; endUnit: EndUnit } | null {
  try {
    const raw = window.localStorage.getItem(DURATION_KEY(experimentId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "endAfter" in parsed &&
      "endUnit" in parsed &&
      typeof parsed.endAfter === "number" &&
      (parsed.endUnit === "days" || parsed.endUnit === "weeks")
    ) {
      return { endAfter: parsed.endAfter, endUnit: parsed.endUnit };
    }
    return null;
  } catch {
    return null;
  }
}

// The spec file a "Set up with AI" experiment was created from: its name
// (the Details rail's Spec row) and its text as attached, a snapshot from
// creation that never updates (the row opens it, read-only). Only written
// when a file was attached. Kept in this browser like the duration above:
// there's no field for it on the experiment.
const SPEC_KEY = (experimentId: string) =>
  `gb-prototype-ai-spec:${experimentId}`;
// Name only, written before the contents were kept. Read as a fallback.
const SPEC_NAME_KEY = (experimentId: string) =>
  `gb-prototype-ai-spec-name:${experimentId}`;

export function storeAiSetupSpec(
  experimentId: string,
  spec: { name: string; content: string },
): void {
  try {
    window.localStorage.setItem(SPEC_KEY(experimentId), JSON.stringify(spec));
  } catch {
    // Prototype-only convenience — fine to no-op if storage is unavailable
    // (or full).
  }
}

// content is null for a spec stored before its contents were kept.
export function readAiSetupSpec(
  experimentId: string,
): { name: string; content: string | null } | null {
  try {
    const raw = window.localStorage.getItem(SPEC_KEY(experimentId));
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "name" in parsed &&
        "content" in parsed &&
        typeof parsed.name === "string" &&
        typeof parsed.content === "string" &&
        parsed.name
      ) {
        return { name: parsed.name, content: parsed.content };
      }
    }
    const name = window.localStorage.getItem(SPEC_NAME_KEY(experimentId));
    return name ? { name, content: null } : null;
  } catch {
    return null;
  }
}
