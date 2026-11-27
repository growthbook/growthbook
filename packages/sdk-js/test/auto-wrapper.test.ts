import type { AutoExperiment, GrowthBook } from "../src";

function sleep(ms = 50) {
  return new Promise((res) => setTimeout(res, ms));
}

const visual: AutoExperiment = {
  key: "visual",
  weights: [0, 1],
  variations: [
    {},
    {
      domMutations: [
        { selector: "h1", action: "set", attribute: "html", value: "new" },
      ],
    },
  ],
};
const visualJs: AutoExperiment = {
  key: "visual-js",
  weights: [0, 1],
  variations: [{}, { js: "/* something */" }],
};
// jsdom's page is http://localhost/
const SAME_ORIGIN = "http://localhost/new";
const CROSS_ORIGIN = "http://www.example.com/new";
function redirect(urlRedirect: string): AutoExperiment {
  return {
    key: "redirect",
    weights: [0, 1],
    urlPatterns: [{ type: "simple", include: true, pattern: "/" }],
    variations: [{}, { urlRedirect }],
  };
}

let gb: GrowthBook;
let init: jest.SpyInstance;
const navigate = jest.fn();

// Loads the wrapper as one of the bundles rollup builds from it: the legacy
// "auto", or a script bundle named after its features
async function load(
  bundle:
    | "auto"
    | "core"
    | "core-visual"
    | "core-redirects"
    | "core-redirects-visual",
  config: Window["growthbook_config"],
  experiments: AutoExperiment[],
  dataAttributes: Record<string, string> = {},
) {
  Object.assign(globalThis, {
    __GB_AUTO__: bundle === "auto",
    __GB_VISUAL__: bundle.includes("visual"),
    __GB_REDIRECTS__: bundle.includes("redirects"),
  });
  document.head.innerHTML = "";
  document.body.innerHTML = "<h1>title</h1>";
  document.cookie = "gbuuid=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  navigate.mockClear();
  delete window.growthbook_queue;
  window.growthbook_config = {
    attributes: { id: "1" },
    noStreaming: true,
    trackingCallback: () => {},
    navigate,
    payload: { experiments },
    ...config,
  };
  const script = document.createElement("script");
  for (const name in dataAttributes) {
    script.setAttribute(name, dataAttributes[name]);
  }
  Object.defineProperty(document, "currentScript", {
    value: script,
    configurable: true,
  });
  jest.isolateModules(() => {
    init = jest.spyOn(
      require("../src/GrowthBook").GrowthBook.prototype,
      "init",
    );
    gb = require("../src/auto-wrapper").default;
  });
  await sleep();
}

afterEach(() => {
  gb.destroy();
});

