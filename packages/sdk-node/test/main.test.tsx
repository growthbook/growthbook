import { growthbookMiddleware } from "../src";

describe("growthbookMiddleware", () => {
  it("returns a middleware function", () => {
    const middleware = growthbookMiddleware({
      context: {},
      getAttributes: (req) => {
        return {
          method: req.method,
        };
      },
    });
    expect(middleware instanceof Function).toBe(true);
  });
});
