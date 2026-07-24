import { toSlackMrkdwn } from "back-end/src/services/slack/slackMarkdown";

const APP_ORIGIN = "https://app.growthbook.io";

describe("toSlackMrkdwn", () => {
  it("absolutizes relative markdown links into Slack link syntax", () => {
    expect(
      toSlackMrkdwn("See the [checkout test](/experiment/exp_123).", {
        appOrigin: APP_ORIGIN,
      }),
    ).toBe(
      "See the <https://app.growthbook.io/experiment/exp_123|checkout test>.",
    );
  });

  it("leaves absolute links untouched (aside from syntax conversion)", () => {
    expect(
      toSlackMrkdwn("[docs](https://docs.growthbook.io/x)", {
        appOrigin: APP_ORIGIN,
      }),
    ).toBe("<https://docs.growthbook.io/x|docs>");
  });

  it("does not double the origin when it has a trailing slash", () => {
    expect(
      toSlackMrkdwn("[a](/b)", { appOrigin: "https://app.growthbook.io/" }),
    ).toBe("<https://app.growthbook.io/b|a>");
  });

  it("converts ** and __ bold to single-asterisk Slack bold", () => {
    expect(
      toSlackMrkdwn("**bold** and __also__", { appOrigin: APP_ORIGIN }),
    ).toBe("*bold* and *also*");
  });

  it("renders markdown headings as a bold line", () => {
    expect(toSlackMrkdwn("## Results", { appOrigin: APP_ORIGIN })).toBe(
      "*Results*",
    );
  });

  it("handles multiple links in one message", () => {
    expect(
      toSlackMrkdwn("[one](/a) then [two](/b)", { appOrigin: APP_ORIGIN }),
    ).toBe(
      "<https://app.growthbook.io/a|one> then <https://app.growthbook.io/b|two>",
    );
  });
});
