import {
  claimMfaStep,
  consumeMfaRecoveryCode,
} from "back-end/src/models/UserModel";
import {
  assertMfaCode,
  encryptMfaSecret,
  generateRecoveryCodes,
} from "back-end/src/services/mfa";

jest.mock("back-end/src/models/UserModel", () => ({
  claimMfaStep: jest.fn(),
  consumeMfaRecoveryCode: jest.fn(),
}));
jest.mock("back-end/src/services/auth", () => ({
  getAuthConnection: jest.fn(),
}));

const mockClaim = jest.mocked(claimMfaStep);
const mockConsume = jest.mocked(consumeMfaRecoveryCode);

// RFC 6238 SHA-1 key; "287082" is its code at T=59s (step 1)
const RFC_KEY = Buffer.from("12345678901234567890", "ascii");
let n = 0;
const newUser = () => ({
  id: `u_test_${++n}`,
  mfaSecret: encryptMfaSecret(RFC_KEY),
  mfaLastUsedStep: undefined,
});

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(59 * 1000);
  mockClaim.mockReset().mockResolvedValue(true);
  mockConsume.mockReset().mockResolvedValue(false);
});
afterEach(() => jest.useRealTimers());

describe("generateRecoveryCodes", () => {
  it("returns 10 distinct codes with matching SHA-256 hashes", () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    codes.forEach((c) =>
      expect(c).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/),
    );
    hashes.forEach((h) => expect(h).toMatch(/^[0-9a-f]{64}$/));
    expect(new Set(hashes).size).toBe(10);
  });
});

describe("assertMfaCode", () => {
  it("accepts an authenticator code and claims its time step", async () => {
    const user = newUser();
    await expect(assertMfaCode(user, "287082")).resolves.toBeUndefined();
    expect(mockClaim).toHaveBeenCalledWith(user.id, undefined, 1);
  });

  it("rejects a valid code whose step was already claimed", async () => {
    mockClaim.mockResolvedValue(false);
    await expect(assertMfaCode(newUser(), "287082")).rejects.toThrow(
      "Invalid authentication code",
    );
  });

  it("rejects a wrong code, and non-string input, without touching storage", async () => {
    await expect(assertMfaCode(newUser(), "123456")).rejects.toThrow(
      "Invalid authentication code",
    );
    await expect(assertMfaCode(newUser(), 287082)).rejects.toThrow(
      "Invalid authentication code",
    );
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("spends recovery codes by a hash that ignores case and dashes", async () => {
    mockConsume.mockResolvedValue(true);
    const user = newUser();
    const { codes, hashes } = generateRecoveryCodes();
    await assertMfaCode(user, codes[0]);
    await assertMfaCode(user, codes[0].replace(/-/g, "").toUpperCase());
    expect(mockConsume).toHaveBeenNthCalledWith(1, user.id, hashes[0]);
    expect(mockConsume).toHaveBeenNthCalledWith(2, user.id, hashes[0]);
  });

  it("rejects everything after 10 failures until the window passes", async () => {
    const user = newUser();
    for (let i = 0; i < 10; i++) {
      await expect(assertMfaCode(user, "000000")).rejects.toThrow(
        "Invalid authentication code",
      );
    }
    await expect(assertMfaCode(user, "287082")).rejects.toMatchObject({
      status: 429,
    });
    jest.setSystemTime(59 * 1000 + 15 * 60 * 1000);
    mockClaim.mockResolvedValue(true);
    // A fresh window; any code for the new time is checked again, not blocked
    await expect(assertMfaCode(user, "000000")).rejects.toThrow(
      "Invalid authentication code",
    );
  });

  it("doesn't count successes or storage errors as failures", async () => {
    const user = newUser();
    mockConsume.mockRejectedValue(new Error("db down"));
    for (let i = 0; i < 12; i++) {
      await expect(assertMfaCode(user, "abcd-efgh")).rejects.toThrow("db down");
    }
    for (let i = 0; i < 12; i++) {
      await expect(assertMfaCode(user, "287082")).resolves.toBeUndefined();
    }
  });
});
