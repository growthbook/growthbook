// Only self-hosted builds have a commit; without one there's nothing to
// show.
export function buildVersionLabel(build: {
  sha: string;
  lastVersion: string;
}): string | null {
  if (!build.sha) return null;
  const sha = build.sha.substring(0, 7);
  return build.lastVersion ? `${build.lastVersion}+${sha}` : sha;
}
