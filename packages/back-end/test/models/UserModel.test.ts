import { getUserByEmail } from "back-end/src/models/UserModel";
import { getCollection } from "back-end/src/util/mongo.util";

jest.mock("back-end/src/util/mongo.util", () => ({
  getCollection: jest.fn(),
  removeMongooseFields: jest.fn((doc) => doc),
}));

type MockColl = {
  findOne: jest.Mock;
  updateOne: jest.Mock;
};

function mockCollection(findOneResults: unknown[]): MockColl {
  const findOne = jest.fn();
  findOneResults.forEach((r) => findOne.mockResolvedValueOnce(r));
  const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
  const coll: MockColl = { findOne, updateOne };
  (getCollection as jest.Mock).mockReturnValue(coll);
  return coll;
}

describe("getUserByEmail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the exact-case match without falling back", async () => {
    const exactDoc = {
      id: "u_1",
      email: "User@Example.com",
      emailLower: "user@example.com",
    };
    const coll = mockCollection([exactDoc]);

    const result = await getUserByEmail("User@Example.com");

    expect(result?.email).toBe("User@Example.com");
    expect(coll.findOne).toHaveBeenCalledTimes(1);
    expect(coll.findOne).toHaveBeenCalledWith({ email: "User@Example.com" });
    expect(coll.updateOne).not.toHaveBeenCalled();
  });

  it("falls back to the indexed emailLower lookup when exact misses", async () => {
    const lowerDoc = {
      id: "u_2",
      email: "User@Example.com",
      emailLower: "user@example.com",
    };
    const coll = mockCollection([null, lowerDoc]);

    const result = await getUserByEmail("user@example.com");

    expect(result?.email).toBe("User@Example.com");
    expect(coll.findOne).toHaveBeenCalledTimes(2);
    expect(coll.findOne).toHaveBeenNthCalledWith(2, {
      emailLower: "user@example.com",
    });
    // emailLower already present, no backfill needed
    expect(coll.updateOne).not.toHaveBeenCalled();
  });

  it("falls back to regex scan only when both indexed lookups miss, and backfills emailLower", async () => {
    const legacyDoc = {
      _id: "mongoid_3",
      id: "u_3",
      email: "User@Example.com",
      dateCreated: new Date(),
      // No emailLower — this is a pre-fix legacy row
    };
    const coll = mockCollection([null, null, legacyDoc]);

    const result = await getUserByEmail("user@example.com");

    expect(result?.email).toBe("User@Example.com");
    expect(coll.findOne).toHaveBeenCalledTimes(3);
    expect(coll.findOne).toHaveBeenNthCalledWith(3, {
      email: { $regex: "^user@example\\.com$", $options: "i" },
    });
    // Backfill so the next lookup goes through path 2 (indexed)
    expect(coll.updateOne).toHaveBeenCalledTimes(1);
    expect(coll.updateOne).toHaveBeenCalledWith(
      { _id: "mongoid_3" },
      { $set: { emailLower: "user@example.com" } },
    );
  });

  it("escapes regex metacharacters in the legacy fallback", async () => {
    const coll = mockCollection([null, null, null]);

    await getUserByEmail("a.b+c@x.com");

    expect(coll.findOne).toHaveBeenNthCalledWith(3, {
      email: { $regex: "^a\\.b\\+c@x\\.com$", $options: "i" },
    });
  });

  it("returns null when none of the three lookups match", async () => {
    const coll = mockCollection([null, null, null]);

    const result = await getUserByEmail("nobody@example.com");

    expect(result).toBeNull();
    expect(coll.findOne).toHaveBeenCalledTimes(3);
    expect(coll.updateOne).not.toHaveBeenCalled();
  });
});
