import { AutoExperiment, GrowthBook as NpmGrowthBook } from "../src";
import { GrowthBook, GrowthBookClient } from "../src/bundle";

function sleep(ms = 20) {
  return new Promise((res) => setTimeout(res, ms));
}

const experiments: AutoExperiment[] = [
  {
    key: "visual",
    weights: [0, 1],
    variations: [
      {},
      {
        js: "/* something */",
        domMutations: [
          { selector: "h1", action: "set", attribute: "html", value: "new" },
        ],
      },
    ],
  },
  {
    key: "redirect",
    weights: [0, 1],
    urlPatterns: [{ type: "simple", include: true, pattern: "/home" }],
    variations: [{}, { urlRedirect: "http://www.another.com/new" }],
  },
];

// dist/bundles/index*.js and esm*.js are loaded from CDNs without a version,
// so they have to keep working the way they did before the plugins existed
describe("CDN bundle entry point", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "<h1>title</h1>";
  });

  it("runs visual editor and URL redirect experiments with no plugins", async () => {
    const navigate = jest.fn();
    const gb = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      navigate,
      experiments,
    });
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>new</h1>");
    expect(document.head.innerHTML).toContain("/* something */");
    expect(navigate).toHaveBeenCalledWith("http://www.another.com/new");
    gb.destroy();
  });

  it("still takes the options that turn them off", async () => {
    const navigate = jest.fn();
    const gb = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      navigate,
      disableJsInjection: true,
      disableCrossOriginUrlRedirectExperiments: true,
      experiments,
    });
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(navigate).not.toHaveBeenCalled();
    gb.destroy();
  });

  it("differs from the npm entry point, which needs the plugins", async () => {
    const gb = new NpmGrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      experiments,
    });
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    gb.destroy();
  });

  it("exports everything else unchanged", () => {
    expect(GrowthBookClient).toBeDefined();
    expect(new GrowthBook()).toBeInstanceOf(NpmGrowthBook);
  });
});
