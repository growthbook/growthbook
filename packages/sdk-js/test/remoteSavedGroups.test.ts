import {
  GrowthBook,
  GrowthBookClient,
  RedisSetClient,
  SavedGroupResolver,
  SavedGroupsPayload,
  getRemoteSavedGroups,
  redisResolver,
} from "../src";
import { pruneCondition } from "../src/mongrule";

const savedGroups: SavedGroupsPayload = {
  grp_vip: { type: "remote", attributeKey: "account_id" },
  grp_beta: { type: "remote", attributeKey: "user_id" },
  grp_list: { type: "list", attributeKey: "id", values: ["u_1"] },
};

const features = {
  vip: {
    defaultValue: false,
    rules: [{ condition: { $savedGroup: { id: "grp_vip" } }, force: true }],
  },
};

describe("getRemoteSavedGroups", () => {
  it("lists the payload's remote groups", () => {
    expect(getRemoteSavedGroups(savedGroups)).toEqual([
      { id: "grp_vip", attributeKey: "account_id" },
      { id: "grp_beta", attributeKey: "user_id" },
    ]);
    expect(getRemoteSavedGroups({ grp_v1: ["a"] })).toEqual([]);
    expect(
      getRemoteSavedGroups({
        "grp_vip:parent_id": {
          type: "remote",
          attributeKey: "parent_id",
          valuesFrom: "grp_vip",
        },
      }),
    ).toEqual([
      {
        id: "grp_vip:parent_id",
        attributeKey: "parent_id",
        valuesFrom: "grp_vip",
      },
    ]);
  });

  it("returns the same empty list when there are no saved groups", () => {
    expect(getRemoteSavedGroups()).toEqual([]);
    expect(getRemoteSavedGroups()).toBe(getRemoteSavedGroups(undefined));
  });
});

describe("GrowthBookClient.addRemoteSavedGroups", () => {
  const client = () =>
    new GrowthBookClient({ globalAttributes: { user_id: "u_42" } }).initSync({
      payload: { features, savedGroups },
    });

  it("passes only the attributes remote groups use, and sets remoteGroupIds", async () => {
    const resolver = jest.fn<
      ReturnType<SavedGroupResolver>,
      Parameters<SavedGroupResolver>
    >(async () => ["grp_vip"]);
    const gb = client();
    const user = { attributes: { account_id: "a1", email: "x@y.z" } };

    const resolved = await gb.addRemoteSavedGroups(user, resolver);

    expect(resolver).toHaveBeenCalledWith({
      attributes: { account_id: "a1", user_id: "u_42" },
      groups: getRemoteSavedGroups(savedGroups),
    });
    expect(resolved).toEqual({ ...user, remoteGroupIds: ["grp_vip"] });
    expect(gb.isOn("vip", resolved)).toBe(true);
    expect(gb.isOn("vip", user)).toBe(false);
  });

  it("reads dot-separated attribute keys from nested attributes", async () => {
    const resolver = jest.fn<
      ReturnType<SavedGroupResolver>,
      Parameters<SavedGroupResolver>
    >(async () => []);
    const gb = new GrowthBookClient().initSync({
      payload: {
        features,
        savedGroups: {
          grp_email: { type: "remote", attributeKey: "user.email" },
        },
      },
    });
    await gb.addRemoteSavedGroups(
      { attributes: { user: { email: "a@b.c" } } },
      resolver,
    );
    expect(resolver.mock.calls[0][0].attributes).toEqual({
      "user.email": "a@b.c",
    });
  });

  it("looks up again when the payload changes during the lookup", async () => {
    const gb = client();
    const withNew: SavedGroupsPayload = {
      ...savedGroups,
      grp_new: { type: "remote", attributeKey: "user_id" },
    };
    const resolver = jest.fn<
      ReturnType<SavedGroupResolver>,
      Parameters<SavedGroupResolver>
    >(async ({ groups }) => {
      // A refresh lands while the first lookup is waiting
      if (resolver.mock.calls.length === 1) {
        await gb.setPayload({ features, savedGroups: withNew });
      }
      return groups.some((g) => g.id === "grp_new") ? ["grp_new"] : [];
    });

    const resolved = await gb.addRemoteSavedGroups(
      { attributes: {} },
      resolver,
    );

    expect(resolver).toHaveBeenCalledTimes(2);
    expect(resolver.mock.calls[1][0].groups).toEqual(
      getRemoteSavedGroups(withNew),
    );
    expect(resolved.remoteGroupIds).toEqual(["grp_new"]);
  });

  it("leaves the context unchanged when the resolver fails", async () => {
    const user = { attributes: { account_id: "a1" } };
    const resolved = await client().addRemoteSavedGroups(user, async () => {
      throw new Error("redis down");
    });
    expect(resolved).toBe(user);
  });

  it("leaves remoteGroupIds unset when the payload has no remote groups", async () => {
    // Payloads for SDKs without remote support check __gb_remoteGroupIds
    // directly, with no remote entries.
    const notInVip = {
      "not-vip": {
        defaultValue: false,
        rules: [
          {
            condition: {
              __gb_remoteGroupIds: { $nin: ["grp_vip"], $exists: true },
            },
            force: true,
          },
        ],
      },
    };
    const resolver = jest.fn(async () => ["grp_vip"]);
    const gb = new GrowthBookClient().initSync({
      payload: { features: notInVip },
    });
    const user = { attributes: { account_id: "a1" } };

    const resolved = await gb.addRemoteSavedGroups(user, resolver);

    expect(resolver).not.toHaveBeenCalled();
    expect(resolved).toBe(user);
    // Unresolved, so the "not in group" rule fails closed
    expect(gb.isOn("not-vip", resolved)).toBe(false);
  });
});

