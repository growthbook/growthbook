import { mergeSettings } from "../../src/plugins/utils/settings";

describe("mergeSettings", () => {
  it("applies layers in order with later layers winning", () => {
    expect(
      mergeSettings(
        { enabled: true, sampleRate: 1 },
        { sampleRate: 0.5 },
        { sampleRate: 0.1, enabled: false },
      ),
    ).toEqual({ enabled: false, sampleRate: 0.1 });
  });

  it("skips undefined values so a layer never clobbers earlier ones", () => {
    expect(
      mergeSettings(
        { enabled: true, sampleRate: 1 },
        { enabled: undefined, sampleRate: 0.5 },
        undefined,
      ),
    ).toEqual({ enabled: true, sampleRate: 0.5 });
  });

  it("deep-merges plain objects but replaces arrays", () => {
    expect(
      mergeSettings(
        { nested: { a: 1, b: 2 }, list: [1, 2, 3] } as Record<string, unknown>,
        { nested: { b: 3 }, list: [9] },
      ),
    ).toEqual({ nested: { a: 1, b: 3 }, list: [9] });
  });

  it("replaces when types differ instead of merging", () => {
    expect(
      mergeSettings({ value: { a: 1 } } as Record<string, unknown>, {
        value: 5,
      }),
    ).toEqual({ value: 5 });
  });
});
