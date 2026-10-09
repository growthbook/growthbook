import {
  GrowthBook,
  GrowthBookClient,
  RedisSetClient,
  SavedGroupResolver,
  SavedGroupsPayload,
  getRemoteSavedGroups,
  redisResolver,
} from "../src";

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

  it("leaves the context unchanged when the resolver fails", async () => {
    const user = { attributes: { account_id: "a1" } };
    const resolved = await client().addRemoteSavedGroups(user, async () => {
      throw new Error("redis down");
    });
    expect(resolved).toBe(user);
  });

  it("doesn't call the resolver when the payload has no remote groups", async () => {
    const resolver = jest.fn(async () => ["grp_vip"]);
    const gb = new GrowthBookClient().initSync({ payload: { features } });
    const resolved = await gb.addRemoteSavedGroups({}, resolver);
    expect(resolver).not.toHaveBeenCalled();
    expect(resolved).toEqual({ remoteGroupIds: [] });
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

  it("skips values that can't be keys", async () => {
    const client = redis({});
    await redisResolver(client)({
      attributes: { account_id: null, user_id: { a: 1 } },
      groups,
    });
    expect(client.sMembers).not.toHaveBeenCalled();
  });
});
