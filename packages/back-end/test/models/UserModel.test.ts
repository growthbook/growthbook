import { getUserByEmail } from "back-end/src/models/UserModel";
import { getCollection } from "back-end/src/util/mongo.util";

jest.mock("back-end/src/util/mongo.util", () => ({
  getCollection: jest.fn(),
  removeMongooseFields: jest.fn((doc) => doc),
}));

function mockFindOne(results: unknown[]): jest.Mock {
  const findOne = jest.fn();
  results.forEach((r) => findOne.mockResolvedValueOnce(r));
  (getCollection as jest.Mock).mockReturnValue({ findOne });
  return findOne;
}

describe("getUserByEmail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the exact-case match without falling back", async () => {
    const exactDoc = { id: "u_1", email: "User@Example.com" };
    const findOne = mockFindOne([exactDoc]);

    const result = await getUserByEmail("User@Example.com");

    expect(result?.email).toBe("User@Example.com");
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith({ email: "User@Example.com" });
  });

  it("retries with the lowercased email when the input had uppercase and exact missed", async () => {
    const lowerDoc = { id: "u_2", email: "user@example.com" };
    const findOne = mockFindOne([null, lowerDoc]);

    const result = await getUserByEmail("User@Example.com");

    expect(result?.email).toBe("user@example.com");
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(findOne).toHaveBeenNthCalledWith(2, { email: "user@example.com" });
  });

  it("does not retry when the input is already lowercase", async () => {
    const findOne = mockFindOne([null]);

    const result = await getUserByEmail("user@example.com");

    expect(result).toBeNull();
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it("returns null when neither lookup matches", async () => {
    const findOne = mockFindOne([null, null]);

    const result = await getUserByEmail("Nobody@Example.com");

    expect(result).toBeNull();
    expect(findOne).toHaveBeenCalledTimes(2);
  });
});
