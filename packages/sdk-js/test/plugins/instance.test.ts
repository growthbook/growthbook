import { GrowthBook, GrowthBookClient } from "../../src";
import {
  isFullGrowthBook,
  isGrowthBookClient,
} from "../../src/plugins/utils/instance";
import { sessionReplayPlugin } from "../../src/plugins/session-replay";

jest.mock("rrweb", () => ({ record: jest.fn() }));

describe("instance guards", () => {
  it("tell a full GrowthBook, a client, and a user-scoped instance apart", () => {
    const gb = new GrowthBook();
    const client = new GrowthBookClient();
    const scoped = client.createScopedInstance({ attributes: {} });

    expect(isFullGrowthBook(gb)).toBe(true);
    expect(isFullGrowthBook(client)).toBe(false);
    expect(isFullGrowthBook(scoped)).toBe(false);
    expect(isGrowthBookClient(client)).toBe(true);
    expect(isGrowthBookClient(gb)).toBe(false);
    expect(isGrowthBookClient(scoped)).toBe(false);

    gb.destroy();
    client.destroy();
  });

  it("session replay skips non-full instances with a warning instead of throwing", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const client = new GrowthBookClient();

    expect(() => sessionReplayPlugin()(client)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("needs a GrowthBook instance"),
    );

    warn.mockRestore();
    client.destroy();
  });
});
