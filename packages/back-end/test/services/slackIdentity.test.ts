import { selectCandidateWebhooks } from "back-end/src/services/slack/slackIdentity";

type W = { id: string; organizationId: string; slack?: { channelId?: string } };

const wh = (id: string, org: string, channelId?: string): W => ({
  id,
  organizationId: org,
  slack: channelId ? { channelId } : {},
});

describe("selectCandidateWebhooks", () => {
  it("prefers webhooks bound to the exact channel the mention came from", () => {
    const webhooks = [
      wh("a", "org1", "C_ONE"),
      wh("b", "org2", "C_TWO"),
      wh("c", "org3", "C_THREE"),
    ];
    const out = selectCandidateWebhooks(webhooks, "C_TWO");
    expect(out.map((w) => w.organizationId)).toEqual(["org2"]);
  });

  it("falls back to all webhooks when the mention channel isn't a connected one", () => {
    const webhooks = [wh("a", "org1", "C_ONE"), wh("b", "org2", "C_TWO")];
    const out = selectCandidateWebhooks(webhooks, "C_OTHER");
    expect(new Set(out.map((w) => w.organizationId))).toEqual(
      new Set(["org1", "org2"]),
    );
  });

  it("falls back to all webhooks when no channel id is available (e.g. a DM)", () => {
    const webhooks = [wh("a", "org1", "C_ONE"), wh("b", "org2", "C_TWO")];
    const out = selectCandidateWebhooks(webhooks, "");
    expect(out).toHaveLength(2);
  });

  it("dedupes to one representative webhook per org", () => {
    // Same org connected to two channels, plus a second org.
    const webhooks = [
      wh("a", "org1", "C_ONE"),
      wh("b", "org1", "C_TWO"),
      wh("c", "org2", "C_THREE"),
    ];
    const out = selectCandidateWebhooks(webhooks, "C_OTHER");
    expect(out).toHaveLength(2);
    expect(new Set(out.map((w) => w.organizationId))).toEqual(
      new Set(["org1", "org2"]),
    );
  });

  it("keeps the channel-matched webhook when one org connects multiple channels", () => {
    const webhooks = [wh("a", "org1", "C_ONE"), wh("b", "org1", "C_TWO")];
    const out = selectCandidateWebhooks(webhooks, "C_TWO");
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("b");
  });

  it("returns the single webhook unchanged for the common one-org case", () => {
    const webhooks = [wh("a", "org1", "C_ONE")];
    expect(selectCandidateWebhooks(webhooks, "C_ONE")).toHaveLength(1);
    expect(selectCandidateWebhooks(webhooks, "C_ELSEWHERE")).toHaveLength(1);
  });
});
