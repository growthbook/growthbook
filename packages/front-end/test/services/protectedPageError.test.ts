import {
  getProtectedPageErrorState,
  type ProtectedPageErrorState,
} from "@/services/protectedPageError";

describe("protected page error state", () => {
  it("returns sign_in_error for non-network errors", () => {
    const state = getProtectedPageErrorState({
      error: "Organization not found",
      ready: true,
    });

    expect(state).toBe<ProtectedPageErrorState>("sign_in_error");
  });

  it("returns startup_network_error for startup network errors", () => {
    const state = getProtectedPageErrorState({
      error: "failed to fetch",
      ready: false,
    });

    expect(state).toBe<ProtectedPageErrorState>("startup_network_error");
  });

  it("returns connection_error for persistent network errors", () => {
    const state = getProtectedPageErrorState({
      error: "failed to fetch",
      ready: true,
    });

    expect(state).toBe<ProtectedPageErrorState>("connection_error");
  });

  it("returns none when no error exists", () => {
    const state = getProtectedPageErrorState({
      error: "",
      ready: true,
    });

    expect(state).toBe<ProtectedPageErrorState>("none");
  });
});
