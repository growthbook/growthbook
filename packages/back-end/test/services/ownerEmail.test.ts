import {
  resolveUserIdToEmail,
  buildOwnerEmailMap,
} from "back-end/src/services/ownerEmail";

jest.mock("back-end/src/models/UserModel", () => ({
  getUsersByIds: jest.fn(),
}));

import { getUsersByIds } from "back-end/src/models/UserModel";

const mockGetUsersByIds = getUsersByIds as jest.MockedFunction<
  typeof getUsersByIds
>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("resolveUserIdToEmail", () => {
  it("returns undefined for undefined input", async () => {
    const result = await resolveUserIdToEmail(undefined);
    expect(result).toBeUndefined();
    expect(mockGetUsersByIds).not.toHaveBeenCalled();
  });

  it("returns undefined for empty string", async () => {
    const result = await resolveUserIdToEmail("");
    expect(result).toBeUndefined();
    expect(mockGetUsersByIds).not.toHaveBeenCalled();
  });

  it("looks up email for u_ prefixed owner", async () => {
    mockGetUsersByIds.mockResolvedValue([
      { id: "u_abc", email: "alice@example.com" } as never,
    ]);
    const result = await resolveUserIdToEmail("u_abc");
    expect(result).toBe("alice@example.com");
    expect(mockGetUsersByIds).toHaveBeenCalledWith(["u_abc"]);
  });

  it("returns undefined when user not found for u_ prefix", async () => {
    mockGetUsersByIds.mockResolvedValue([]);
    const result = await resolveUserIdToEmail("u_missing");
    expect(result).toBeUndefined();
  });

  it("returns the email directly when owner is an email address", async () => {
    const result = await resolveUserIdToEmail("bob@example.com");
    expect(result).toBe("bob@example.com");
    expect(mockGetUsersByIds).not.toHaveBeenCalled();
  });

  it("returns undefined for non-email, non-u_ values", async () => {
    const result = await resolveUserIdToEmail("somelegacyvalue");
    expect(result).toBeUndefined();
    expect(mockGetUsersByIds).not.toHaveBeenCalled();
  });
});

describe("buildOwnerEmailMap", () => {
  it("returns an empty map for an empty array", async () => {
    const result = await buildOwnerEmailMap([]);
    expect(result.size).toBe(0);
    expect(mockGetUsersByIds).not.toHaveBeenCalled();
  });

  it("returns an empty map for an array of undefineds", async () => {
    const result = await buildOwnerEmailMap([undefined, undefined]);
    expect(result.size).toBe(0);
    expect(mockGetUsersByIds).not.toHaveBeenCalled();
  });

  it("maps u_ prefixed owners to their emails via DB lookup", async () => {
    mockGetUsersByIds.mockResolvedValue([
      { id: "u_1", email: "alice@example.com" } as never,
      { id: "u_2", email: "bob@example.com" } as never,
    ]);

    const result = await buildOwnerEmailMap(["u_1", "u_2"]);
    expect(result.get("u_1")).toBe("alice@example.com");
    expect(result.get("u_2")).toBe("bob@example.com");
    expect(mockGetUsersByIds).toHaveBeenCalledTimes(1);
    expect(mockGetUsersByIds).toHaveBeenCalledWith(["u_1", "u_2"]);
  });

  it("deduplicates u_ owners before DB lookup", async () => {
    mockGetUsersByIds.mockResolvedValue([
      { id: "u_1", email: "alice@example.com" } as never,
    ]);

    const result = await buildOwnerEmailMap(["u_1", "u_1", "u_1"]);
    expect(result.get("u_1")).toBe("alice@example.com");
    expect(mockGetUsersByIds).toHaveBeenCalledTimes(1);
    expect(mockGetUsersByIds).toHaveBeenCalledWith(["u_1"]);
  });

  it("maps email owners to themselves without a DB call", async () => {
    const result = await buildOwnerEmailMap(["alice@example.com"]);
    expect(result.get("alice@example.com")).toBe("alice@example.com");
    expect(mockGetUsersByIds).not.toHaveBeenCalled();
  });

  it("maps unknown owner values to undefined", async () => {
    const result = await buildOwnerEmailMap(["legacyname"]);
    expect(result.get("legacyname")).toBeUndefined();
    expect(mockGetUsersByIds).not.toHaveBeenCalled();
  });

  it("handles a mix of u_ owners, email owners, unknown owners, and undefineds", async () => {
    mockGetUsersByIds.mockResolvedValue([
      { id: "u_1", email: "alice@example.com" } as never,
    ]);

    const result = await buildOwnerEmailMap([
      "u_1",
      "bob@example.com",
      "legacyname",
      undefined,
    ]);

    expect(result.get("u_1")).toBe("alice@example.com");
    expect(result.get("bob@example.com")).toBe("bob@example.com");
    expect(result.get("legacyname")).toBeUndefined();
    expect(result.has("legacyname")).toBe(true);
    expect(result.size).toBe(3);
    expect(mockGetUsersByIds).toHaveBeenCalledWith(["u_1"]);
  });

  it("maps u_ owner to undefined when not found in DB", async () => {
    mockGetUsersByIds.mockResolvedValue([]);
    const result = await buildOwnerEmailMap(["u_notfound"]);
    expect(result.get("u_notfound")).toBeUndefined();
  });
});
