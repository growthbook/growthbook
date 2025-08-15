import { AutoExperiment, GrowthBook } from "../src";

function sleep(ms = 20) {
  return new Promise((res) => setTimeout(res, ms));
}

describe("urlRedirects", () => {
  const realLocation = window.location;

  beforeEach(() => {
    // @ts-expect-error: Ignoring operand for delete operator needing to be optional for testing
    delete window.location;
    window.location = { ...realLocation, replace: jest.fn() };
  });

  afterEach(() => {
    window.location = realLocation;
  });

  it("redirects when default navigate function is used", async () => {
    const gb = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com",
      experiments: [
        {
          key: "my-experiment",
          urlPatterns: [
            {
              type: "simple",
              include: true,
              pattern: "http://www.example.com/home",
            },
          ],
          weights: [0.1, 0.9],
          variations: [
            {},
            {
              urlRedirect: "http://www.example.com/home-new",
            },
          ],
        },
      ],
    });
    // Changes applied immediately
    await sleep();

    gb.setURL("http://www.example.com/home");
    await sleep(100);
    expect(window.location.replace).toHaveBeenCalledWith(
      "http://www.example.com/home-new",
    );

    gb.destroy();
  });

  it("conditional prereq allows redirect", async () => {
    const gb = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com",
      features: {
        parentFlag: {
          defaultValue: false,
          rules: [
            {
              condition: { id: "1" },
              force: true,
            },
          ],
        },
      },
      experiments: [
        {
          key: "my-experiment",
          urlPatterns: [
            {
              type: "simple",
              include: true,
              pattern: "http://www.example.com/home",
            },
          ],
          weights: [0.1, 0.9],
          variations: [
            {},
            {
              urlRedirect: "http://www.example.com/home-new",
            },
          ],
          parentConditions: [
            {
              id: "parentFlag",
              condition: { value: true },
            },
          ],
        },
      ],
    });
    // Changes applied immediately
    await sleep();

    gb.setURL("http://www.example.com/home");
    await sleep(100);
    expect(window.location.replace).toHaveBeenCalledWith(
      "http://www.example.com/home-new",
    );

    gb.destroy();
  });

  it("conditional prereq blocks redirect", async () => {
    const gb = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com",
      features: {
        parentFlag: {
          defaultValue: false,
          rules: [
            {
              condition: { id: "2" },
              force: true,
            },
          ],
        },
      },
      experiments: [
        {
          key: "my-experiment",
          urlPatterns: [
            {
              type: "simple",
              include: true,
              pattern: "http://www.example.com/home",
            },
          ],
          weights: [0.1, 0.9],
          variations: [
            {},
            {
              urlRedirect: "http://www.example.com/home-new",
            },
          ],
          parentConditions: [
            {
              id: "parentFlag",
              condition: { value: true },
            },
          ],
        },
      ],
    });
    // Changes applied immediately
    await sleep();

    gb.setURL("http://www.example.com/home");
    await sleep(100);
    // expect replace to not have been called
    expect(window.location.replace).not.toHaveBeenCalled();

    gb.destroy();
  });

  it("Skips redirect when the context URL is invalid", async () => {
    const gb = new GrowthBook({
      attributes: { id: "1" },
      url: "http:://www.example.com/home",
      experiments: [
        {
          key: "my-experiment",
          urlPatterns: [
            {
              type: "simple",
              include: true,
              pattern: "/home",
            },
          ],
          weights: [0, 1],
          manual: true,
          variations: [
            {},
            {
              urlRedirect: "http://www.example.com/home-new",
            },
          ],
        },
      ],
    });

    await sleep();

    const results = gb.triggerExperiment("my-experiment");
    expect(results?.length).toBe(1);
    expect(results?.[0]?.inExperiment).toEqual(false);

    // Valid URL
    gb.setURL("http://www.example.com/home");
    const results2 = gb.triggerExperiment("my-experiment");
    expect(results2?.length).toBe(1);
    expect(results2?.[0]?.inExperiment).toEqual(true);

    gb.destroy();
  });

  it("Skips redirect test when one of the variation URLs is invalid", async () => {
    const gb = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      experiments: [
        {
          key: "my-experiment",
          urlPatterns: [
            {
              type: "simple",
              include: true,
              pattern: "/home",
            },
          ],
          // Even works when you aren't assigned the broken variation
          weights: [1, 0, 0],
          manual: true,
          variations: [
            {},
            {
              urlRedirect: "http://www.example.com/home-new",
            },
            {
              urlRedirect: "fdsjaklfsd7&&**",
            },
          ],
        },
      ],
    });

    await sleep();

    const results = gb.triggerExperiment("my-experiment");
    expect(results?.length).toBe(1);
    expect(results?.[0]?.inExperiment).toEqual(false);

    gb.destroy();
  });

  it("Skips redirect test when one of the variations is a cross-origin test and that is disabled", () => {
    const gb = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      experiments: [
        {
          key: "my-experiment",
          urlPatterns: [
            {
              type: "simple",
              include: true,
              pattern: "/home",
            },
          ],
          weights: [1, 0],
          manual: true,
          variations: [
            {},
            {
              urlRedirect: "http://www.google.com/home-new",
            },
          ],
        },
      ],
      disableCrossOriginUrlRedirectExperiments: true,
    });

    // Different domain, block
    const results = gb.triggerExperiment("my-experiment");
    expect(results?.length).toBe(1);
    expect(results?.[0]?.inExperiment).toEqual(false);

    // Same domain, but different protocol, block
    gb.setURL("https://www.google.com/home");
    const results2 = gb.triggerExperiment("my-experiment");
    expect(results2?.length).toBe(1);
    expect(results2?.[0]?.inExperiment).toEqual(false);

    // Same domain, same protocol, different subdomain, block
    gb.setURL("http://something.google.com/home");
    const results3 = gb.triggerExperiment("my-experiment");
    expect(results3?.length).toBe(1);
    expect(results3?.[0]?.inExperiment).toEqual(false);

    // Same domain, same protocol, same subdomain, allow
    gb.setURL("http://www.google.com/home");
    const results4 = gb.triggerExperiment("my-experiment");
    expect(results4?.length).toBe(1);
    expect(results4?.[0]?.inExperiment).toEqual(true);

    gb.destroy();
  });

  it("Skips redirect test when it is disabled via context", () => {
    const experiments: AutoExperiment[] = [
      {
        changeId: "123",
        key: "my-experiment",
        urlPatterns: [
          {
            type: "simple",
            include: true,
            pattern: "/home",
          },
        ],
        weights: [1, 0],
        manual: true,
        variations: [
          {},
          {
            urlRedirect: "http://www.example.com/home-new",
          },
        ],
      },
    ];

    // All URL Redirect tests blocked via context
    const gb = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      experiments: experiments,
      disableUrlRedirectExperiments: true,
    });
    const results = gb.triggerExperiment("my-experiment");
    expect(results?.length).toBe(1);
    expect(results?.[0]?.inExperiment).toEqual(false);
    gb.destroy();

    // This specific changeId is blocked via context
    const gb2 = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      experiments: experiments,
      blockedChangeIds: ["abc", "123"],
    });
    const results2 = gb2.triggerExperiment("my-experiment");
    expect(results2?.length).toBe(1);
    expect(results2?.[0]?.inExperiment).toEqual(false);
    gb2.destroy();

    // Not blocked
    const gb3 = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      experiments: experiments,
      blockedChangeIds: ["abc"],
    });
    const results3 = gb3.triggerExperiment("my-experiment");
    expect(results3?.length).toBe(1);
    expect(results3?.[0]?.inExperiment).toEqual(true);
    gb3.destroy();
  });

  it("only redirects once per url", async () => {
    const navigateMock = jest.fn(async (_) => {
      await sleep(500);
    });

    const gb = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com",
      experiments: [
        {
          key: "my-experiment",
          urlPatterns: [
            {
              type: "simple",
              include: true,
              pattern: "http://www.example.com/home",
            },
          ],
          weights: [0.1, 0.9],
          variations: [
            {},
            {
              urlRedirect: "http://www.example.com/home-new",
            },
          ],
        },
      ],
      navigate: navigateMock,
      navigateDelay: 0,
    });
    // Changes applied immediately
    await sleep();

    gb.setURL("http://www.example.com/home");
    await sleep(10);
    gb.setURL("http://www.example.com/home");
    await sleep(10);
    gb.setURL("http://www.example.com/home");
    await sleep(10);
    expect(navigateMock.mock.calls.length).toBe(1);

    await sleep(500);
    gb.setURL("http://www.example.com/home");
    expect(navigateMock.mock.calls.length).toBe(1);

    // currently only exact matches are debounced
    gb.setURL("http://www.example.com/home/");
    gb.setURL("http://www.example.com/home/#foo");
    gb.setURL("http://www.example.com/home/?bar");
    await sleep();
    expect(navigateMock.mock.calls.length).toBe(4);

    gb.destroy();
  });
});
