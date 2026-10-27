import { MongoCallStats } from "back-end/src/util/mongoCallStats";

describe("MongoCallStats", () => {
  it("reports zeros when nothing ran", () => {
    expect(new MongoCallStats().summary(100)).toEqual({
      calls: 0,
      sequential: 0,
      wallMs: 0,
    });
  });

  it("chains commands that start after the previous one ended", () => {
    const stats = new MongoCallStats();
    stats.end(stats.start(0), 10);
    stats.end(stats.start(15), 20);
    stats.end(stats.start(20), 25);
    expect(stats.summary(30)).toEqual({
      calls: 3,
      sequential: 3,
      wallMs: 20,
    });
  });

  it("does not chain or double count overlapping commands", () => {
    const stats = new MongoCallStats();
    const a = stats.start(0);
    const b = stats.start(2);
    const c = stats.start(4);
    stats.end(b, 6);
    stats.end(a, 8);
    stats.end(c, 10);
    expect(stats.summary(10)).toEqual({
      calls: 3,
      sequential: 1,
      wallMs: 10,
    });
  });

  it("takes the longest chain across parallel branches", () => {
    const stats = new MongoCallStats();
    const slow = stats.start(0);
    stats.end(stats.start(0), 1);
    const second = stats.start(2);
    stats.end(second, 3);
    const third = stats.start(4);
    stats.end(slow, 5);
    stats.end(third, 6);
    // Starts after slow (chain 1) and third (chain 3) ended
    stats.end(stats.start(7), 8);
    expect(stats.summary(8)).toEqual({
      calls: 5,
      sequential: 4,
      wallMs: 7,
    });
  });

  it("only counts time with a command outstanding", () => {
    const stats = new MongoCallStats();
    stats.end(stats.start(0), 1.234);
    stats.end(stats.start(100), 101.12);
    expect(stats.summary(200).wallMs).toBe(2.35);
  });

  it("includes commands still outstanding at summary time", () => {
    const stats = new MongoCallStats();
    stats.end(stats.start(0), 5);
    stats.start(10);
    expect(stats.summary(13)).toEqual({
      calls: 2,
      sequential: 2,
      wallMs: 8,
    });
  });
});
