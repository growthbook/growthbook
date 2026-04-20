import type { UserInterface } from "shared/types/user";
import type { ReqContext } from "back-end/types/request";
import {
  buildOwnerEmailMap,
  clearOwnerEmailCache,
} from "back-end/src/services/owner";

function makeContext(users: Partial<UserInterface>[]): ReqContext {
  const getUsersByIds = jest.fn(async (ids: string[]) =>
    users.filter((u) => u.id && ids.includes(u.id)),
  );
  return { getUsersByIds } as unknown as ReqContext;
}

beforeEach(() => {
  clearOwnerEmailCache();
});

describe("buildOwnerEmailMap", () => {
  it("returns an empty map for an empty array", async () => {
    const context = makeContext([]);
    const result = await buildOwnerEmailMap([], context);
    expect(result.size).toBe(0);
    expect(context.getUsersByIds).not.toHaveBeenCalled();
  });

  it("returns an empty map for an array of undefineds", async () => {
    const context = makeContext([]);
    const result = await buildOwnerEmailMap([undefined, undefined], context);
    expect(result.size).toBe(0);
    expect(context.getUsersByIds).not.toHaveBeenCalled();
  });

  it("maps u_ prefixed owners to their emails via DB lookup", async () => {
    const context = makeContext([
      { id: "u_1", email: "alice@example.com" },
      { id: "u_2", email: "bob@example.com" },
    ]);
    const result = await buildOwnerEmailMap(["u_1", "u_2"], context);
    expect(result.get("u_1")).toBe("alice@example.com");
    expect(result.get("u_2")).toBe("bob@example.com");
    expect(context.getUsersByIds).toHaveBeenCalledTimes(1);
    expect(context.getUsersByIds).toHaveBeenCalledWith(["u_1", "u_2"]);
  });

  it("deduplicates u_ owners before DB lookup", async () => {
    const context = makeContext([{ id: "u_1", email: "alice@example.com" }]);
    const result = await buildOwnerEmailMap(["u_1", "u_1", "u_1"], context);
    expect(result.get("u_1")).toBe("alice@example.com");
    expect(context.getUsersByIds).toHaveBeenCalledTimes(1);
    expect(context.getUsersByIds).toHaveBeenCalledWith(["u_1"]);
  });

  it("maps email owners to themselves without a DB call", async () => {
    const context = makeContext([]);
    const result = await buildOwnerEmailMap(["alice@example.com"], context);
    expect(result.get("alice@example.com")).toBe("alice@example.com");
    expect(context.getUsersByIds).not.toHaveBeenCalled();
  });

  it("maps unknown owner values to undefined", async () => {
    const context = makeContext([]);
    const result = await buildOwnerEmailMap(["legacyname"], context);
    expect(result.get("legacyname")).toBeUndefined();
    expect(context.getUsersByIds).not.toHaveBeenCalled();
  });

  it("handles a mix of u_ owners, email owners, unknown owners, and undefineds", async () => {
    const context = makeContext([{ id: "u_1", email: "alice@example.com" }]);
    const result = await buildOwnerEmailMap(
      ["u_1", "bob@example.com", "legacyname", undefined],
      context,
    );

    expect(result.get("u_1")).toBe("alice@example.com");
    expect(result.get("bob@example.com")).toBe("bob@example.com");
    expect(result.get("legacyname")).toBeUndefined();
    expect(result.has("legacyname")).toBe(true);
    expect(result.size).toBe(3);
    expect(context.getUsersByIds).toHaveBeenCalledWith(["u_1"]);
  });

  it("maps u_ owner to undefined when not found in DB", async () => {
    const context = makeContext([]);
    const result = await buildOwnerEmailMap(["u_notfound"], context);
    expect(result.get("u_notfound")).toBeUndefined();
  });

  it("serves cached emails on subsequent calls without hitting the DB", async () => {
    const context = makeContext([{ id: "u_1", email: "alice@example.com" }]);

    const first = await buildOwnerEmailMap(["u_1"], context);
    expect(first.get("u_1")).toBe("alice@example.com");
    expect(context.getUsersByIds).toHaveBeenCalledTimes(1);

    const second = await buildOwnerEmailMap(["u_1"], context);
    expect(second.get("u_1")).toBe("alice@example.com");
    expect(context.getUsersByIds).toHaveBeenCalledTimes(1);
  });

  it("only fetches cache misses when some entries are already cached", async () => {
    const context = makeContext([
      { id: "u_1", email: "alice@example.com" },
      { id: "u_2", email: "bob@example.com" },
    ]);

    await buildOwnerEmailMap(["u_1"], context);
    expect(context.getUsersByIds).toHaveBeenLastCalledWith(["u_1"]);

    const result = await buildOwnerEmailMap(["u_1", "u_2"], context);
    expect(result.get("u_1")).toBe("alice@example.com");
    expect(result.get("u_2")).toBe("bob@example.com");
    expect(context.getUsersByIds).toHaveBeenLastCalledWith(["u_2"]);
    expect(context.getUsersByIds).toHaveBeenCalledTimes(2);
  });

  it("does not negatively cache unknown userIds", async () => {
    const context = makeContext([]);

    await buildOwnerEmailMap(["u_missing"], context);
    await buildOwnerEmailMap(["u_missing"], context);
    expect(context.getUsersByIds).toHaveBeenCalledTimes(2);
  });
});
