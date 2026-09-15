import type { UserInterface } from "shared/types/user";
import type { ReqContext } from "back-end/types/request";
import {
  clearOwnerEmailCache,
  resolveOwnerEmail,
  resolveOwnerEmails,
  resolveOwnerForCreate,
} from "back-end/src/services/owner";

function makeContext(users: Partial<UserInterface>[]): ReqContext {
  const getUsersByIds = jest.fn(async (ids: string[]) =>
    users.filter((u) => u.id && ids.includes(u.id)),
  );
  return { getUsersByIds } as unknown as ReqContext;
}

function makeOwnerContext({
  members = [],
  userId = "",
}: {
  members?: Partial<UserInterface>[];
  userId?: string;
}): ReqContext {
  const getUserByEmail = jest.fn(async (email: string) =>
    members.find((m) => m.email === email),
  );
  return {
    userId,
    org: { members: members.map((m) => ({ id: m.id })) },
    getUserByEmail,
  } as unknown as ReqContext;
}

beforeEach(() => {
  clearOwnerEmailCache();
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

  it("resolves a u_ prefixed owner to an email via DB lookup", async () => {
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
    expect(context.getUsersByIds).toHaveBeenCalledWith(["u_1"]);
  });

  it("uses an email owner value as the resolved ownerEmail without a DB call", async () => {
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
    expect(context.getUsersByIds).not.toHaveBeenCalled();
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

  it("serves cached emails on subsequent calls without hitting the DB", async () => {
    const context = makeContext([{ id: "u_1", email: "alice@example.com" }]);

    const first = await resolveOwnerEmail({ owner: "u_1" }, context);
    expect(first).toEqual({ owner: "u_1", ownerEmail: "alice@example.com" });

    const second = await resolveOwnerEmail({ owner: "u_1" }, context);
    expect(second).toEqual({ owner: "u_1", ownerEmail: "alice@example.com" });

    expect(context.getUsersByIds).toHaveBeenCalledTimes(1);
  });

  it("does not negatively cache unknown userIds", async () => {
    const context = makeContext([]);

    await resolveOwnerEmail({ owner: "u_missing" }, context);
    await resolveOwnerEmail({ owner: "u_missing" }, context);
    expect(context.getUsersByIds).toHaveBeenCalledTimes(2);
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

  it("skips the DB when no doc has a string owner", async () => {
    const context = makeContext([]);
    const docs = [{ id: "x_1" }, { id: "x_2", owner: null }];
    const result = await resolveOwnerEmails(docs, context);
    expect(result).toEqual(docs);
    expect(context.getUsersByIds).not.toHaveBeenCalled();
  });

  it("deduplicates u_ owners before the DB lookup", async () => {
    const context = makeContext([{ id: "u_1", email: "alice@example.com" }]);
    const result = await resolveOwnerEmails(
      [
        { id: "x_1", owner: "u_1" },
        { id: "x_2", owner: "u_1" },
        { id: "x_3", owner: "u_1" },
      ],
      context,
    );
    expect(result.every((d) => d.ownerEmail === "alice@example.com")).toBe(
      true,
    );
    expect(context.getUsersByIds).toHaveBeenCalledTimes(1);
    expect(context.getUsersByIds).toHaveBeenCalledWith(["u_1"]);
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

  it("only fetches cache misses when some entries are already cached", async () => {
    const context = makeContext([
      { id: "u_1", email: "alice@example.com" },
      { id: "u_2", email: "bob@example.com" },
    ]);

    await resolveOwnerEmails([{ owner: "u_1" }], context);
    expect(context.getUsersByIds).toHaveBeenLastCalledWith(["u_1"]);

    const result = await resolveOwnerEmails(
      [{ owner: "u_1" }, { owner: "u_2" }],
      context,
    );
    expect(result).toEqual([
      { owner: "u_1", ownerEmail: "alice@example.com" },
      { owner: "u_2", ownerEmail: "bob@example.com" },
    ]);
    expect(context.getUsersByIds).toHaveBeenLastCalledWith(["u_2"]);
    expect(context.getUsersByIds).toHaveBeenCalledTimes(2);
  });

  it("does not mutate input docs", async () => {
    const context = makeContext([{ id: "u_1", email: "alice@example.com" }]);
    const docs = [{ id: "x_1", owner: "u_1" }];
    const result = await resolveOwnerEmails(docs, context);
    expect(docs[0]).toEqual({ id: "x_1", owner: "u_1" });
    expect(result[0]).not.toBe(docs[0]);
  });
});

describe("resolveOwnerForCreate", () => {
  it("resolves an explicit u_ owner that is a valid org member", async () => {
    const context = makeOwnerContext({
      members: [{ id: "u_1", email: "alice@example.com" }],
      userId: "u_2",
    });
    expect(await resolveOwnerForCreate("u_1", context)).toBe("u_1");
  });

  it("resolves an email owner to the matching member's userId", async () => {
    const context = makeOwnerContext({
      members: [{ id: "u_1", email: "alice@example.com" }],
      userId: "",
    });
    expect(await resolveOwnerForCreate("alice@example.com", context)).toBe(
      "u_1",
    );
  });

  it("falls back to the authenticated user (PAT) when no owner is provided", async () => {
    const context = makeOwnerContext({ members: [], userId: "u_pat" });
    expect(await resolveOwnerForCreate(undefined, context)).toBe("u_pat");
    expect(await resolveOwnerForCreate("", context)).toBe("u_pat");
  });

  it("throws when no owner is provided and there is no userId (org API key)", async () => {
    const context = makeOwnerContext({ members: [], userId: "" });
    await expect(resolveOwnerForCreate(undefined, context)).rejects.toThrow(
      /Personal Access Token/,
    );
  });

  it("returns an unresolvable owner unchanged in non-strict mode", async () => {
    const context = makeOwnerContext({ members: [], userId: "" });
    expect(await resolveOwnerForCreate("legacyname", context)).toBe(
      "legacyname",
    );
  });

  it("throws on an unresolvable owner email in strict mode", async () => {
    const context = makeOwnerContext({ members: [], userId: "u_pat" });
    await expect(
      resolveOwnerForCreate("missing@example.com", context, { strict: true }),
    ).rejects.toThrow(/Unable to find user/);
  });
});
