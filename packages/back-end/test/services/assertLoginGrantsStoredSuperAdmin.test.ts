import { getUserById } from "back-end/src/models/UserModel";
import { assertLoginGrantsStoredSuperAdmin } from "back-end/src/services/auth";
import { AuthRequest } from "back-end/src/types/AuthRequest";

// Not spread from requireActual: UserModel imports services/auth, so loading the
// real module here would hand the helper the real getUserById before the mock exists
jest.mock("back-end/src/models/UserModel", () => ({
  getUserById: jest.fn(),
}));

const mockedGetUserById = getUserById as jest.MockedFunction<
  typeof getUserById
>;

function reqWith(superAdmin: AuthRequest["superAdmin"], userId = "u_1") {
  return { userId, superAdmin } as AuthRequest;
}

describe("assertLoginGrantsStoredSuperAdmin", () => {
  beforeEach(() => {
    mockedGetUserById.mockReset();
  });

  it("rejects a login that was demoted while the stored user is a super admin", async () => {
    mockedGetUserById.mockResolvedValue({ superAdmin: true } as never);
    await expect(
      assertLoginGrantsStoredSuperAdmin(reqWith(false)),
    ).rejects.toThrow(/Super admins must sign in/);
  });

  it("rejects a demoted partial super admin too", async () => {
    mockedGetUserById.mockResolvedValue({ superAdmin: ["view"] } as never);
    await expect(
      assertLoginGrantsStoredSuperAdmin(reqWith(false)),
    ).rejects.toThrow();
  });

  it("allows a login that still holds super admin, without reading the user", async () => {
    await expect(
      assertLoginGrantsStoredSuperAdmin(reqWith(true)),
    ).resolves.toBeUndefined();
    await expect(
      assertLoginGrantsStoredSuperAdmin(reqWith(["view"])),
    ).resolves.toBeUndefined();
    expect(mockedGetUserById).not.toHaveBeenCalled();
  });

  it("allows ordinary users and malformed stored values", async () => {
    mockedGetUserById.mockResolvedValue({ superAdmin: false } as never);
    await expect(
      assertLoginGrantsStoredSuperAdmin(reqWith(false)),
    ).resolves.toBeUndefined();
    mockedGetUserById.mockResolvedValue({ superAdmin: [] } as never);
    await expect(
      assertLoginGrantsStoredSuperAdmin(reqWith(false)),
    ).resolves.toBeUndefined();
    mockedGetUserById.mockResolvedValue(null);
    await expect(
      assertLoginGrantsStoredSuperAdmin(reqWith(false)),
    ).resolves.toBeUndefined();
  });

  it("does nothing without a user id", async () => {
    await expect(
      assertLoginGrantsStoredSuperAdmin(reqWith(false, "")),
    ).resolves.toBeUndefined();
    expect(mockedGetUserById).not.toHaveBeenCalled();
  });
});
