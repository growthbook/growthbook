import {
  escapeSlackMrkdwn,
  truncateSlackText,
  toSlackMrkdwn,
} from "back-end/src/util/slack.util";

describe("escapeSlackMrkdwn", () => {
  it("escapes the three mrkdwn control characters", () => {
    expect(escapeSlackMrkdwn("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  it("neutralizes channel-ping injection", () => {
    // Without escaping, `<!channel>` would ping everyone in the channel.
    expect(escapeSlackMrkdwn("<!channel> hi")).toBe("&lt;!channel&gt; hi");
    expect(escapeSlackMrkdwn("<!here>")).toBe("&lt;!here&gt;");
  });

  it("neutralizes link markup", () => {
    expect(escapeSlackMrkdwn("<https://evil.test|click>")).toBe(
      "&lt;https://evil.test|click&gt;",
    );
  });

  it("escapes & before < and > so entities are not double-escaped", () => {
    // A literal "<" must become "&lt;", not "&amp;lt;".
    expect(escapeSlackMrkdwn("<")).toBe("&lt;");
    expect(escapeSlackMrkdwn("&")).toBe("&amp;");
    // A literal ampersand followed by "lt;" stays distinct from an escaped "<".
    expect(escapeSlackMrkdwn("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary text and the empty string untouched", () => {
    expect(escapeSlackMrkdwn("")).toBe("");
    expect(escapeSlackMrkdwn("just a normal sentence.")).toBe(
      "just a normal sentence.",
    );
  });
});

describe("truncateSlackText", () => {
  it("returns text unchanged when at or under the limit", () => {
    expect(truncateSlackText("hello", 10)).toBe("hello");
    expect(truncateSlackText("hello", 5)).toBe("hello");
  });

  it("clamps over-limit text to under the limit and appends an ellipsis", () => {
    const result = truncateSlackText("abcdefghij", 5);
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result.endsWith("…")).toBe(true);
  });

  it("drops a trailing partial entity so the cut is not broken markup", () => {
    // "xx&amp;" — cutting at 4 would leave "xx&a"; the partial entity is stripped.
    const result = truncateSlackText("xx&amp;yy", 4);
    expect(result).toBe("xx…");
  });

  it("keeps a complete escaped run intact when it ends before the cut", () => {
    const escaped = escapeSlackMrkdwn("&&&&&&&&&&"); // 10 -> 50 chars
    const result = truncateSlackText(escaped, 20);
    expect(result.length).toBeLessThanOrEqual(20);
    // never ends mid-entity (no dangling "&", "&a", "&am", "&amp")
    expect(/&[a-z]*$/i.test(result.replace(/…$/, ""))).toBe(false);
  });
});

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
