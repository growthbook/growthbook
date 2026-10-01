import {
  ownershipSignTest,
  pairedDeltaTest,
  PairedSufficientStats,
} from "../src/interleaving";

// Fixture computed independently in R (see interleave-sim.R companion work):
// set.seed(42); x ~ Pois(2), y ~ Pois(1.6), n ~ Pois(5)+1, 40 users
const R_FIXTURE: PairedSufficientStats = {
  users: 40,
  sum_x: 96,
  sum_xx: 316,
  sum_y: 61,
  sum_yy: 159,
  sum_n: 234,
  sum_nn: 1564,
  sum_xy: 155,
  sum_xn: 545,
  sum_yn: 349,
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
      sum_x: 96,
      sum_xx: 316,
      sum_y: 61,
      sum_yy: 159,
      sum_n: 40,
      sum_nn: 40,
      sum_xy: 155,
      sum_xn: 96,
      sum_yn: 61,
    });
    expect(res.expected).toBeCloseTo(0.875, 9);
    expect(res.uplift.stddev).toBeCloseTo(0.2934924539, 9);
    expect(res.pValue).toBeCloseTo(0.004924666, 8);
    expect(res.ci[0]).toBeCloseTo(0.2813554783, 8);
    expect(res.ci[1]).toBeCloseTo(1.4686445217, 8);
  });

  it("positive X/Y covariance shrinks the SE vs zero covariance", () => {
    const base = { ...R_FIXTURE };
    // remove the pairing benefit: set sum_xy to the independence value n*mx*my
    const independent = {
      ...base,
      sum_xy: (base.sum_x * base.sum_y) / base.users,
    };
    const paired = pairedDeltaTest(base);
    const unpaired = pairedDeltaTest(independent);
    expect(paired.uplift.stddev).toBeLessThan(unpaired.uplift.stddev);
  });

  it("guards degenerate inputs", () => {
    expect(pairedDeltaTest({ ...R_FIXTURE, users: 1 }).errorMessage).toBe(
      "NOT_ENOUGH_USERS",
    );
    expect(pairedDeltaTest({ ...R_FIXTURE, sum_n: 0 }).errorMessage).toBe(
      "NO_COMPETITIVE_EXPOSURES",
    );
    const zeroVar = pairedDeltaTest({
      users: 10,
      sum_x: 10,
      sum_xx: 10,
      sum_y: 10,
      sum_yy: 10,
      sum_n: 10,
      sum_nn: 10,
      sum_xy: 10,
      sum_xn: 10,
      sum_yn: 10,
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
