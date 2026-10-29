import { normalizeInviteEmail } from "back-end/src/util/organization.util";

describe("normalizeInviteEmail", () => {
  it.each([
    ["user@example.com", "user@example.com"],
    ["User@Example.COM", "user@example.com"],
    ["  user@example.com  ", "user@example.com"],
    ["user@example.com;", "user@example.com"],
    [";, user@example.com ,;\n\t", "user@example.com"],
    ["user@example.com, ", "user@example.com"],
    ["a;b@example.com", "a;b@example.com"],
    [" ;, ", ""],
    ["", ""],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeInviteEmail(input)).toBe(expected);
  });

  it("finishes quickly on long runs of separators", () => {
    const input = "\t".repeat(200000) + "x" + ";".repeat(200000) + "y";
    const start = Date.now();
    expect(normalizeInviteEmail(input)).toBe(input.trim().toLowerCase());
    expect(Date.now() - start).toBeLessThan(500);
  });
});
