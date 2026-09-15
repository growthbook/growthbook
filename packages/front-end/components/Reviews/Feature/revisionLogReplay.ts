import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { NON_CONTENT_ACTIONS } from "./CoAuthors";

// ─── Log replay engine ────────────────────────────────────────────────────────
// Each log entry is a patch on top of the base revision. We replay them in
// order to reconstruct the exact full-field state before and after each edit,
// so the diff shows the rule *in context* (whole env array) rather than in
// isolation. Shared by CompareRevisionsModal's drill-down panel and the
// ReviewAndPublish change-history list.

// Internal per-env bucketed view used by the log replay engine. This is
// decoupled from `FeatureRevisionInterface["rules"]` (which is v2-flat):
// logs reference rules by env+index, so the replay bookkeeping reconstructs
// the per-env state before projecting back to a flat v2 array for display.
type ReplayState = {
  rules: Record<string, FeatureRevisionRule[]>;
  defaultValue: FeatureRevisionInterface["defaultValue"];
  prerequisites: NonNullable<FeatureRevisionInterface["prerequisites"]>;
  environmentsEnabled: NonNullable<
    FeatureRevisionInterface["environmentsEnabled"]
  >;
};

type FeatureRevisionRule = NonNullable<
  FeatureRevisionInterface["rules"]
>[number];

// Project a flat v2 rules array into per-env buckets for log replay. Revision
// logs index rules by env+position (legacy format — see `envsFromSubject`),
// so replay needs a per-env projection of the flat array.
//
// Bucketing rules:
//   - allEnvironments:true      → appears in every env bucket (org envs derived
//                                 from `environmentsEnabled` + any env
//                                 explicitly mentioned by other rules).
//   - environments:[a,b]        → appears in a's and b's buckets.
//   - environments:[]           → pending rule, appears nowhere (unaddressable
//                                 by env+position log format; only visible in
//                                 the direct draft/live diff).
//   - environments:undefined    → permissive fallback, same as
//                                 allEnvironments:true.
//
// Preserves flat-array order within each bucket so positional replay remains
// correct even when global and env-scoped rules are interleaved.
function bucketRevisionRulesByEnv(
  rules: FeatureRevisionInterface["rules"] | null | undefined,
  knownEnvs: string[] = [],
): Record<string, FeatureRevisionRule[]> {
  const out: Record<string, FeatureRevisionRule[]> = {};
  if (!Array.isArray(rules)) return out;

  // Seed every known env so even envs with no explicitly-scoped rules still
  // receive all-env rules.
  for (const e of knownEnvs) out[e] = out[e] ?? [];

  for (const r of rules) {
    let envs: string[];
    if (r.allEnvironments || r.environments === undefined) {
      envs = Array.from(new Set([...knownEnvs, ...Object.keys(out)]));
    } else {
      envs = r.environments;
    }
    if (envs.length === 0) continue;
    for (const e of envs) {
      out[e] = out[e] ?? [];
      out[e].push(r);
    }
  }
  return out;
}

function initialReplayState(
  base: FeatureRevisionInterface | null,
): ReplayState {
  // Seed the bucketing with every env that was referenced in the revision's
  // own environmentsEnabled map so `allEnvironments: true` rules are placed
  // into each bucket (otherwise they would only appear in envs referenced by
  // some OTHER env-scoped rule).
  const knownEnvs = Object.keys(base?.environmentsEnabled ?? {});
  return {
    rules: bucketRevisionRulesByEnv(base?.rules, knownEnvs),
    defaultValue: base?.defaultValue ?? "",
    prerequisites: base?.prerequisites ?? [],
    environmentsEnabled: base?.environmentsEnabled ?? {},
  };
}

/**
 * Extract all env names from a rule operation subject:
 *   edit rule:   "<env> rule <i>"        → [env]
 *   add rule:    "to <env1>, <env2>, …"  → [env1, env2, …]
 *   delete rule: "in <env> (position X)" → [env]
 *   move rule:   "in <env> from pos X→Y" → [env]
 */
