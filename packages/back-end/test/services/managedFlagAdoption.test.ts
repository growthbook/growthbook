import type { ExperimentInterface } from "shared/validators";
import {
  managedFlagAdoptionBlocker,
  planManagedFlagKey,
  staleLinkedFeatureIds,
} from "back-end/src/services/managedFeatures";
import { featureIdExists } from "back-end/src/models/FeatureModel";
import { getExperimentByTrackingKey } from "back-end/src/models/ExperimentModel";

jest.mock("back-end/src/models/FeatureModel", () => ({
  featureIdExists: jest.fn(),
  createFeature: jest.fn(),
  deleteFeature: jest.fn(),
  getFeature: jest.fn(),
  publishRevision: jest.fn(),
  updateFeature: jest.fn(),
}));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  getExperimentByTrackingKey: jest.fn(),
}));

const mockExists = featureIdExists as jest.Mock;
const mockByTrackingKey = getExperimentByTrackingKey as jest.Mock;

const experiment = (over: Partial<ExperimentInterface> = {}) =>
  ({
    id: "exp_1",
    trackingKey: "checkout-test",
    status: "draft",
    archived: false,
    linkedFeatures: [],
    hasVisualChangesets: false,
    hasURLRedirects: false,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any as ExperimentInterface;

const context = {
  org: { id: "org_1", settings: {} },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

/** Only these ids are already taken. */
const taken = (...ids: string[]) => {
  mockExists.mockImplementation(async (_ctx, id: string) => ids.includes(id));
};

beforeEach(() => {
  jest.clearAllMocks();
  context.org.settings = {};
  taken();
  mockByTrackingKey.mockResolvedValue(null);
});

describe("managedFlagAdoptionBlocker", () => {
  it("allows a draft experiment with nothing wired up", async () => {
    expect(await managedFlagAdoptionBlocker(context, experiment())).toBeNull();
  });

  it("refuses a running experiment", async () => {
    expect(
      await managedFlagAdoptionBlocker(
        context,
        experiment({ status: "running" }),
      ),
    ).toMatch(/draft/i);
  });

  it("refuses when Visual Editor changes or redirects already exist", async () => {
    expect(
      await managedFlagAdoptionBlocker(
        context,
        experiment({ hasVisualChangesets: true }),
      ),
    ).toMatch(/Visual Editor/);
    expect(
      await managedFlagAdoptionBlocker(
        context,
        experiment({ hasURLRedirects: true }),
      ),
    ).toMatch(/URL Redirects/);
  });

  it("refuses when a linked flag still exists", async () => {
    taken("other-flag");
    expect(
      await managedFlagAdoptionBlocker(
        context,
        experiment({ linkedFeatures: ["other-flag"] }),
      ),
    ).toMatch(/already has a linked Feature Flag/);
  });

  it("allows adoption again after the linked flag was deleted out of band", async () => {
    // The id survives in linkedFeatures but resolves to nothing; treating that
    // as "already linked" would bar the experiment from ever recovering.
    taken();
    expect(
      await managedFlagAdoptionBlocker(
        context,
        experiment({ linkedFeatures: ["deleted-flag"] }),
      ),
    ).toBeNull();
  });

  it("still refuses when only SOME linked flags were deleted", async () => {
    taken("live-flag");
    expect(
      await managedFlagAdoptionBlocker(
        context,
        experiment({ linkedFeatures: ["deleted-flag", "live-flag"] }),
      ),
    ).toMatch(/already has a linked Feature Flag/);
  });
});

describe("staleLinkedFeatureIds", () => {
  it("returns only the ids that no longer resolve", async () => {
    taken("live-flag");
    expect(
      await staleLinkedFeatureIds(
        context,
        experiment({ linkedFeatures: ["deleted-flag", "live-flag"] }),
      ),
    ).toEqual(["deleted-flag"]);
  });
});

describe("planManagedFlagKey", () => {
  it("reports the derived id as available when nothing holds it", async () => {
    const plan = await planManagedFlagKey({
      context,
      experiment: experiment(),
    });
    expect(plan.derivedId).toBe("checkout-test");
    expect(plan.derivedIdAvailable).toBe(true);
    expect(plan.sanitized).toBe(false);
    expect(plan.suggestedPair).toBeNull();
  });

  it("flags a sanitized key so the UI can explain the difference", async () => {
    const plan = await planManagedFlagKey({
      context,
      experiment: experiment({ trackingKey: "My Checkout Test" }),
    });
    expect(plan.derivedId).toBe("My-Checkout-Test");
    expect(plan.sanitized).toBe(true);
    expect(plan.derivedIdAvailable).toBe(true);
  });

  it("suggests a free matching pair when the derived id is taken", async () => {
    taken("checkout-test");
    const plan = await planManagedFlagKey({
      context,
      experiment: experiment(),
    });
    expect(plan.derivedIdAvailable).toBe(false);
    // Both sides equal, so the flag key and the experiment key match exactly.
    expect(plan.suggestedPair).toEqual({
      trackingKey: "checkout-test-2",
      featureId: "checkout-test-2",
    });
  });

  it("skips a candidate whose tracking key another experiment holds", async () => {
    taken("checkout-test");
    mockByTrackingKey.mockImplementation(async (_ctx, key: string) =>
      key === "checkout-test-2" ? { id: "exp_other" } : null,
    );
    const plan = await planManagedFlagKey({
      context,
      experiment: experiment(),
    });
    expect(plan.suggestedPair?.featureId).toBe("checkout-test-3");
  });

  it("does not treat the experiment's own key as a conflict", async () => {
    taken("checkout-test");
    mockByTrackingKey.mockImplementation(async (_ctx, key: string) =>
      key === "checkout-test-2" ? { id: "exp_1" } : null,
    );
    const plan = await planManagedFlagKey({
      context,
      experiment: experiment(),
    });
    expect(plan.suggestedPair?.featureId).toBe("checkout-test-2");
  });

  it("reports the org key format as an error and skips candidates that fail it", async () => {
    context.org.settings = { featureRegexValidator: "^ff-" };
    taken();
    const plan = await planManagedFlagKey({
      context,
      experiment: experiment(),
    });
    expect(plan.regexError).toContain("^ff-");
  });

  it("returns no suggestion when every candidate is taken", async () => {
    mockExists.mockResolvedValue(true);
    const plan = await planManagedFlagKey({
      context,
      experiment: experiment(),
    });
    expect(plan.derivedIdAvailable).toBe(false);
    expect(plan.suggestedPair).toBeNull();
  });
});
