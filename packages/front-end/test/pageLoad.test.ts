import type { PageLoadReport } from "shared/validators";
import {
  createPageLoadReporter,
  getRequestKey,
  getRequestTimings,
  PageLoadReporterDeps,
} from "@/services/pageLoad";

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

describe("createPageLoadReporter", () => {
  function setup(overrides: Partial<PageLoadReporterDeps> = {}) {
    let now = 1000;
    const deps: PageLoadReporterDeps = {
      startPath: "/features/a",
      appOrigin: app,
      now: () => now,
      enabled: () => true,
      build: () => "abc1234",
      apiHost: () => api,
      hiddenAt: () => undefined,
      navigation: () => ({
        type: "navigate",
        responseStart: 50.4,
        domContentLoadedEventEnd: 400.6,
      }),
      resources: () => [
        {
          name: `${api}/user`,
          startTime: 100,
          responseEnd: 200,
          transferSize: 0,
        },
      ],
      ...overrides,
    };
    const reporter = createPageLoadReporter(deps);
    const sent: PageLoadReport[] = [];
    const send = (report: PageLoadReport) => sent.push(report);
    return {
      reporter,
      sent,
      send,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it("sends one report with the marks in order", () => {
    const { reporter, sent, send, advance } = setup();
    reporter.mark("pageMounted", "/features/[fid]", false, send);
    advance(500);
    reporter.mark("pageReady", "/features/[fid]", true, send);
    expect(sent).toEqual([
      {
        route: "/features/[fid]",
        navigationType: "navigate",
        build: "abc1234",
        responseStart: 50,
        domContentLoaded: 401,
        pageMounted: 1000,
        pageReady: 1500,
        requests: { user: { start: 100, end: 200, bytes: 0 } },
      },
    ]);
  });

  it("falls back to the last mark when the page is ready before it mounts", () => {
    const { reporter, sent, send } = setup();
    reporter.mark("pageReady", "/features/[fid]", true, send);
    expect(sent[0].pageMounted).toBe(1000);
    expect(sent[0].pageReady).toBe(1000);
  });

  it("keeps the first time for a repeated mark", () => {
    const { reporter, sent, send, advance } = setup();
    reporter.mark("pageMounted", "/features", false, send);
    advance(100);
    reporter.mark("pageMounted", "/features", false, send);
    advance(100);
    reporter.mark("pageMounted", "/features", true, send);
    expect(sent).toHaveLength(1);
    expect(sent[0].pageMounted).toBe(1000);
    expect(sent[0].pageReady).toBeUndefined();
  });

  it("sends at most once per document", () => {
    const { reporter, sent, send } = setup();
    reporter.mark("pageMounted", "/features", true, send);
    reporter.mark("pageMounted", "/features", true, send);
    reporter.mark("pageReady", "/features", true, send);
    expect(sent).toHaveLength(1);
  });

  it("includes hiddenAt when the tab went to the background", () => {
    const { reporter, sent, send } = setup({ hiddenAt: () => 0 });
    reporter.mark("pageMounted", "/features", true, send);
    expect(sent[0].hiddenAt).toBe(0);
  });

  it("sends nothing when timing is disabled", () => {
    const { reporter, sent, send } = setup({ enabled: () => false });
    reporter.mark("pageMounted", "/features", true, send);
    expect(sent).toEqual([]);
  });

  it("sends nothing after ten minutes", () => {
    const { reporter, sent, send, advance } = setup();
    advance(600_000);
    reporter.mark("pageMounted", "/features", true, send);
    expect(sent).toEqual([]);
  });

  it("sends nothing without a navigation entry", () => {
    const { reporter, sent, send } = setup({ navigation: () => undefined });
    reporter.mark("pageMounted", "/features", true, send);
    expect(sent).toEqual([]);
  });

  it("cancels once the user leaves the start path, even if they return", () => {
    const { reporter, sent, send } = setup();
    reporter.mark("pageMounted", "/features/[fid]", false, send);
    reporter.routeChangeStart("/features/b");
    reporter.routeChangeStart("/features/a");
    reporter.mark("pageReady", "/features/[fid]", true, send);
    expect(sent).toEqual([]);
  });

  it("keeps the report when only the query or hash changes", () => {
    const { reporter, sent, send } = setup();
    reporter.mark("pageMounted", "/features/[fid]", false, send);
    reporter.routeChangeStart("/features/a?v=2#rules");
    reporter.mark("pageReady", "/features/[fid]", true, send);
    expect(sent).toHaveLength(1);
  });
});
