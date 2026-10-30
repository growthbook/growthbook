export type BuildVersion = {
  /** What the Help menu shows and copies, e.g. "4.2.0+bd13c78". */
  label: string;
  /** The build's day, YYYY-MM-DD. */
  date: string | null;
  commitUrl: string;
};

export function buildVersion(build: {
  sha: string;
  date: string;
  lastVersion: string;
}): BuildVersion | null {
  if (!build.sha) return null;
  const sha = build.sha.substring(0, 7);
  return {
    label: build.lastVersion ? `${build.lastVersion}+${sha}` : sha,
    date: build.date ? build.date.substring(0, 10) : null,
    commitUrl: `https://github.com/growthbook/growthbook/commit/${build.sha}`,
  };
}
