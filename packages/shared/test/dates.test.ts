import { getValidDate } from "../src/dates";

describe("getValidDate", () => {
  it("Uses the fallback", () => {
    const fallback = new Date(2020, 1, 5, 10, 0, 0);

    expect(getValidDate(null, fallback)).toEqual(fallback);
    expect(getValidDate(0, fallback)).toEqual(fallback);
    expect(getValidDate("fdsahkjdfhakfa", fallback)).toEqual(fallback);
  });

  it("Parses dates correctly", () => {
    const fallback = new Date(2020, 1, 5, 10, 0, 0);
    const d = new Date(2018, 3, 1, 5, 6, 7);
    const t = d.getTime();

    expect(getValidDate(d, fallback)).toEqual(d);
    expect(getValidDate(t, fallback)).toEqual(d);
    expect(getValidDate(d.toISOString(), fallback)).toEqual(d);
  });
});
