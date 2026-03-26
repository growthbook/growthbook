import { describe, it, expect } from "vitest";
import { isSafeUrl, sanitizeUrl } from "@/services/urlSanitization";

describe("isSafeUrl", () => {
  it("allows http and https URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("http://example.com/path?q=1")).toBe(true);
  });

  it("allows relative URLs", () => {
    expect(isSafeUrl("/path/to/page")).toBe(true);
    expect(isSafeUrl("page.html")).toBe(true);
    expect(isSafeUrl("#anchor")).toBe(true);
    expect(isSafeUrl("?query=1")).toBe(true);
  });

  it("allows mailto and irc protocols", () => {
    expect(isSafeUrl("mailto:user@example.com")).toBe(true);
    expect(isSafeUrl("irc://irc.example.com/channel")).toBe(true);
    expect(isSafeUrl("ircs://irc.example.com/channel")).toBe(true);
    expect(isSafeUrl("xmpp:user@example.com")).toBe(true);
  });

  it("blocks javascript: protocol", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("javascript:void(0)")).toBe(false);
  });

  it("blocks data: protocol", () => {
    expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("blocks vbscript: protocol", () => {
    expect(isSafeUrl("vbscript:MsgBox('xss')")).toBe(false);
  });

  it("allows colons in query strings and fragments", () => {
    expect(isSafeUrl("/path?time=10:30")).toBe(true);
    expect(isSafeUrl("/path#section:name")).toBe(true);
  });
});

describe("sanitizeUrl", () => {
  it("returns the URL unchanged if safe", () => {
    expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
  });

  it("returns empty string for dangerous URLs", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe("");
  });
});
