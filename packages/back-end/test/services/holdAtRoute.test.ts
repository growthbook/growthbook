import { holdAtRoute } from "back-end/src/services/confirmations";
import type { ReqContext } from "back-end/types/request";

// With no live request to hold, a matching rule refuses instead, so a rejection
// means the request would have been held.
const context = {
  isApiRequest: true,
  apiKeyData: { confirmRules: [{ actions: ["override.*"] }] },
  models: {},
} as unknown as ReqContext;
const hold = (req: { query?: unknown; body?: unknown }) =>
  holdAtRoute(context, [], "post", "/features/:id", req);

describe("holdAtRoute", () => {
  it("holds a skip asked for in either the query or the body", async () => {
    await expect(
      hold({ query: { skipHooks: "yes" }, body: { skipHooks: false } }),
    ).rejects.toThrow("only a direct API request");
    await expect(
      hold({ body: { skipSchemaValidation: true } }),
    ).rejects.toThrow("only a direct API request");
    await expect(hold({ query: { skipHooks: "no" } })).resolves.toBeUndefined();
  });
});
