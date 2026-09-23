import { vi } from "vitest";
import {
  buildSlackLinkUrl,
  verifySlackLinkState,
} from "back-end/src/services/slack/slackLink";

function stateFromUrl(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get("state") || "");
}

describe("slackLink signed state", () => {
  it("builds a link URL to the account-link page carrying a state", () => {
    const url = buildSlackLinkUrl({ slackTeamId: "T1", slackUserId: "U1" });
    expect(url).toContain("/integrations/slack/link?state=");
  });

  it("round-trips the team + user ids", () => {
    const url = buildSlackLinkUrl({ slackTeamId: "T123", slackUserId: "U456" });
    expect(verifySlackLinkState(stateFromUrl(url))).toMatchObject({
      slackTeamId: "T123",
      slackUserId: "U456",
    });
  });

  it("rejects a tampered payload (signature mismatch)", () => {
    const url = buildSlackLinkUrl({ slackTeamId: "T1", slackUserId: "U1" });
    const [payload, sig] = stateFromUrl(url).split(".");
    const flipped =
      (payload || "").slice(0, -1) + (payload?.endsWith("A") ? "B" : "A");
    expect(verifySlackLinkState(`${flipped}.${sig}`)).toBeNull();
  });

  it("rejects malformed states", () => {
    expect(verifySlackLinkState("garbage")).toBeNull();
    expect(verifySlackLinkState("onlyonepart")).toBeNull();
    expect(verifySlackLinkState("")).toBeNull();
  });
});

it("rejects appended data and expired consent, including future timestamps", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
    const state = stateFromUrl(
      buildSlackLinkUrl({ slackTeamId: "T1", slackUserId: "U1" }),
    );
    expect(verifySlackLinkState(`${state}.extra`)).toBeNull();
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(verifySlackLinkState(state)).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(verifySlackLinkState(state)).toBeNull();
    vi.setSystemTime(new Date("2026-09-16T23:59:59Z"));
    expect(verifySlackLinkState(state)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
