import {
  ownershipSignTest,
  pairedDeltaTest,
  PairedSufficientStats,
} from "../src/interleaving";

// Fixture computed independently in R
const R_FIXTURE: PairedSufficientStats = {
  users: 40,
  treatment_sum: 96,
  treatment_sum_squares: 316,
  control_sum: 61,
  control_sum_squares: 159,
  exposures_sum: 234,
  exposures_sum_squares: 1564,
  treatment_control_sum_product: 155,
  treatment_exposures_sum_product: 545,
  control_exposures_sum_product: 349,
};

describe("pairedDeltaTest", () => {
  it("matches R-computed delta-method values", () => {
    const res = pairedDeltaTest(R_FIXTURE);
    expect(res.errorMessage).toBeNull();
    expect(res.expected).toBeCloseTo(0.1495726496, 9);
    expect(res.uplift.stddev).toBeCloseTo(0.0514565834, 9);
    expect(res.pValue).toBeCloseTo(0.0059939522, 9);
    expect(res.ci[0]).toBeCloseTo(0.0454918856, 9);
    expect(res.ci[1]).toBeCloseTo(0.2536534135, 9);
  });

  it("reduces to the classic paired t-test when N is constant 1", () => {
    // Same x/y as the fixture with unit denominators; R: t.test(x, y, paired=TRUE)
    const res = pairedDeltaTest({
      users: 40,
      treatment_sum: 96,
      treatment_sum_squares: 316,
      control_sum: 61,
      control_sum_squares: 159,
      exposures_sum: 40,
      exposures_sum_squares: 40,
      treatment_control_sum_product: 155,
      treatment_exposures_sum_product: 96,
      control_exposures_sum_product: 61,
    });
    expect(res.expected).toBeCloseTo(0.875, 9);
    expect(res.uplift.stddev).toBeCloseTo(0.2934924539, 9);
    expect(res.pValue).toBeCloseTo(0.004924666, 8);
    expect(res.ci[0]).toBeCloseTo(0.2813554783, 8);
    expect(res.ci[1]).toBeCloseTo(1.4686445217, 8);
  });

  it("positive X/Y covariance shrinks the SE vs zero covariance", () => {
    const base = { ...R_FIXTURE };
    // remove the pairing benefit: set treatment_control_sum_product to the independence value users*mean(t)*mean(c)
    const independent = {
      ...base,
      treatment_control_sum_product:
        (base.treatment_sum * base.control_sum) / base.users,
    };
    const paired = pairedDeltaTest(base);
    const unpaired = pairedDeltaTest(independent);
    expect(paired.uplift.stddev).toBeLessThan(unpaired.uplift.stddev);
  });

  it("guards degenerate inputs", () => {
    expect(pairedDeltaTest({ ...R_FIXTURE, users: 1 }).errorMessage).toBe(
      "NOT_ENOUGH_USERS",
    );
    expect(
      pairedDeltaTest({ ...R_FIXTURE, exposures_sum: 0 }).errorMessage,
    ).toBe("NO_COMPETITIVE_EXPOSURES");
    const zeroVar = pairedDeltaTest({
      users: 10,
      treatment_sum: 10,
      treatment_sum_squares: 10,
      control_sum: 10,
      control_sum_squares: 10,
      exposures_sum: 10,
      exposures_sum_squares: 10,
      treatment_control_sum_product: 10,
      treatment_exposures_sum_product: 10,
      control_exposures_sum_product: 10,
    });
    expect(zeroVar.errorMessage).toBe("ZERO_VARIANCE");
    expect(zeroVar.pValue).toBeNull();
  });
});

describe("ownershipSignTest", () => {
  it("matches R binom.test / hand-computed values", () => {
    const res = ownershipSignTest({
      users_pref_treatment: 30,
      users_pref_control: 18,
      users_tied: 12,
    });
    expect(res.errorMessage).toBeNull();
    expect(res.expected).toBeCloseTo(0.2, 10); // (30-18)/60
    expect(res.pValue).toBeCloseTo(0.1114028911, 9);
    expect(res.uplift.stddev).toBeCloseTo(0.1118033989, 9);
    const halfWidth = 0.2191306351;
    expect(res.ci[0]).toBeCloseTo(0.2 - halfWidth, 8);
    expect(res.ci[1]).toBeCloseTo(0.2 + halfWidth, 8);
  });

  it("is symmetric: swapping T and C flips the sign", () => {
    const a = ownershipSignTest({
      users_pref_treatment: 30,
      users_pref_control: 18,
      users_tied: 12,
    });
    const b = ownershipSignTest({
      users_pref_treatment: 18,
      users_pref_control: 30,
      users_tied: 12,
    });
    expect(b.expected).toBeCloseTo(-(a.expected ?? 0), 10);
    expect(b.pValue).toBeCloseTo(a.pValue ?? -1, 10);
  });

  it("handles a balanced null with p-value 1", () => {
    const res = ownershipSignTest({
      users_pref_treatment: 25,
      users_pref_control: 25,
      users_tied: 0,
    });
    expect(res.expected).toBe(0);
    expect(res.pValue).toBeCloseTo(1, 6);
  });

  it("guards all-ties and tiny samples", () => {
    expect(
      ownershipSignTest({
        users_pref_treatment: 0,
        users_pref_control: 0,
        users_tied: 100,
      }).errorMessage,
    ).toBe("NOT_ENOUGH_USERS");
    expect(
      ownershipSignTest({
        users_pref_treatment: 1,
        users_pref_control: 0,
        users_tied: 0,
      }).errorMessage,
    ).toBe("NOT_ENOUGH_USERS");
  });
});
