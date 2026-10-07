import { apiKeyToggleRequiresAdmin } from "../../src/permissions/apiKeyAuthority";

describe("apiKeyToggleRequiresAdmin", () => {
  it("never requires admin for org keys", () => {
    expect(
      apiKeyToggleRequiresAdmin(
        { userId: undefined, disabled: true, disabledBy: "u_admin" },
        "u_1",
      ),
    ).toBe(false);
  });

  it("requires admin to toggle another member's PAT", () => {
    expect(
      apiKeyToggleRequiresAdmin({ userId: "u_owner", disabled: false }, "u_1"),
    ).toBe(true);
  });

  it("lets the owner toggle their own PAT", () => {
    expect(
      apiKeyToggleRequiresAdmin({ userId: "u_1", disabled: false }, "u_1"),
    ).toBe(false);
    expect(
      apiKeyToggleRequiresAdmin(
        { userId: "u_1", disabled: true, disabledBy: "u_1" },
        "u_1",
      ),
    ).toBe(false);
  });

  it("treats a disable with no recorded disabler as the owner's", () => {
    expect(
      apiKeyToggleRequiresAdmin(
        { userId: "u_1", disabled: true, disabledBy: null },
        "u_1",
      ),
    ).toBe(false);
  });

  it("locks the owner out of a PAT an admin disabled", () => {
    expect(
      apiKeyToggleRequiresAdmin(
        { userId: "u_1", disabled: true, disabledBy: "u_admin" },
        "u_1",
      ),
    ).toBe(true);
  });

  it("ignores a stale disabledBy once the PAT is enabled", () => {
    expect(
      apiKeyToggleRequiresAdmin(
        { userId: "u_1", disabled: false, disabledBy: "u_admin" },
        "u_1",
      ),
    ).toBe(false);
  });
});