function envsFromSubject(action: string, subject: string): string[] {
  if (action.startsWith("edit rule")) {
    const m = subject.match(/^(.+?)\s+rule\s+\d+/);
    return m ? [m[1]] : [];
  }
  if (action.startsWith("add rule")) {
    const m = subject.match(/^to\s+(.+)$/);
    return m ? m[1].split(",").map((e) => e.trim()) : [];
  }
  if (action === "delete rule" || action.startsWith("move rule")) {
    const m = subject.match(/^in\s+(.+?)(?:\s+\(|\s+from)/);
    return m ? [m[1].trim()] : [];
  }
  return [];
}

function applyLogEntry(state: ReplayState, log: RevisionLog): ReplayState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(log.value);
  } catch {
    parsed = log.value;
  }

  const envs = envsFromSubject(log.action, log.subject);
  const rules = { ...state.rules };

  if (log.action.startsWith("add rule") && envs.length) {
    for (const env of envs) {
      rules[env] = [...(rules[env] ?? []), parsed as FeatureRevisionRule];
    }
    return { ...state, rules };
  }

  if (log.action === "delete rule" && envs.length) {
    const env = envs[0];
    // subject: "in <env> (position X)" — 1-indexed
    const m = log.subject.match(/\(position (\d+)\)/);
    const pos = m ? parseInt(m[1]) - 1 : -1;
    if (pos >= 0) {
      rules[env] = (rules[env] ?? []).filter((_, i) => i !== pos);
    }
    return { ...state, rules };
  }

  if (log.action.startsWith("edit rule") && envs.length) {
    const env = envs[0];
    // subject: "<env> rule X" — 0-indexed
    const m = log.subject.match(/rule (\d+)$/);
    const idx = m ? parseInt(m[1]) : -1;
    if (idx >= 0) {
      const arr = [...(rules[env] ?? [])];
      arr[idx] = { ...arr[idx], ...(parsed as object) } as (typeof arr)[number];
      rules[env] = arr;
    }
    return { ...state, rules };
  }

  if (log.action.startsWith("move rule") && envs.length) {
    const env = envs[0];
    // subject: "in <env> from position X to Y" — 1-indexed
    const m = log.subject.match(/from position (\d+) to (\d+)/);
    if (m) {
      const from = parseInt(m[1]) - 1;
      const to = parseInt(m[2]) - 1;
      const arr = [...(rules[env] ?? [])];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      rules[env] = arr;
    }
    return { ...state, rules };
  }

  if (log.action === "edit defaultValue") {
    return {
      ...state,
      defaultValue:
        typeof parsed === "string" ? parsed : JSON.stringify(parsed),
    };
  }

  if (log.action === "rebase") {
    // The rebase log stores `mergeResult.result`, where `rules` is the flat
    // v2 array — not the per-env buckets ReplayState uses. Re-bucket it so
    // rule entries replayed after the rebase still resolve by env+position.
    const r = parsed as Partial<
      Omit<ReplayState, "rules"> & {
        rules: FeatureRevisionInterface["rules"];
      }
    >;
    const environmentsEnabled =
      r.environmentsEnabled ?? state.environmentsEnabled;
    return {
      rules: Array.isArray(r.rules)
        ? bucketRevisionRulesByEnv(
            r.rules,
            Array.from(
              new Set([
                ...Object.keys(environmentsEnabled),
                ...Object.keys(state.rules),
              ]),
            ),
          )
        : state.rules,
      defaultValue: r.defaultValue ?? state.defaultValue,
      prerequisites: r.prerequisites ?? state.prerequisites,
      environmentsEnabled,
    };
  }

  return state;
}

// Recursively parse JSON-string fields (condition, value, prerequisites[].condition)
// so the diff viewer shows structured objects rather than escaped string blobs.
function parseFeatureJsonFields(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(parseFeatureJsonFields);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if ((k === "condition" || k === "value") && typeof v === "string") {
        try {
          result[k] = parseFeatureJsonFields(JSON.parse(v));
        } catch {
          result[k] = v;
        }
      } else {
        result[k] = parseFeatureJsonFields(v);
      }
    }
    return result;
  }
  return obj;
}

/**
 * Replay all content logs up to (exclusive) the given entry, then apply it.
 * Returns the a/b strings for ExpandableDiff scoped to the affected field so
 * the diff shows full context. `allLogs` must be sorted oldest-first.
 */
export function computeBeforeAfter(
  log: RevisionLog,
  allLogs: RevisionLog[],
  logIndex: number,
  baseRevision: FeatureRevisionInterface | null,
): { a: string; b: string; title: string } | null {
  const title = log.subject ? `${log.action} · ${log.subject}` : log.action;

  const contentLogs = allLogs.filter((l) => !NON_CONTENT_ACTIONS.has(l.action));
  const priorContentIdx = contentLogs.indexOf(log);
  const priorLogs =
    priorContentIdx >= 0
      ? contentLogs.slice(0, priorContentIdx)
      : allLogs
          .slice(0, logIndex)
          .filter((l) => !NON_CONTENT_ACTIONS.has(l.action));

  const stateBefore = priorLogs.reduce(
    applyLogEntry,
    initialReplayState(baseRevision),
  );
  const stateAfter = applyLogEntry(stateBefore, log);

  const pp = (v: unknown) => JSON.stringify(parseFeatureJsonFields(v), null, 2);

  const envs = envsFromSubject(log.action, log.subject);
  const env = envs[0];

  if (
    log.action.startsWith("edit rule") ||
    log.action.startsWith("add rule") ||
    log.action === "delete rule" ||
    log.action.startsWith("move rule")
  ) {
    if (!env) return null;
    return {
      a: pp(stateBefore.rules[env] ?? []),
      b: pp(stateAfter.rules[env] ?? []),
      title,
    };
  }

  if (log.action === "edit defaultValue") {
    return {
      a: pp(stateBefore.defaultValue),
      b: pp(stateAfter.defaultValue),
      title,
    };
  }

  if (log.action === "rebase") {
    return { a: pp(stateBefore), b: pp(stateAfter), title };
  }

  // Fallback: just show the raw value as "after"
  try {
    return { a: "", b: pp(JSON.parse(log.value)), title };
  } catch {
    return { a: "", b: log.value, title };
  }
}
