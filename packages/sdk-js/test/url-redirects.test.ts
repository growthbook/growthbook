import { GrowthBook } from "../src";
import { sleep } from "./visual-changes.test";

describe("urlRedirects", () => {
  const realLocation = window.location;

  beforeAll(() => {
    // @ts-expect-error: Ignoring operand for delete operator needing to be optional for testing
    delete window.location;
    window.location = { ...realLocation, replace: jest.fn() };
  });

  afterAll(() => {
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
});
