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
  // Optional gate on the matched flavor config. An entry that matches scope but
  // whose flavor is ineligible (archived, or missing from the resolvable set) is
  // skipped so a later matching entry can win — and an archived override cleanly
  // falls back to the next match / base instead of blocking the chain. Absent =
  // every matched entry is eligible.
  isEligible?: (configKey: string) => boolean,
): string | null {
  for (const entry of scopedOverrides ?? []) {
    const envMatch =
      !entry.environments?.length ||
      (context.environment != null &&
        entry.environments.includes(context.environment));
    const projMatch =
      !entry.projects?.length ||
      (context.project != null && entry.projects.includes(context.project));
    if (envMatch && projMatch) {
      if (isEligible && !isEligible(entry.config)) continue;
      return entry.config;
    }
  }
  return null;
}

// An empty/absent scope list is a wildcard for that dimension.
function isWildcardScope(list: string[] | undefined): boolean {
  return !list || list.length === 0;
}

// True when entry `a`'s scope covers every (environment, project) context that
// entry `b`'s scope covers — so under first-match-wins, `a` (placed earlier)
// always wins and `b` can never fire. A wildcard dimension on `a` covers any
// value; otherwise `b`'s (non-wildcard) set must be a subset of `a`'s.
function scopeSubsumes(
  a: ScopedOverrideEntry,
  b: ScopedOverrideEntry,
): boolean {
  const envCovers =
    isWildcardScope(a.environments) ||
    (!isWildcardScope(b.environments) &&
      b.environments!.every((e) => a.environments!.includes(e)));
  const projCovers =
    isWildcardScope(a.projects) ||
    (!isWildcardScope(b.projects) &&
      b.projects!.every((p) => a.projects!.includes(p)));
  return envCovers && projCovers;
}

// Structural problems in a config's scopedOverrides list that make it malformed
// regardless of what other configs exist: a self-reference (a config can't be
// its own flavor), an unreachable entry that an earlier entry already fully
// subsumes under first-match-wins (this also catches an exact duplicate), and
// any entry not in the supported single-environment shape (exactly one
// environment, no project scoping — project-only/multi-env/fallback overrides
// aren't offered yet). Does NOT check that referenced configs exist — that
// needs the config set and lives in the write-path service. Pure.
export function findScopedOverrideStructuralErrors(
  scopedOverrides: ScopedOverrideEntry[] | undefined,
  selfKey: string,
): string[] {
  const entries = scopedOverrides ?? [];
  const errors: string[] = [];
  entries.forEach((entry, j) => {
    if (entry.config === selfKey) {
      errors.push(
        `A config can't reference itself as a scoped override ("${selfKey}").`,
      );
    }
    if ((entry.environments?.length ?? 0) !== 1 || entry.projects?.length) {
      errors.push(
        `Scoped override #${j + 1} ("${entry.config}") must target exactly one ` +
          `environment and no project — other override scopes aren't supported yet.`,
      );
    }
    for (let i = 0; i < j; i++) {
      if (scopeSubsumes(entries[i], entry)) {
        errors.push(
          `Scoped override #${j + 1} ("${entry.config}") is unreachable: ` +
            `override #${i + 1} ("${entries[i].config}") already matches every ` +
            `environment/project it targets. Reorder or narrow the earlier entry.`,
        );
        break;
      }
    }
  });
  return errors;
}
