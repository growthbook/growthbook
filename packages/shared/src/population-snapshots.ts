// Charts plot one point per day, so repeated refreshes on the same UTC day
// collapse to the last successful one.
export function getDailyPopulationSnapshots<
  T extends { asOf: Date; status: string },
>(snapshots: T[]): T[] {
  const byDay = new Map<string, T>();
  for (const snapshot of snapshots) {
    if (snapshot.status !== "success") continue;
    const day = snapshot.asOf.toISOString().slice(0, 10);
    const existing = byDay.get(day);
    if (!existing || existing.asOf < snapshot.asOf) {
      byDay.set(day, snapshot);
    }
  }
  return [...byDay.values()].sort(
    (a, b) => a.asOf.getTime() - b.asOf.getTime(),
  );
}
