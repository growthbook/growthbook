import {
  addDays,
  allowedExpirationPresets,
  getExpirationStatus,
  isExpired,
  maxExpirationDate,
  violatesExpirationPolicy,
} from "shared/api-key-expiration";

// Fixed clock so "expiring soon" boundaries are exact rather than relative to
// whenever the suite happens to run.
const NOW = new Date("2026-06-01T12:00:00.000Z");

describe("getExpirationStatus", () => {
  it("treats a missing expiry as no expiration", () => {
    expect(getExpirationStatus(null, NOW)).toBe("none");
    expect(getExpirationStatus(undefined, NOW)).toBe("none");
  });

  it("treats an unparseable stored value as no expiration rather than active", () => {
    expect(getExpirationStatus("not-a-date", NOW)).toBe("none");
  });

  it("is expired at the boundary, not just past it", () => {
    expect(getExpirationStatus(NOW, NOW)).toBe("expired");
    expect(getExpirationStatus(addDays(NOW, -1), NOW)).toBe("expired");
  });

  it("flags the week before expiry as expiring soon", () => {
    expect(getExpirationStatus(addDays(NOW, 1), NOW)).toBe("expiring-soon");
    expect(getExpirationStatus(addDays(NOW, 7), NOW)).toBe("expiring-soon");
  });

  it("is active beyond the expiring-soon window", () => {
    expect(getExpirationStatus(addDays(NOW, 8), NOW)).toBe("active");
    expect(getExpirationStatus(addDays(NOW, 365), NOW)).toBe("active");
  });

  it("accepts an ISO string, as stored docs deserialize to", () => {
    expect(getExpirationStatus(addDays(NOW, 30).toISOString(), NOW)).toBe(
      "active",
    );
  });
});

describe("isExpired", () => {
  it("only reports genuinely elapsed expiry dates", () => {
    expect(isExpired(addDays(NOW, -1), NOW)).toBe(true);
    expect(isExpired(addDays(NOW, 1), NOW)).toBe(false);
    expect(isExpired(null, NOW)).toBe(false);
  });
});

describe("maxExpirationDate", () => {
  it("returns null when no policy is set", () => {
    expect(maxExpirationDate(null, NOW)).toBeNull();
    expect(maxExpirationDate(undefined, NOW)).toBeNull();
  });

  it("projects the policy forward from now", () => {
    expect(maxExpirationDate(30, NOW)).toEqual(addDays(NOW, 30));
  });
});

describe("violatesExpirationPolicy", () => {
  it("never flags anything when no policy is set", () => {
    expect(violatesExpirationPolicy(null, null, NOW)).toBe(false);
    expect(violatesExpirationPolicy(addDays(NOW, 3650), null, NOW)).toBe(false);
  });

  it("flags a key with no expiry at all", () => {
    expect(violatesExpirationPolicy(null, 30, NOW)).toBe(true);
  });

  it("flags a key that outlives the maximum", () => {
    expect(violatesExpirationPolicy(addDays(NOW, 90), 30, NOW)).toBe(true);
  });

  it("accepts a key at or under the maximum", () => {
    expect(violatesExpirationPolicy(addDays(NOW, 30), 30, NOW)).toBe(false);
    expect(violatesExpirationPolicy(addDays(NOW, 7), 30, NOW)).toBe(false);
  });

  it("does not flag an already-expired key, which is enforced elsewhere", () => {
    expect(violatesExpirationPolicy(addDays(NOW, -1), 30, NOW)).toBe(false);
  });
});

describe("allowedExpirationPresets", () => {
  it("offers every preset when no policy is set", () => {
    expect(allowedExpirationPresets(null)).toEqual([7, 30, 60, 90, 180, 365]);
  });

  it("caps presets at the policy maximum", () => {
    expect(allowedExpirationPresets(90)).toEqual([7, 30, 60, 90]);
  });

  it("falls back to the policy maximum when it undercuts every preset", () => {
    expect(allowedExpirationPresets(1)).toEqual([1]);
  });
});
