import {
  dateStringArrayBetweenDates,
  getValidDate,
  resolveScheduleStopAfter,
  resolveScheduledStop,
} from "../src/dates";

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

describe("resolveScheduleStopAfter", () => {
  it("adds days", () => {
    const base = new Date(Date.UTC(2020, 0, 5, 10, 0, 0));
    expect(resolveScheduleStopAfter(base, { value: 14, unit: "days" })).toEqual(
      new Date(Date.UTC(2020, 0, 19, 10, 0, 0)),
    );
  });

  it("adds hours", () => {
    const base = new Date(Date.UTC(2020, 0, 5, 10, 0, 0));
    expect(resolveScheduleStopAfter(base, { value: 6, unit: "hours" })).toEqual(
      new Date(Date.UTC(2020, 0, 5, 16, 0, 0)),
    );
  });

  it("truncates seconds and milliseconds", () => {
    const base = new Date(Date.UTC(2020, 0, 5, 10, 30, 45, 123));
    const result = resolveScheduleStopAfter(base, { value: 1, unit: "days" });
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });
});

describe("resolveScheduledStop", () => {
  const base = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));
  const now = new Date(Date.UTC(2020, 0, 2, 0, 0, 0));

  it("keeps an absolute stopAt and stages it when active + future", () => {
    const future = new Date(Date.UTC(2020, 0, 10, 0, 0, 0));
    const r = resolveScheduledStop({
      stopAt: future,
      base,
      active: true,
      now,
    });
    expect(r.stopAt).toEqual(future);
    expect(r.stopAfter).toBeNull();
    expect(r.stagedStop).toEqual({ type: "stop", date: future });
  });

  it("does not stage an absolute stopAt when inactive", () => {
    const future = new Date(Date.UTC(2020, 0, 10, 0, 0, 0));
    const r = resolveScheduledStop({
      stopAt: future,
      base,
      active: false,
      now,
    });
    expect(r.stopAt).toEqual(future);
    expect(r.stagedStop).toBeNull();
  });

  it("does not stage a past stopAt even when active", () => {
    const past = new Date(Date.UTC(2019, 0, 1, 0, 0, 0));
    const r = resolveScheduledStop({ stopAt: past, base, active: true, now });
    expect(r.stopAt).toEqual(past);
    expect(r.stagedStop).toBeNull();
  });

  it("resolves a relative stopAfter off base and stages it when active", () => {
    const r = resolveScheduledStop({
      stopAfter: { value: 7, unit: "days" },
      base,
      active: true,
      now,
    });
    expect(r.stopAt).toEqual(new Date(Date.UTC(2020, 0, 8, 0, 0, 0)));
    expect(r.stopAfter).toBeNull();
    expect(r.stagedStop).toEqual({
      type: "stop",
      date: new Date(Date.UTC(2020, 0, 8, 0, 0, 0)),
    });
  });

  it("defers a relative stopAfter when inactive (draft)", () => {
    const r = resolveScheduledStop({
      stopAfter: { value: 7, unit: "days" },
      base,
      active: false,
      now,
    });
    expect(r.stopAt).toBeNull();
    expect(r.stopAfter).toEqual({ value: 7, unit: "days" });
    expect(r.stagedStop).toBeNull();
  });

  it("returns nulls when no end is set", () => {
    const r = resolveScheduledStop({ base, active: true, now });
    expect(r.stopAt).toBeNull();
    expect(r.stopAfter).toBeNull();
    expect(r.stagedStop).toBeNull();
  });
});
