// The URL counts phases from 1, as the phase selector labels them.
export function getPhaseFromUrl(
  search: string,
  phaseCount: number,
): number | null {
  const value = new URLSearchParams(search).get("phase");
  if (!value || !/^\d+$/.test(value)) return null;
  const phase = Number(value) - 1;
  return phase >= 0 && phase < phaseCount ? phase : null;
}
