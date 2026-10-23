import {
  ExpressCookieStickyBucketService,
  StickyAssignmentsDocument,
} from "../src";

// Express's res.cookie() encodes the value itself (its `encode` option defaults to
// encodeURIComponent), and cookie-parser decodes cookie values but not names.
// https://expressjs.com/en/4x/api.html#res.cookie
describe("ExpressCookieStickyBucketService", () => {
  const doc: StickyAssignmentsDocument = {
    attributeName: "id",
    attributeValue: "user-1",
    assignments: { exp__0: "1" },
  };
  const encodedName = encodeURIComponent("gbStickyBuckets__id||user-1");
  const service = (cookies: Record<string, string>, written: string[][] = []) =>
    new ExpressCookieStickyBucketService({
      req: { cookies },
      res: {
        cookie(name: string, value: string) {
          written.push([name, value]);
          return this;
        },
      },
    });

  it("leaves encoding the cookie value to res.cookie()", () => {
    const written: string[][] = [];
    service({}, written).saveAssignmentsSync(doc);
    expect(written).toEqual([[encodedName, JSON.stringify(doc)]]);
  });

  it("reads back the cookie it writes, as cookie-parser hands it over", () => {
    expect(
      service({ [encodedName]: JSON.stringify(doc) }).getAssignmentsSync(
        "id",
        "user-1",
      ),
    ).toEqual(doc);
  });

  it("reads a cookie written by BrowserCookieStickyBucketService", () => {
    expect(
      service({
        "gbStickyBuckets__id||user-1": JSON.stringify(doc),
      }).getAssignmentsSync("id", "user-1"),
    ).toEqual(doc);
  });

  it("reads a cookie written by earlier versions (value encoded twice)", () => {
    expect(
      service({
        [encodedName]: encodeURIComponent(JSON.stringify(doc)),
      }).getAssignmentsSync("id", "user-1"),
    ).toEqual(doc);
  });
});
