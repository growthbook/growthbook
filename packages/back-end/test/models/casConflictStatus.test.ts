import { CasConflictError } from "back-end/src/models/BaseModel";

/**
 * A lost compare-and-swap race reaches API callers as 409, not 400.
 *
 * Both error boundaries read `e.status || 400`, so an error class without a status
 * tells clients their request was malformed and must not be retried — for an
 * interleaving a plain retry usually clears.
 */
describe("CasConflictError", () => {
  it("carries a 409 for the error boundaries to read", () => {
    expect(new CasConflictError().status).toBe(409);
  });

  // The boundaries append to `.message` on the way out; that must not turn the error
  // into a plain Error and lose the status with it.
  it("keeps its status when a caller appends to the message", () => {
    const e = new CasConflictError();
    e.message += " (could not be rolled back)";
    expect(e).toBeInstanceOf(CasConflictError);
    expect(e.status).toBe(409);
  });

  it("says the request can be retried", () => {
    expect(new CasConflictError().message).toMatch(/retry/i);
  });
});
