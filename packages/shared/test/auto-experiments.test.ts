import {
  connectionServesAutoExperimentFeature,
  hasCustomJs,
  isAutoExperimentFeatureEnabled,
  isCrossOriginRedirect,
  redirectKeepsStoredUrls,
} from "../src/util/auto-experiments";

describe("isAutoExperimentFeatureEnabled", () => {
  it("treats an organization without settings as already opted in", () => {
    expect(
      isAutoExperimentFeatureEnabled(undefined, "customJs", "existing-only"),
    ).toBe(true);
    expect(isAutoExperimentFeatureEnabled({}, "urlRedirects", "allowed")).toBe(
      true,
    );
  });

  it("reads an explicit setting", () => {
    const settings = {
      autoExperiments: { visualEditor: true, urlRedirects: false },
    };
    expect(
      isAutoExperimentFeatureEnabled(settings, "visualEditor", "allowed"),
    ).toBe(true);
    expect(
      isAutoExperimentFeatureEnabled(settings, "urlRedirects", "allowed"),
    ).toBe(false);
  });

  it("turns a feature off with its parent", () => {
    const settings = {
      autoExperiments: {
        visualEditor: false,
        customJs: true,
        urlRedirects: false,
        crossOriginRedirects: true,
      },
    };
    expect(
      isAutoExperimentFeatureEnabled(settings, "customJs", "allowed"),
    ).toBe(false);
    expect(
      isAutoExperimentFeatureEnabled(
        settings,
        "crossOriginRedirects",
        "allowed",
      ),
    ).toBe(false);
  });

  it("turns everything off when the instance disables it", () => {
    const settings = { autoExperiments: { visualEditor: true } };
    expect(
      isAutoExperimentFeatureEnabled(settings, "visualEditor", "disabled"),
    ).toBe(false);
    expect(
      isAutoExperimentFeatureEnabled(undefined, "urlRedirects", "disabled"),
    ).toBe(false);
  });
});

describe("connectionServesAutoExperimentFeature", () => {
  it("needs the include flag", () => {
    expect(connectionServesAutoExperimentFeature({}, "visualEditor")).toBe(
      false,
    );
    expect(
      connectionServesAutoExperimentFeature(
        { allowCustomJs: true },
        "customJs",
      ),
    ).toBe(false);
  });

  it("keeps serving both on a connection that predates the settings", () => {
    const legacy = {
      includeVisualExperiments: true,
      includeRedirectExperiments: true,
    };
    expect(connectionServesAutoExperimentFeature(legacy, "customJs")).toBe(
      true,
    );
    expect(
      connectionServesAutoExperimentFeature(legacy, "crossOriginRedirects"),
    ).toBe(true);
  });

  it("reads an explicit false", () => {
    const connection = {
      includeVisualExperiments: true,
      includeRedirectExperiments: true,
      allowCustomJs: false,
      allowCrossOriginRedirects: false,
    };
    expect(connectionServesAutoExperimentFeature(connection, "customJs")).toBe(
      false,
    );
    expect(
      connectionServesAutoExperimentFeature(connection, "crossOriginRedirects"),
    ).toBe(false);
    expect(
      connectionServesAutoExperimentFeature(connection, "visualEditor"),
    ).toBe(true);
  });
});

describe("hasCustomJs", () => {
  it("ignores missing and blank JavaScript", () => {
    expect(hasCustomJs([{}, { js: "" }, { js: "  \n" }])).toBe(false);
    expect(hasCustomJs([{ js: "" }, { js: "alert(1)" }])).toBe(true);
  });
});

describe("isCrossOriginRedirect", () => {
  const redirect = (urlPattern: string, ...urls: string[]) => ({
    urlPattern,
    destinationURLs: urls.map((url) => ({ url })),
  });

  it("allows the same protocol and host", () => {
    expect(
      isCrossOriginRedirect(
        redirect(
          "https://www.example.com/pricing",
          "",
          "https://www.example.com/pricing-b?x=1",
        ),
      ),
    ).toBe(false);
  });

  it("flags a different host, subdomain, port or protocol", () => {
    const from = "https://www.example.com/pricing";
    for (const to of [
      "https://evil.test/pricing",
      "https://app.example.com/pricing",
      "https://www.example.com:8443/pricing",
      "http://www.example.com/pricing",
      "https://www.example.com.evil.test/",
    ]) {
      expect(isCrossOriginRedirect(redirect(from, to))).toBe(true);
    }
  });

  it("flags any one cross-origin destination", () => {
    expect(
      isCrossOriginRedirect(
        redirect(
          "https://www.example.com/a",
          "https://www.example.com/b",
          "https://evil.test/",
        ),
      ),
    ).toBe(true);
  });

  it("flags a destination that isn't https, even on the same host", () => {
    expect(
      isCrossOriginRedirect(
        redirect("http://www.example.com/a", "http://www.example.com/b"),
      ),
    ).toBe(true);
  });

  it("flags a URL it can't read", () => {
    expect(
      isCrossOriginRedirect(redirect("https://www.example.com/a", "/b")),
    ).toBe(true);
    expect(
      isCrossOriginRedirect(
        redirect("www.example.com/a", "https://www.example.com/b"),
      ),
    ).toBe(true);
  });

  it("ignores variations with no destination", () => {
    expect(isCrossOriginRedirect(redirect("not a url", "", ""))).toBe(false);
  });
});

describe("redirectKeepsStoredUrls", () => {
  const stored = {
    urlPattern: "https://www.example.com/a",
    destinationURLs: [
      { variation: "v0", url: "" },
      { variation: "v1", url: "https://evil.test/" },
    ],
  };

  it("holds when variations are added empty, removed or reordered", () => {
    expect(
      redirectKeepsStoredUrls(
        {
          ...stored,
          destinationURLs: [...stored.destinationURLs].reverse().concat({
            variation: "v2",
            url: "",
          }),
        },
        stored,
      ),
    ).toBe(true);
    expect(
      redirectKeepsStoredUrls(
        { ...stored, destinationURLs: [{ variation: "v0", url: "" }] },
        stored,
      ),
    ).toBe(true);
  });

  it("fails when a destination is new, changed, or moved to another variation", () => {
    for (const destinationURLs of [
      [{ variation: "v2", url: "https://evil.test/" }],
      [{ variation: "v1", url: "https://evil.test/other" }],
      [{ variation: "v0", url: "https://evil.test/" }],
    ]) {
      expect(
        redirectKeepsStoredUrls({ ...stored, destinationURLs }, stored),
      ).toBe(false);
    }
  });

  it("fails when the origin URL changes", () => {
    expect(
      redirectKeepsStoredUrls(
        { ...stored, urlPattern: "https://www.example.com/other" },
        stored,
      ),
    ).toBe(false);
  });
});
