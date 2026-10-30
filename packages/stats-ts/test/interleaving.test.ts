import {
  preferenceSignTest,
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
    expect(res.method).toBe("paired_delta_t");
    expect(res.errorMessage).toBeNull();
    expect(res.expected).toBeCloseTo(0.1495726496, 9);
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
    expect(res.pValue).toBeCloseTo(0.004924666, 8);
    expect(res.ci[0]).toBeCloseTo(0.2813554783, 8);
    expect(res.ci[1]).toBeCloseTo(1.4686445217, 8);
  });

  it("positive X/Y covariance narrows the CI vs zero covariance", () => {
    const base = { ...R_FIXTURE };
    // remove the pairing benefit: set treatment_control_sum_product to the independence value users*mean(t)*mean(c)
    const independent = {
      ...base,
      treatment_control_sum_product:
        (base.treatment_sum * base.control_sum) / base.users,
    };
    const paired = pairedDeltaTest(base);
    const unpaired = pairedDeltaTest(independent);
    const width = (r: { ci: (number | null)[] }) =>
      (r.ci[1] ?? NaN) - (r.ci[0] ?? NaN);
    expect(width(paired)).toBeLessThan(width(unpaired));
  });

  it("guards degenerate inputs", () => {
    const notEnough = pairedDeltaTest({ ...R_FIXTURE, users: 1 });
    expect(notEnough.errorMessage).toBe("NOT_ENOUGH_USERS");
    expect(notEnough.method).toBe("paired_delta_t");
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

describe("preferenceSignTest", () => {
  it("matches R binom.test / hand-computed values", () => {
    const res = preferenceSignTest({
      users_pref_treatment: 30,
      users_pref_control: 18,
      users_tied: 12,
    });
    expect(res.method).toBe("exact_binomial_sign");
    expect(res.errorMessage).toBeNull();
    expect(res.expected).toBeCloseTo(0.25, 10); // (30-18)/(30+18)
    expect(res.pValue).toBeCloseTo(0.1114028911, 9);
    // Clopper-Pearson on the 30/48 non-tied proportion, mapped by tau = 2p - 1.
    expect(res.ci[0]).toBeCloseTo(-0.0529884788, 8);
    expect(res.ci[1]).toBeCloseTo(0.5209551931, 8);
  });

  it("is symmetric: swapping T and C flips the sign", () => {
    const a = preferenceSignTest({
      users_pref_treatment: 30,
      users_pref_control: 18,
      users_tied: 12,
    });
    const b = preferenceSignTest({
      users_pref_treatment: 18,
      users_pref_control: 30,
      users_tied: 12,
    });
    expect(b.expected).toBeCloseTo(-(a.expected ?? 0), 10);
    expect(b.pValue).toBeCloseTo(a.pValue ?? -1, 10);
  });

  it("handles a balanced null with p-value 1", () => {
    const res = preferenceSignTest({
      users_pref_treatment: 25,
      users_pref_control: 25,
      users_tied: 0,
    });
    expect(res.expected).toBe(0);
    expect(res.pValue).toBeCloseTo(1, 6);
  });

  // A Wald interval has zero variance when every non-tied user agrees, which
  // made the CI a point and contradicted the exact p-value.
  it("keeps a usable interval when every non-tied user prefers one ranker", () => {
    const res = preferenceSignTest({
      users_pref_treatment: 2,
      users_pref_control: 0,
      users_tied: 98,
    });
    expect(res.errorMessage).toBeNull();
    expect(res.expected).toBeCloseTo(1, 10);
    expect(res.pValue).toBeCloseTo(0.5, 10);
    expect(res.ci[0]).toBeCloseTo(-0.683772234, 8);
    expect(res.ci[1]).toBeCloseTo(1, 10);
  });

  it("agrees with the exact p-value about whether zero is excluded", () => {
    const cases = [
      { users_pref_treatment: 2, users_pref_control: 0, users_tied: 98 },
      { users_pref_treatment: 5, users_pref_control: 0, users_tied: 0 },
      { users_pref_treatment: 1, users_pref_control: 0, users_tied: 1 },
      { users_pref_treatment: 30, users_pref_control: 18, users_tied: 12 },
      { users_pref_treatment: 0, users_pref_control: 9, users_tied: 3 },
      { users_pref_treatment: 25, users_pref_control: 25, users_tied: 0 },
    ];
    for (const counts of cases) {
      const res = preferenceSignTest(counts);
      const [lo, hi] = res.ci;
      const excludesZero = (lo ?? 0) > 0 || (hi ?? 0) < 0;
      expect(excludesZero).toBe((res.pValue ?? 1) < 0.05);
    }
  });

  it("guards all-ties and tiny samples", () => {
    expect(
      preferenceSignTest({
        users_pref_treatment: 0,
        users_pref_control: 0,
        users_tied: 100,
      }).errorMessage,
    ).toBe("NOT_ENOUGH_USERS");
    expect(
      preferenceSignTest({
        users_pref_treatment: 1,
        users_pref_control: 0,
        users_tied: 100,
      }).errorMessage,
    ).toBe("NOT_ENOUGH_USERS");
  });
});
