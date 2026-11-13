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

// The latest phase is the default, so it leaves the param out.
export function urlWithPhase(
  href: string,
  phase: number,
  phaseCount: number,
): string {
  const url = new URL(href);
  if (phase === phaseCount - 1) {
    url.searchParams.delete("phase");
  } else {
    url.searchParams.set("phase", String(phase + 1));
  }
  return url.toString();
}
