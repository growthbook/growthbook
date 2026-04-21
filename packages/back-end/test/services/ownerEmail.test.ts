import type { UserInterface } from "shared/types/user";
import type { ReqContext } from "back-end/types/request";
import {
  buildOwnerEmailMap,
  clearOwnerEmailCache,
  resolveOwnerEmail,
  resolveOwnerEmails,
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

describe("resolveOwnerEmail", () => {
  it("returns the doc unchanged when it has no owner field", async () => {
    const context = makeContext([]);
    const doc = { id: "x_1", name: "no owner" };
    const result = await resolveOwnerEmail(doc, context);
    expect(result).toBe(doc);
    expect(context.getUsersByIds).not.toHaveBeenCalled();
  });

  it("returns the doc unchanged when owner is not a string", async () => {
    const context = makeContext([]);
    const doc = { id: "x_1", owner: null };
    const result = await resolveOwnerEmail(doc, context);
    expect(result).toBe(doc);
    expect(context.getUsersByIds).not.toHaveBeenCalled();
  });

  it("attaches ownerEmail when owner is a userId resolvable via DB", async () => {
    const context = makeContext([{ id: "u_1", email: "alice@example.com" }]);
    const result = await resolveOwnerEmail(
      { id: "x_1", owner: "u_1" },
      context,
    );
    expect(result).toEqual({
      id: "x_1",
      owner: "u_1",
      ownerEmail: "alice@example.com",
    });
  });

  it("attaches ownerEmail equal to the owner value when owner is an email", async () => {
    const context = makeContext([]);
    const result = await resolveOwnerEmail(
      { id: "x_1", owner: "alice@example.com" },
      context,
    );
    expect(result).toEqual({
      id: "x_1",
      owner: "alice@example.com",
      ownerEmail: "alice@example.com",
    });
    expect(context.getUsersByIds).not.toHaveBeenCalled();
  });

  it("leaves ownerEmail absent when owner is a legacy display name", async () => {
    const context = makeContext([]);
    const result = await resolveOwnerEmail(
      { id: "x_1", owner: "legacyname" },
      context,
    );
    expect(result).toEqual({ id: "x_1", owner: "legacyname" });
    expect("ownerEmail" in result).toBe(false);
  });

  it("leaves ownerEmail absent when owner is a userId not found in DB", async () => {
    const context = makeContext([]);
    const result = await resolveOwnerEmail(
      { id: "x_1", owner: "u_missing" },
      context,
    );
    expect(result).toEqual({ id: "x_1", owner: "u_missing" });
    expect("ownerEmail" in result).toBe(false);
  });
});

describe("resolveOwnerEmails", () => {
  it("returns the input array unchanged when empty", async () => {
    const context = makeContext([]);
    const input: { owner: string }[] = [];
    const result = await resolveOwnerEmails(input, context);
    expect(result).toBe(input);
    expect(context.getUsersByIds).not.toHaveBeenCalled();
  });

  it("resolves owner emails for a mix of owner shapes in a single DB call", async () => {
    const context = makeContext([
      { id: "u_1", email: "alice@example.com" },
      { id: "u_2", email: "bob@example.com" },
    ]);
    const docs = [
      { id: "x_1", owner: "u_1" },
      { id: "x_2", owner: "u_2" },
      { id: "x_3", owner: "u_1" },
      { id: "x_4", owner: "carol@example.com" },
      { id: "x_5", owner: "legacyname" },
      { id: "x_6", name: "no owner field" },
    ];

    const result = await resolveOwnerEmails(docs, context);

    expect(result).toEqual([
      { id: "x_1", owner: "u_1", ownerEmail: "alice@example.com" },
      { id: "x_2", owner: "u_2", ownerEmail: "bob@example.com" },
      { id: "x_3", owner: "u_1", ownerEmail: "alice@example.com" },
      {
        id: "x_4",
        owner: "carol@example.com",
        ownerEmail: "carol@example.com",
      },
      { id: "x_5", owner: "legacyname" },
      { id: "x_6", name: "no owner field" },
    ]);
    expect(context.getUsersByIds).toHaveBeenCalledTimes(1);
    expect(context.getUsersByIds).toHaveBeenCalledWith(["u_1", "u_2"]);
  });

  it("does not mutate input docs", async () => {
    const context = makeContext([{ id: "u_1", email: "alice@example.com" }]);
    const docs = [{ id: "x_1", owner: "u_1" }];
    const result = await resolveOwnerEmails(docs, context);
    expect(docs[0]).toEqual({ id: "x_1", owner: "u_1" });
    expect(result[0]).not.toBe(docs[0]);
  });
});
