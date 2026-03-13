import { describe, expect, it } from "vitest";
import type { ExpandedMember } from "shared/types/organization";
import { getDisplayNameForUser, getOwnerDisplay } from "@/services/owners";

const member: ExpandedMember = {
  id: "u_123",
  role: "admin",
  limitAccessByEnvironment: false,
  environments: [],
  email: "alice@example.com",
  name: "Alice Johnson",
  verified: true,
};

describe("owners service", () => {
  it("returns full name by default", () => {
    expect(getDisplayNameForUser(member)).toBe("Alice Johnson");
  });

  it("returns given name when format is givenName", () => {
    expect(getDisplayNameForUser(member, "givenName")).toBe("Alice");
  });

  it("does not shorten email-like names when using givenName", () => {
    const emailLikeNameMember: ExpandedMember = {
      ...member,
      name: "alice@example.com",
    };

    expect(getDisplayNameForUser(emailLikeNameMember, "givenName")).toBe(
      "alice@example.com",
    );
  });

  it("uses display format in owner display lookups", () => {
    const users = new Map<string, ExpandedMember>([[member.id, member]]);
    expect(
      getOwnerDisplay({ owner: member.id, users, format: "givenName" }),
    ).toBe("Alice");
    expect(
      getOwnerDisplay({ owner: member.id, users, format: "fullName" }),
    ).toBe("Alice Johnson");
  });
});
