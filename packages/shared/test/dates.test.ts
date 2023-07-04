import { dateStringArrayBetweenDates, getValidDate } from "../src/dates";

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

describe("dateStringArrayBetweenDates", () => {
  it("Creates correct date range by default", () => {
    const start = new Date(Date.UTC(2020, 0, 5, 10, 0, 0));
    const end = new Date(Date.UTC(2020, 0, 7, 10, 0, 0));

    expect(dateStringArrayBetweenDates(start, end)).toEqual([
      "'2020-01-05'",
      "'2020-01-06'",
      "'2020-01-07'",
    ]);
  });
  it("truncates correctly", () => {
    // start date is < 48 hours before end date, but we still
    // get all three days
    const start = new Date(Date.UTC(2020, 0, 5, 16, 0, 0));
    const end = new Date(Date.UTC(2020, 0, 7, 10, 0, 0));

    expect(dateStringArrayBetweenDates(start, end, false)).toEqual([
      "'2020-01-05'",
      "'2020-01-06'",
    ]);

    expect(dateStringArrayBetweenDates(start, end, true)).toEqual([
      "'2020-01-05'",
      "'2020-01-06'",
      "'2020-01-07'",
    ]);
  });

  it("Interval jumps correctly, starting with start date", () => {
    const start = new Date(Date.UTC(2020, 0, 5, 10, 0, 0));
    const end = new Date(Date.UTC(2020, 0, 7, 10, 0, 0));

    expect(dateStringArrayBetweenDates(start, end, true, 2)).toEqual([
      "'2020-01-05'",
      "'2020-01-07'",
    ]);
  });
});
