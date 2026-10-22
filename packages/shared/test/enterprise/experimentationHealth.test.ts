import { countHealthOverrides } from "../../src/enterprise/experimentationHealth";

describe("countHealthOverrides", () => {
  it("counts the quality fields a record sets", () => {
    expect(countHealthOverrides(null)).toBe(0);
    expect(countHealthOverrides({ quality: {} })).toBe(0);
    expect(
      countHealthOverrides({ quality: { enabled: false, config: {} } }),
    ).toBe(2);
  });
});
