import type { OrganizationSettings } from "shared/types/organization";
import type { VisualChange } from "shared/types/visual-changeset";
import type { ReqContext } from "back-end/types/request";
import {
  assertConnectionAutoExperimentsAllowed,
  assertUrlRedirectAllowed,
  assertVisualChangesAllowed,
  getAutoExperimentAccess,
} from "back-end/src/services/autoExperiments";

const allOff = {
  visualEditor: false,
  urlRedirects: false,
  customJs: false,
  crossOriginRedirects: false,
};
const ctx = (autoExperiments?: OrganizationSettings["autoExperiments"]) =>
  ({ org: { settings: { autoExperiments } } }) as ReqContext;

const change = (overrides: Partial<VisualChange> = {}): VisualChange => ({
  id: "vc_1",
  description: "",
  css: "",
  variation: "v1",
  domMutations: [],
  ...overrides,
});

describe("assertVisualChangesAllowed", () => {
  it("allows everything in an organization that predates the opt-in", () => {
    expect(() =>
      assertVisualChangesAllowed(ctx(), [change({ js: "alert(1)" })], {
        always: true,
      }),
    ).not.toThrow();
  });

  it("refuses a requested write when the visual editor is off", () => {
    expect(() =>
      assertVisualChangesAllowed(ctx(allOff), [], { always: true }),
    ).toThrow(/AI Visual Editor experiments are not enabled/);
  });

  it("lets unchanged and empty changes through when it is off", () => {
    const stored = [change({ css: "a { color: red }", js: "alert(1)" })];
    expect(() =>
      assertVisualChangesAllowed(
        ctx(allOff),
        [stored[0], change({ id: "vc_new", variation: "v2" })],
        { stored },
      ),
    ).not.toThrow();
  });

  it("refuses an edit when it is off", () => {
    const stored = [change()];
    expect(() =>
      assertVisualChangesAllowed(
        ctx(allOff),
        [{ id: "vc_1", css: "a { color: red }" }],
        { stored },
      ),
    ).toThrow(/AI Visual Editor experiments are not enabled/);
  });

  it("refuses new or changed JavaScript when custom JS is off", () => {
    const context = ctx({ ...allOff, visualEditor: true });
    expect(() =>
      assertVisualChangesAllowed(context, [change({ js: "alert(1)" })]),
    ).toThrow(/Custom JavaScript/);
    expect(() =>
      assertVisualChangesAllowed(context, [{ id: "vc_1", js: "alert(2)" }], {
        stored: [change({ js: "alert(1)" })],
      }),
    ).toThrow(/Custom JavaScript/);
  });

  it("allows other edits, and clearing JavaScript, when custom JS is off", () => {
    const context = ctx({ ...allOff, visualEditor: true });
    const stored = [change({ js: "alert(1)" })];
    expect(() =>
      assertVisualChangesAllowed(
        context,
        [{ id: "vc_1", css: "a { color: red }" }],
        { stored },
      ),
    ).not.toThrow();
    expect(() =>
      assertVisualChangesAllowed(context, [{ id: "vc_1", js: "" }], { stored }),
    ).not.toThrow();
  });
});

describe("assertUrlRedirectAllowed", () => {
  const sameOrigin = {
    urlPattern: "https://www.example.com/a",
    destinationURLs: [
      { variation: "v0", url: "" },
      { variation: "v1", url: "https://www.example.com/b" },
    ],
  };
  const crossOrigin = {
    ...sameOrigin,
    destinationURLs: [{ variation: "v1", url: "https://evil.test/" }],
  };

  it("refuses any redirect when redirects are off", () => {
    expect(() => assertUrlRedirectAllowed(ctx(allOff), sameOrigin)).toThrow(
      /URL redirect experiments are not enabled/,
    );
  });

  it("refuses only a cross-origin redirect when that is off", () => {
    const context = ctx({ ...allOff, urlRedirects: true });
    expect(() => assertUrlRedirectAllowed(context, sameOrigin)).not.toThrow();
    expect(() => assertUrlRedirectAllowed(context, crossOrigin)).toThrow(
      /different origin/,
    );
  });

  it("lets a redirect whose URLs are unchanged through", () => {
    expect(() =>
      assertUrlRedirectAllowed(
        ctx(allOff),
        {
          ...crossOrigin,
          destinationURLs: [
            { variation: "v2", url: "" },
            { variation: "v1", url: "https://evil.test/" },
          ],
        },
        crossOrigin,
      ),
    ).not.toThrow();
  });
});

describe("getAutoExperimentAccess", () => {
  const connection = {
    includeVisualExperiments: true,
    includeRedirectExperiments: true,
    allowCustomJs: true,
    allowCrossOriginRedirects: false,
  };

  it("needs both the organization and the SDK Connection", () => {
    expect(
      getAutoExperimentAccess(
        {
          settings: {
            autoExperiments: {
              visualEditor: true,
              customJs: false,
              urlRedirects: true,
              crossOriginRedirects: true,
            },
          },
        },
        connection,
      ),
    ).toEqual({
      visualEditor: true,
      customJs: false,
      urlRedirects: true,
      crossOriginRedirects: false,
    });
  });

  it("serves nothing once the organization turns it off", () => {
    expect(
      getAutoExperimentAccess(
        { settings: { autoExperiments: allOff } },
        connection,
      ),
    ).toEqual(allOff);
  });
});

describe("assertConnectionAutoExperimentsAllowed", () => {
  it("refuses turning on what the organization hasn't", () => {
    expect(() =>
      assertConnectionAutoExperimentsAllowed(
        ctx(allOff),
        { includeVisualExperiments: true, allowCustomJs: false },
        { includeVisualExperiments: false },
      ),
    ).toThrow(/AI Visual Editor experiments are not enabled/);
    expect(() =>
      assertConnectionAutoExperimentsAllowed(
        ctx({ ...allOff, visualEditor: true }),
        { includeVisualExperiments: true, allowCustomJs: true },
      ),
    ).toThrow(/Custom JavaScript/);
  });

  it("allows saving a connection that already had it on", () => {
    const connection = { includeVisualExperiments: true, allowCustomJs: true };
    expect(() =>
      assertConnectionAutoExperimentsAllowed(
        ctx(allOff),
        connection,
        connection,
      ),
    ).not.toThrow();
  });

  it("allows turning things off", () => {
    expect(() =>
      assertConnectionAutoExperimentsAllowed(
        ctx(allOff),
        { includeVisualExperiments: false, includeRedirectExperiments: false },
        { includeVisualExperiments: true, includeRedirectExperiments: true },
      ),
    ).not.toThrow();
  });
});