describe("GrowthBook.setRemoteGroupIds", () => {
  it("re-evaluates with the user's remote groups", () => {
    const gb = new GrowthBook({
      attributes: { account_id: "a1" },
      features,
      savedGroups,
    });
    expect(gb.isOn("vip")).toBe(false);
    gb.setRemoteGroupIds(["grp_vip"]);
    expect(gb.isOn("vip")).toBe(true);
    gb.destroy();
  });

  it("includes them in the attributes sent for remote evaluation", () => {
    const gb = new GrowthBook({ attributes: { account_id: "a1" } });
    gb.setRemoteGroupIds(["grp_vip"]);
    expect(gb.getAttributes()).toEqual({
      account_id: "a1",
      __gb_remoteGroupIds: ["grp_vip"],
    });
    gb.destroy();
  });
});

describe("redisResolver", () => {
  const redis = (members: Record<string, string[]>) => {
    const client: RedisSetClient = {
      sMembers: jest.fn(async (key: string) => members[key] ?? []),
    };
    return client;
  };
  const groups = [
    { id: "grp_vip", attributeKey: "account_id" },
    { id: "grp_beta", attributeKey: "user_id" },
  ];

  it("looks up each attribute value and returns the groups found", async () => {
    const client = redis({
      "gb:member:account_id:a1": ["grp_vip", "grp_other"],
      "gb:member:user_id:42": ["grp_beta"],
    });
    const ids = await redisResolver(client)({
      attributes: { account_id: "a1", user_id: 42 },
      groups,
    });
    expect(ids).toEqual(["grp_vip", "grp_beta"]);
  });

  it("looks up each item of an array, and dedupes", async () => {
    const client = redis({
      "gb:member:account_id:a1": ["grp_vip"],
      "gb:member:account_id:a2": ["grp_vip"],
    });
    const ids = await redisResolver(client)({
      attributes: { account_id: ["a1", "a2"] },
      groups,
    });
    expect(ids).toEqual(["grp_vip"]);
    expect(client.sMembers).toHaveBeenCalledTimes(2);
  });

  it("only returns groups on the attribute that was looked up", async () => {
    // `a:b` + `c` and `a` + `b:c` share a key.
    const client = redis({ "gb:member:a:b:c": ["grp_ab", "grp_a"] });
    const ids = await redisResolver(client)({
      attributes: { a: "b:c" },
      groups: [
        { id: "grp_ab", attributeKey: "a:b" },
        { id: "grp_a", attributeKey: "a" },
      ],
    });
    expect(ids).toEqual(["grp_a"]);
  });

  it("checks a derived group's attribute in its source group's sets", async () => {
    const client = redis({
      "gb:member:account_id:a9": ["grp_vip"],
      "gb:member:account_id:a1": [],
    });
    const ids = await redisResolver(client)({
      attributes: { account_id: "a1", parent_id: "a9" },
      groups: [
        { id: "grp_vip", attributeKey: "account_id" },
        {
          id: "grp_vip:parent_id",
          attributeKey: "parent_id",
          valuesFrom: "grp_vip",
        },
      ],
    });
    expect(ids).toEqual(["grp_vip:parent_id"]);
    // One lookup per key, even when groups share it
    expect(client.sMembers).toHaveBeenCalledTimes(2);
  });

  it("skips a derived group whose source group isn't listed", async () => {
    const client = redis({ "gb:member:parent_id:a9": ["grp_vip"] });
    const ids = await redisResolver(client)({
      attributes: { parent_id: "a9" },
      groups: [
        {
          id: "grp_vip:parent_id",
          attributeKey: "parent_id",
          valuesFrom: "grp_vip",
        },
      ],
    });
    expect(ids).toEqual([]);
    expect(client.sMembers).not.toHaveBeenCalled();
  });

  it("skips values that can't be keys", async () => {
    const client = redis({});
    await redisResolver(client)({
      attributes: { account_id: null, user_id: { a: 1 } },
      groups,
    });
    expect(client.sMembers).not.toHaveBeenCalled();
  });
});

describe("pruneCondition with remote groups", () => {
  const condition = { $savedGroup: { id: "grp_vip" }, country: "US" };

  it("keeps a remote group reference when the user's remote groups are unknown", () => {
    expect(pruneCondition({ country: "US" }, condition, savedGroups)).toEqual({
      $savedGroup: { id: "grp_vip" },
    });
  });

  it("decides a remote group reference when the user's remote groups are known", () => {
    expect(
      pruneCondition(
        { country: "US", __gb_remoteGroupIds: ["grp_vip"] },
        condition,
        savedGroups,
      ),
    ).toBe(true);
    expect(
      pruneCondition(
        { country: "US", __gb_remoteGroupIds: [] },
        condition,
        savedGroups,
      ),
    ).toBe(false);
  });
});
