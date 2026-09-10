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

it("neutralizes Slack mentions while preserving generated links", () => {
  expect(
    toSlackMrkdwn("<!channel> <!here> <@U123> & [results](/experiment/exp_1)", {
      appOrigin: APP_ORIGIN,
    }),
  ).toBe(
    "&lt;!channel&gt; &lt;!here&gt; &lt;@U123&gt; &amp; <https://app.growthbook.io/experiment/exp_1|results>",
  );
});
it("escapes mentions in link labels and rejects control syntax in URLs", () => {
  const result = toSlackMrkdwn(
    "[<@U123>](/experiment/x) [x](https://example.com/><!here>) [y](javascript:alert)",
    { appOrigin: APP_ORIGIN },
  );
  expect(result).toContain(
    "<https://app.growthbook.io/experiment/x|&lt;@U123&gt;>",
  );
  expect(result).not.toContain("<!here>");
  expect(result).not.toContain("<javascript:");
});
it("does not turn encoded entities into active mentions", () => {
  expect(toSlackMrkdwn("&lt;!channel&gt;", { appOrigin: APP_ORIGIN })).toBe(
    "&amp;lt;!channel&amp;gt;",
  );
});
