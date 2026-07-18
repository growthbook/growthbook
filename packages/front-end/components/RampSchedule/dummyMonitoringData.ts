export type DummyScenario = "passing" | "failing" | "nodata";

export type DummyIssueProfile = {
  scenario: number;
  forceNoTraffic: boolean;
  forceLowTraffic: boolean;
  srmPValue: number;
  multipleExposureRate: number;
  userMultiplier: number;
};

export function seededRandom(seed: number) {
  let s = Math.floor(seed) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

export function getDummySeed(
  dummySeedQuery: string | string[] | undefined,
  fallbackKey: string,
): number {
  const str = Array.isArray(dummySeedQuery)
    ? dummySeedQuery[0]
    : dummySeedQuery;
  if (typeof str === "string" && str.trim()) {
    const parsed = Number(str);
    if (Number.isFinite(parsed)) return parsed;
    return hashString(str);
  }
  return hashString(fallbackKey);
}

export function buildDummyIssueProfile(seed: number): DummyIssueProfile {
  const rand = seededRandom(seed ^ 0x9e3779b1);
  const scenario = Math.floor(rand() * 8);

  switch (scenario) {
    case 0:
      return {
        scenario,
        forceNoTraffic: false,
        forceLowTraffic: false,
        srmPValue: 0.35 + rand() * 0.4,
        multipleExposureRate: rand() * 0.01,
        userMultiplier: 1,
      };
    case 1:
      return {
        scenario,
        forceNoTraffic: false,
        forceLowTraffic: false,
        srmPValue: 0.0005 + rand() * 0.004,
        multipleExposureRate: rand() * 0.01,
        userMultiplier: 1,
      };
    case 2:
      return {
        scenario,
        forceNoTraffic: false,
        forceLowTraffic: false,
        srmPValue: 0.2 + rand() * 0.5,
        multipleExposureRate: 0.2 + rand() * 0.35,
        userMultiplier: 1,
      };
    case 3:
      return {
        scenario,
        forceNoTraffic: false,
        forceLowTraffic: false,
        srmPValue: 0.0005 + rand() * 0.004,
        multipleExposureRate: 0.2 + rand() * 0.35,
        userMultiplier: 1,
      };
    case 4:
      return {
        scenario,
        forceNoTraffic: false,
        forceLowTraffic: true,
        srmPValue: 0.2 + rand() * 0.5,
        multipleExposureRate: 0.02 + rand() * 0.05,
        userMultiplier: 0.04,
      };
    case 5:
      return {
        scenario,
        forceNoTraffic: false,
        forceLowTraffic: true,
        srmPValue: 0.0005 + rand() * 0.004,
        multipleExposureRate: 0.02 + rand() * 0.05,
        userMultiplier: 0.04,
      };
    case 6:
      return {
        scenario,
        forceNoTraffic: false,
        forceLowTraffic: true,
        srmPValue: 0.2 + rand() * 0.5,
        multipleExposureRate: 0.2 + rand() * 0.35,
        userMultiplier: 0.04,
      };
    default:
      return {
        scenario,
        forceNoTraffic: true,
        forceLowTraffic: false,
        srmPValue: 0.3 + rand() * 0.4,
        multipleExposureRate: 0,
        userMultiplier: 0,
      };
  }
}

export function buildDummyScenarios(
  metricIds: string[],
  seed: number,
  profile: DummyIssueProfile,
): DummyScenario[] {
  if (profile.forceNoTraffic) return metricIds.map(() => "nodata");
  if (profile.scenario === 0) return metricIds.map(() => "passing");

  const rand = seededRandom(seed ^ 0x7f4a7c15);
  const scenarios: DummyScenario[] = metricIds.map(() => {
    const roll = rand();
    if (roll < 0.3) return "failing";
    if (roll < 0.45) return "nodata";
    return "passing";
  });

  if (scenarios.length > 0 && !scenarios.includes("failing")) {
    scenarios[0] = "failing";
  }
  return scenarios;
}
