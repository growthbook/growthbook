// Capped at 0.5 because an equal control group is reserved alongside the holdout.
export const MAX_HOLDOUT_SIZE = 0.5;

export function holdoutSizeToCoverage(holdoutSize: number): number {
  return holdoutSize * 2;
}

export function coverageToHoldoutSize(coverage: number): number {
  return coverage / 2;
}
