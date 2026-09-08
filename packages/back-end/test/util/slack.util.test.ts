import {
  escapeSlackMrkdwn,
  truncateSlackText,
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
