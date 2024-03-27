import { GrowthBook } from "../src";
import { sleep } from "./visual-changes.test";

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
      "http://www.example.com/home-new"
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
      "http://www.example.com/home-new"
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
});
