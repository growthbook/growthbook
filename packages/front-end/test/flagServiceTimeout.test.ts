import {
  FLAG_SERVICE_TIMEOUT_MEMORY_MS,
  skipFlagServiceWait,
} from "@/components/Layout/flagServiceTimeout";

const now = 1_800_000_000_000;
const hour = 60 * 60 * 1000;

describe("skipFlagServiceWait", () => {
  it("waits when no timeout was stored", () => {
    expect(skipFlagServiceWait({ now, stored: null, sdkReady: false })).toBe(
      false,
    );
  });

  it("skips the wait after a timeout less than a day old", () => {
    expect(
      skipFlagServiceWait({
        now,
        stored: String(now - hour),
        sdkReady: false,
      }),
    ).toBe(true);
  });

  it("never skips once the SDK is ready, however fresh the timeout", () => {
    expect(
      skipFlagServiceWait({ now, stored: String(now), sdkReady: true }),
    ).toBe(false);
  });

  it("waits again once the timeout is a day old", () => {
    expect(
      skipFlagServiceWait({
        now,
        stored: String(now - FLAG_SERVICE_TIMEOUT_MEMORY_MS),
        sdkReady: false,
      }),
    ).toBe(false);
  });

  it("waits when the stored time is in the future", () => {
    expect(
      skipFlagServiceWait({
        now,
        stored: String(now + hour),
        sdkReady: false,
      }),
    ).toBe(false);
  });

  it.each([
    "",
    "soon",
    "1.7999964e12",
    `${now - hour}.5`,
    ` ${now - hour}`,
    `0x${(now - hour).toString(16)}`,
  ])("waits when the stored value %j is not a timestamp", (stored) => {
    expect(skipFlagServiceWait({ now, stored, sdkReady: false })).toBe(false);
  });
});
