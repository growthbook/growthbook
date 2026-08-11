import {
  buildSymbolicatedStack,
  normalizeStackUrl,
  parseStackFromString,
  pickSourceMapUrl,
  stackUrlKeys,
} from "back-end/src/services/errorTrackingSymbolication";
import { ErrorSourceMapModel } from "back-end/src/models/ErrorSourceMapModel";

jest.mock("back-end/src/models/ErrorSourceMapModel", () => ({
  ErrorSourceMapModel: {
    find: jest.fn(),
  },
}));

const mockedFind = ErrorSourceMapModel.find as jest.Mock;

describe("errorTrackingSymbolication", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("normalizes webpack and absolute browser URLs", () => {
    expect(
      normalizeStackUrl(
        "webpack-internal:///(app-pages-browser)/./src/app/page.tsx",
      ),
    ).toBe("/src/app/page.tsx");
    expect(
      normalizeStackUrl("http://localhost:8000/_next/static/chunks/app.js"),
    ).toBe("/_next/static/chunks/app.js");
  });

  it("matches uploaded minified URLs by pathname", () => {
    const maps = [
      {
        minifiedUrl:
          "http://localhost:8000/_next/static/chunks/app/errors-demo/page.js",
      },
    ];
    const frameUrl =
      "http://localhost:8000/_next/static/chunks/app/errors-demo/page.js?dpl=abc";

    expect(pickSourceMapUrl(frameUrl, maps)).toBe(maps[0].minifiedUrl);
    expect(
      stackUrlKeys(frameUrl).some((key) =>
        stackUrlKeys(maps[0].minifiedUrl).includes(key),
      ),
    ).toBe(true);
  });

  it("parses chrome-style stack lines", () => {
    const frames = parseStackFromString(
      "Error: boom\n    at throwError (http://localhost:8000/app.js:12:34)",
    );
    expect(frames).toEqual([
      {
        function: "throwError",
        filename: "http://localhost:8000/app.js",
        lineno: 12,
        colno: 34,
      },
    ]);
  });

  it("attaches source context for node_modules frames when source maps include content", async () => {
    const sourceMapJson = JSON.stringify({
      version: 3,
      sources: ["node_modules/react/index.js"],
      names: ["useContext"],
      mappings: "AAAA",
      sourcesContent: ["export function useContext() {}\n"],
    });

    mockedFind.mockReturnValue({
      select: () => ({
        limit: () => ({
          lean: async () => [
            {
              minifiedUrl: "http://localhost:8000/app.js",
              sourceMapJson,
            },
          ],
        }),
      }),
    });

    const result = await buildSymbolicatedStack({
      organizationId: "org_123",
      clientKey: "sdk_test",
      release: "local-dev",
      properties: {
        stack:
          "Error: boom\n    at useContext (http://localhost:8000/app.js:1:0)",
        stackFrames: [
          {
            function: "useContext",
            filename: "http://localhost:8000/app.js",
            lineno: 1,
            colno: 0,
          },
        ],
      },
    });

    expect(result?.frames[0].resolved).toBe(true);
    expect(result?.frames[0].original?.filename).toBe(
      "node_modules/react/index.js",
    );
    expect(result?.frames[0].context?.lines.length).toBeGreaterThan(0);
  });

  it("symbolicates frames with uploaded source maps", async () => {
    const sourceMapJson = JSON.stringify({
      version: 3,
      sources: ["src/errors-demo/page.tsx"],
      names: ["throwError"],
      mappings: "AAAA",
      sourcesContent: [
        "export function throwError() {\n  throw new Error('boom');\n}\n",
      ],
    });

    mockedFind.mockReturnValue({
      select: () => ({
        limit: () => ({
          lean: async () => [
            {
              minifiedUrl: "http://localhost:8000/app.js",
              sourceMapJson,
            },
          ],
        }),
      }),
    });

    const result = await buildSymbolicatedStack({
      organizationId: "org_123",
      clientKey: "sdk_test",
      release: "local-dev",
      properties: {
        stack:
          "Error: boom\n    at throwError (http://localhost:8000/app.js:1:0)",
        stackFrames: [
          {
            function: "throwError",
            filename: "http://localhost:8000/app.js",
            lineno: 1,
            colno: 0,
          },
        ],
      },
    });

    expect(result?.resolvedFrameCount).toBe(1);
    expect(result?.frames[0].original).toEqual({
      filename: "src/errors-demo/page.tsx",
      line: 1,
      column: 0,
    });
    expect(
      result?.frames[0].context?.lines.some((line) =>
        line.content.includes("throw new Error"),
      ),
    ).toBe(true);
    expect(result?.text).toContain("src/errors-demo/page.tsx:1:0");
  });
});
