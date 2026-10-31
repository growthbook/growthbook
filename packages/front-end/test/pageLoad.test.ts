import { getRequestKey, getRequestTimings } from "@/services/pageLoad";

const app = "https://app.example.com";
const api = "https://api.example.com";

describe("getRequestKey", () => {
  it("matches init on the app origin", () => {
    expect(getRequestKey(`${app}/api/init`, app, api)).toBe("init");
    expect(getRequestKey(`${api}/api/init`, app, api)).toBeNull();
  });

  it("matches the API paths the report covers, ignoring query strings", () => {
    expect(getRequestKey(`${api}/auth/refresh`, app, api)).toBe("authRefresh");
    expect(getRequestKey(`${api}/user`, app, api)).toBe("user");
    expect(getRequestKey(`${api}/organization?x=1`, app, api)).toBe(
      "organization",
    );
    expect(getRequestKey(`${api}/organization/definitions`, app, api)).toBe(
      "definitions",
    );
    expect(getRequestKey(`${api}/feature/my-flag?v=3`, app, api)).toBe(
      "feature",
    );
  });

  it("ignores other requests", () => {
    expect(getRequestKey(`${api}/feature/my-flag/revisions`, app, api)).toBe(
      null,
    );
    expect(getRequestKey(`${api}/features`, app, api)).toBeNull();
    expect(getRequestKey(`${app}/user`, app, api)).toBeNull();
    expect(getRequestKey(`${api}/user`, app, "")).toBeNull();
  });

  it("supports an API host with a path", () => {
    const prefixed = `${app}/backend`;
    expect(getRequestKey(`${prefixed}/user`, app, prefixed)).toBe("user");
    expect(getRequestKey(`${app}/user`, app, prefixed)).toBeNull();
  });
});

describe("getRequestTimings", () => {
  it("keeps the first call to each path and rounds the times", () => {
    expect(
      getRequestTimings(
        [
          {
            name: `${app}/api/init`,
            startTime: 10.4,
            responseEnd: 30.6,
            transferSize: 500,
          },
          {
            name: `${api}/organization`,
            startTime: 100,
            responseEnd: 200,
            transferSize: 0,
          },
          {
            name: `${api}/organization`,
            startTime: 300,
            responseEnd: 400,
            transferSize: 0,
          },
          {
            name: `${api}/metrics`,
            startTime: 1,
            responseEnd: 2,
            transferSize: 0,
          },
        ],
        app,
        api,
      ),
    ).toEqual({
      init: { start: 10, end: 31, bytes: 500 },
      organization: { start: 100, end: 200, bytes: 0 },
    });
  });
});
