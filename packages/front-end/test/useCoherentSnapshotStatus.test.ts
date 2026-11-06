import { newestSnapshotStatus } from "@/hooks/useCoherentSnapshotStatus";

const status = (id: string, dateCreated: string) => ({
  id,
  dateCreated,
  status: "success",
});

describe("newestSnapshotStatus", () => {
  it("uses the heavy response when it observed a newer run", () => {
    const staleStatus = status("a", "2026-01-01T00:00:00.000Z");
    const newerHeavy = status("b", "2026-01-02T00:00:00.000Z");

    expect(newestSnapshotStatus(staleStatus, newerHeavy)).toBe(newerHeavy);
  });

  it("uses the status response when it observed a newer run", () => {
    const newerStatus = status("b", "2026-01-02T00:00:00.000Z");
    const staleHeavy = status("a", "2026-01-01T00:00:00.000Z");

    expect(newestSnapshotStatus(newerStatus, staleHeavy)).toBe(newerStatus);
  });

  it("returns whichever response is available", () => {
    const latest = status("a", "2026-01-01T00:00:00.000Z");

    expect(newestSnapshotStatus(latest, null)).toBe(latest);
    expect(newestSnapshotStatus(null, latest)).toBe(latest);
  });
});
