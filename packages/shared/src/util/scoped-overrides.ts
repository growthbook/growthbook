// Leaf module (imports nothing) so both the editor/validation resolver
// (util/configs) and the SDK payload resolver (sdk-versioning/resolveConstants)
// can share the flavor-selection primitive without a runtime import cycle
// (util/configs → util/features → sdk-versioning would otherwise close a loop).

// One entry in a config's ordered scopedOverrides selection list; mirrors
// scopedOverrideValidator (shared/validators/config).
export type ScopedOverrideEntry = {
  config: string;
  environments?: string[];
  projects?: string[];
};

// The first scoped-override whose scope matches the (environment, project) context
// — first-match-wins, array order = precedence. An empty/absent environments (or
// projects) list is a wildcard for that dimension. Returns the matched flavor
// config key, or null when nothing applies. Pure.
export function selectScopedOverride(
  scopedOverrides: ScopedOverrideEntry[] | undefined,
  context: { environment?: string; project?: string },
): string | null {
  for (const entry of scopedOverrides ?? []) {
    const envMatch =
      !entry.environments?.length ||
      (context.environment != null &&
        entry.environments.includes(context.environment));
    const projMatch =
      !entry.projects?.length ||
      (context.project != null && entry.projects.includes(context.project));
    if (envMatch && projMatch) return entry.config;
  }
  return null;
}