// The auto bundle has to keep running these experiments the way it did before
// they moved into plugins, with the old options still turning them off
describe("auto.min.js", () => {
  it("runs visual editor and URL redirect experiments by default", async () => {
    await load("auto", {}, [visual, visualJs, redirect(CROSS_ORIGIN)]);
    expect(document.body.innerHTML).toEqual("<h1>new</h1>");
    expect(document.head.innerHTML).toContain("/* something */");
    expect(navigate).toHaveBeenCalledWith(CROSS_ORIGIN);
    expect(gb.getRedirectUrl()).toEqual(CROSS_ORIGIN);
  });

  it("honors disableVisualExperiments", async () => {
    await load("auto", { disableVisualExperiments: true }, [
      visual,
      redirect(SAME_ORIGIN),
    ]);
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(navigate).toHaveBeenCalledWith(SAME_ORIGIN);
  });

  it("honors disableJsInjection and jsInjectionNonce", async () => {
    await load("auto", { disableJsInjection: true }, [visual, visualJs]);
    expect(document.body.innerHTML).toEqual("<h1>new</h1>");
    expect(document.head.innerHTML).toEqual("");
    gb.destroy();

    await load("auto", { jsInjectionNonce: "123" }, [visualJs]);
    expect(document.head.innerHTML).toEqual(
      '<script nonce="123">/* something */</script>',
    );
  });

  it("honors disableUrlRedirectExperiments", async () => {
    await load("auto", { disableUrlRedirectExperiments: true }, [
      visual,
      redirect(SAME_ORIGIN),
    ]);
    expect(document.body.innerHTML).toEqual("<h1>new</h1>");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("honors disableCrossOriginUrlRedirectExperiments", async () => {
    await load("auto", { disableCrossOriginUrlRedirectExperiments: true }, [
      redirect(CROSS_ORIGIN),
    ]);
    expect(navigate).not.toHaveBeenCalled();
    expect(gb.getRedirectUrl()).toEqual("");
    gb.destroy();

    await load("auto", { disableCrossOriginUrlRedirectExperiments: true }, [
      redirect(SAME_ORIGIN),
    ]);
    expect(navigate).toHaveBeenCalledWith(SAME_ORIGIN);
  });

  it("keeps reading on/off data attributes the old way", async () => {
    // Any non-empty value was on, even "false"
    await load("auto", {}, [visual, visualJs], {
      "data-disable-js-injection": "false",
    });
    expect(document.head.innerHTML).toEqual("");
    gb.destroy();

    // The attribute only had to be present
    await load("auto", {}, [], { "data-no-auto-cookies": "false" });
    expect(document.cookie).not.toContain("gbuuid");
  });
});

describe("script bundles", () => {
  it("core.min.js runs neither kind of experiment", async () => {
    await load(
      "core",
      { allowCustomJs: true, allowCrossOriginRedirects: true },
      [visual, redirect(SAME_ORIGIN)],
    );
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(navigate).not.toHaveBeenCalled();
    expect(gb.triggerExperiment("visual")).toEqual(null);
  });

  it("core-visual.min.js runs visual editor experiments, without custom JS", async () => {
    await load("core-visual", {}, [visual, visualJs, redirect(SAME_ORIGIN)]);
    expect(document.body.innerHTML).toEqual("<h1>new</h1>");
    expect(document.head.innerHTML).toEqual("");
    expect(navigate).not.toHaveBeenCalled();
    gb.destroy();

    await load("core-visual", { allowCustomJs: true }, [visualJs]);
    expect(document.head.innerHTML).toContain("/* something */");
  });

  it("core-redirects.min.js runs same-origin URL redirects", async () => {
    await load("core-redirects", {}, [visual, redirect(SAME_ORIGIN)]);
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(navigate).toHaveBeenCalledWith(SAME_ORIGIN);
    gb.destroy();

    await load("core-redirects", {}, [redirect(CROSS_ORIGIN)]);
    expect(navigate).not.toHaveBeenCalled();
    gb.destroy();

    await load("core-redirects", {}, [redirect(CROSS_ORIGIN)], {
      "data-allow-cross-origin-redirects": "",
    });
    expect(navigate).toHaveBeenCalledWith(CROSS_ORIGIN);
  });

  it("ignores the old disable settings", async () => {
    await load(
      "core-redirects-visual",
      { disableVisualExperiments: true, disableUrlRedirectExperiments: true },
      [visual, redirect(SAME_ORIGIN)],
    );
    expect(document.body.innerHTML).toEqual("<h1>new</h1>");
    expect(navigate).toHaveBeenCalledWith(SAME_ORIGIN);
  });

  it.each([
    ["", true],
    ["true", true],
    ["1", true],
    ["yes", true],
    ["false", false],
    ["FALSE", false],
    [" off ", false],
    ["0", false],
  ])("reads the on/off data attribute value %j as %s", async (value, on) => {
    await load("core-visual", {}, [visualJs], {
      "data-allow-custom-js": value,
    });
    expect(document.head.innerHTML.includes("/* something */")).toEqual(on);
  });

  it("reads every on/off data attribute by the same rule", async () => {
    await load("core", {}, [], { "data-no-auto-cookies": "false" });
    expect(document.cookie).toContain("gbuuid");
    gb.destroy();

    await load("core", {}, [], { "data-no-auto-cookies": "" });
    expect(document.cookie).not.toContain("gbuuid");
    gb.destroy();

    // A GrowthBook option passed as a data attribute
    await load("core", {}, [], { "data-debug": "false" });
    expect(gb.debug).toEqual(false);
    gb.destroy();

    await load("core", {}, [], { "data-debug": "" });
    expect(gb.debug).toEqual(true);
  });

  it("turns streaming off with data-background-sync", async () => {
    await load("core", { noStreaming: false }, [], {
      "data-background-sync": "false",
    });
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ streaming: false }),
    );
  });

  it("lets window.growthbook_config override a data attribute", async () => {
    await load("core-visual", { allowCustomJs: false }, [visualJs], {
      "data-allow-custom-js": "true",
    });
    expect(document.head.innerHTML).toEqual("");
  });
});
