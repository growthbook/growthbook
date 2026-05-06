import { getUserByEmail } from "back-end/src/models/UserModel";
import { getCollection } from "back-end/src/util/mongo.util";

jest.mock("back-end/src/util/mongo.util", () => ({
  getCollection: jest.fn(),
  removeMongooseFields: jest.fn((doc) => doc),
}));

describe("getUserByEmail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the exact-case match without falling back", async () => {
    const exactDoc = { id: "u_1", email: "User@Example.com", name: "Mixed" };
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(exactDoc)
      .mockResolvedValueOnce(null);

    (getCollection as jest.Mock).mockReturnValue({ findOne });

    const result = await getUserByEmail("User@Example.com");

    expect(result?.email).toBe("User@Example.com");
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith({ email: "User@Example.com" });
  });

  it("falls back to a case-insensitive match when the exact lookup misses", async () => {
    const ciDoc = { id: "u_2", email: "user@example.com", name: "Lower" };
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ciDoc);

    (getCollection as jest.Mock).mockReturnValue({ findOne });

    const result = await getUserByEmail("User@Example.com");

    expect(result?.email).toBe("user@example.com");
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(findOne).toHaveBeenNthCalledWith(2, {
      email: { $regex: "^User@Example\\.com$", $options: "i" },
    });
  });

  it("falls back even when the input email is already lowercase", async () => {
    // Catches the gap where a pre-existing mixed-case account would otherwise
    // get a new lowercase duplicate created.
    const ciDoc = { id: "u_3", email: "User@Example.com", name: "Mixed" };
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ciDoc);

    (getCollection as jest.Mock).mockReturnValue({ findOne });

    const result = await getUserByEmail("user@example.com");

    expect(result?.email).toBe("User@Example.com");
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it("escapes regex metacharacters in the fallback query", async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    (getCollection as jest.Mock).mockReturnValue({ findOne });

    await getUserByEmail("a.b+c@x.com");

    expect(findOne).toHaveBeenNthCalledWith(2, {
      email: { $regex: "^a\\.b\\+c@x\\.com$", $options: "i" },
    });
  });

  it("returns null when neither lookup matches", async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    (getCollection as jest.Mock).mockReturnValue({ findOne });

    const result = await getUserByEmail("nobody@example.com");

    expect(result).toBeNull();
    expect(findOne).toHaveBeenCalledTimes(2);
  });
});
