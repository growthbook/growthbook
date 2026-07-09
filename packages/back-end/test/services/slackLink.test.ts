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
    expect(verifySlackLinkState(stateFromUrl(url))).toEqual({
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
