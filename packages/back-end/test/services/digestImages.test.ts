import {
  createDigestImageData,
  digestRangeLabel,
} from "back-end/src/services/notificationCards/digestImages";

const event = (event: string, id: string) => ({
  event,
  data: {
    data: { object: { experimentId: id, experimentName: `Experiment ${id}` } },
  },
});
it("counts immutable activity without inventing shipped wins or metric lifts", () => {
  const data = createDigestImageData("This period");
  data.add(event("experiment.started", "one"));
  data.add(event("experiment.stopped", "two"));
  data.add(event("experiment.info.significance", "three"));
  data.add(event("experiment.warning", "four"));
  data.add(event("experiment.decision.ship", "five"));
  expect(data.scorecard.stats).toEqual({
    started: 1,
    stopped: 1,
    significant: 1,
    warnings: 1,
  });
  expect(data.scorecard.highlight).toBeUndefined();
  expect(data.scorecard.cumWins).toBeUndefined();
  expect(data.scorecard.notable.every((row) => !row.lift)).toBe(true);
});
it("keeps bounded examples while counting every activity event", () => {
  const data = createDigestImageData("This period");
  for (let i = 0; i < 500; i++) {
    data.add(event("experiment.started", String(i)));
    data.add({ event: "feature.revision.published", objectId: `flag${i}` });
  }
  expect(data.scorecard.stats.started).toBe(500);
  expect(data.scorecard.notable).toHaveLength(8);
  expect(data.feature.counts.published).toBe(500);
  expect(data.feature.publishedFlags).toHaveLength(6);
});
it("uses actual feature activity event names and flag identity", () => {
  const data = createDigestImageData("This period");
  data.add({
    event: "feature.revision.approved",
    data: { data: { object: { featureId: "flag" } } },
  });
  data.add({ event: "feature.saferollout.rollback", objectId: "flag" });
  expect(data.feature.counts.reviewApproved).toBe(1);
  expect(data.feature.needsAttentionFlags).toEqual([
    { key: "flag", reason: "rollback" },
  ]);
});
it("formats digest windows in UTC independent of the host timezone", () => {
  expect(
    digestRangeLabel(
      new Date("2026-03-01T00:00:00Z"),
      new Date("2026-04-01T00:00:00Z"),
    ),
  ).toBe("Mar 1, 2026 – Apr 1, 2026 (UTC)");
});
it.each(["experiment", "feature"] as const)(
  "renders a real %s digest PNG from activity",
  async (kind) => {
    const data = createDigestImageData("Sep 1 – Sep 7, 2026");
    data.add(event("experiment.started", "one"));
    data.add({ event: "feature.revision.published", objectId: "checkout" });
    expect((await data.render(kind)).subarray(0, 8).toString("hex")).toBe(
      "89504e470d0a1a0a",
    );
  },
);
