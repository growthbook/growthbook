import {
  EXPERIMENT_QUALITY_CHECKS,
  customQualityCheckKey,
  getChecksForSection,
  reflowShares,
  resolveExperimentQualityScoreSettings,
  roundToTotal,
} from "shared/enterprise";
import {
  ExperimentQualityCheckKey,
  ExperimentQualityCheckParams,
  ExperimentQualityConfigBody,
  ExperimentQualitySectionKey,
  experimentQualityCheckKeys,
  experimentQualitySectionKeys,
} from "shared/validators";

// Editable form state for one quality configuration. Weights are integer
// percentages: enabled sections total 100, and within each section the
// enabled members of its pool (its checks, plus custom AI rules in the AI
// section) total 100.
export interface QualityConfigDraft {
  // The stored on/off intent per section (the AI section's is
  // `aiChecksEnabled` in the stored config)
  sectionEnabled: Record<ExperimentQualitySectionKey, boolean>;
  sections: Record<ExperimentQualitySectionKey, { weight: number }>;
  checks: Record<
    ExperimentQualityCheckKey,
    {
      enabled: boolean;
      weight: number;
      params?: ExperimentQualityCheckParams;
      aiContext?: string;
    }
  >;
  customAiChecks: Array<{
    id: string;
    name: string;
    rule: string;
    enabled: boolean;
    weight: number;
  }>;
}

type DraftCheck = QualityConfigDraft["checks"][ExperimentQualityCheckKey];
type CustomCheck = QualityConfigDraft["customAiChecks"][number];

// --- Pools: the members sharing a section's 100% split ----------------------

type PoolMember = { key: string; enabled: boolean; weight: number };

function getPool(
  draft: QualityConfigDraft,
  section: ExperimentQualitySectionKey,
): PoolMember[] {
  return [
    ...getChecksForSection(section).map((key) => ({
      key,
      enabled: draft.checks[key].enabled,
      weight: draft.checks[key].weight,
    })),
    ...(section === "ai"
      ? draft.customAiChecks.map((c) => ({
          key: customQualityCheckKey(c.id),
          enabled: c.enabled,
          weight: c.weight,
        }))
      : []),
  ];
}

function withWeights(
  draft: QualityConfigDraft,
  weights: Record<string, number>,
): QualityConfigDraft {
  const checks = { ...draft.checks };
  for (const key of experimentQualityCheckKeys) {
    if (key in weights) checks[key] = { ...checks[key], weight: weights[key] };
  }
  return {
    ...draft,
    checks,
    customAiChecks: draft.customAiChecks.map((c) => {
      const key = customQualityCheckKey(c.id);
      return key in weights ? { ...c, weight: weights[key] } : c;
    }),
  };
}

function normalizePool(
  draft: QualityConfigDraft,
  section: ExperimentQualitySectionKey,
): QualityConfigDraft {
  const enabled = getPool(draft, section).filter((m) => m.enabled);
  const weights = roundToTotal(enabled.map((m) => m.weight || 1));
  return withWeights(
    draft,
    Object.fromEntries(enabled.map((m, i) => [m.key, weights[i]])),
  );
}

function normalizeSections(draft: QualityConfigDraft): QualityConfigDraft {
  const enabled = getEnabledSectionKeys(draft);
  const weights = roundToTotal(
    enabled.map((k) => draft.sections[k].weight || 1),
  );
  const sections = { ...draft.sections };
  enabled.forEach((k, i) => {
    sections[k] = { weight: weights[i] };
  });
  return { ...draft, sections };
}

// --- Conversions -------------------------------------------------------------

// Expand a stored config (undefined for the built-in default) into a draft
export function configToDraft(
  stored?: ExperimentQualityConfigBody | null,
): QualityConfigDraft {
  const resolved = resolveExperimentQualityScoreSettings(stored);
  let draft: QualityConfigDraft = {
    sectionEnabled: Object.fromEntries(
      experimentQualitySectionKeys.map((k) => [
        k,
        k === "ai"
          ? (stored?.aiChecksEnabled ?? true)
          : (stored?.sections?.[k]?.enabled ?? true),
      ]),
    ) as QualityConfigDraft["sectionEnabled"],
    sections: Object.fromEntries(
      experimentQualitySectionKeys.map((k) => [
        k,
        { weight: resolved.sections[k].rawWeight },
      ]),
    ) as QualityConfigDraft["sections"],
    checks: Object.fromEntries(
      experimentQualityCheckKeys.map((k) => [
        k,
        {
          enabled:
            stored?.checks?.[k]?.enabled ??
            EXPERIMENT_QUALITY_CHECKS[k].defaultEnabled,
          weight: resolved.checks[k].rawWeight,
          params: resolved.checks[k].params,
          aiContext: resolved.checks[k].aiContext,
        },
      ]),
    ) as QualityConfigDraft["checks"],
    customAiChecks: resolved.customAiChecks.map((c, i) => ({
      id: c.id,
      name: c.name,
      rule: c.rule,
      enabled: stored?.customAiChecks?.[i]?.enabled ?? true,
      weight: c.rawWeight,
    })),
  };

  for (const section of experimentQualitySectionKeys) {
    draft = normalizePool(draft, section);
    // Disabled members get an equal share to start from if re-enabled
    const pool = getPool(draft, section);
    const equalShare = Math.round(100 / pool.length);
    draft = withWeights(
      draft,
      Object.fromEntries(
        pool.filter((m) => !m.enabled).map((m) => [m.key, equalShare]),
      ),
    );
  }
  return normalizeSections(draft);
}

export function draftToConfig(
  draft: QualityConfigDraft,
): ExperimentQualityConfigBody {
  const sections: ExperimentQualityConfigBody["sections"] = {};
  for (const key of experimentQualitySectionKeys) {
    sections[key] = {
      ...(key !== "ai" ? { enabled: draft.sectionEnabled[key] } : {}),
      weight: draft.sections[key].weight,
    };
  }
  const checks: ExperimentQualityConfigBody["checks"] = {};
  for (const key of experimentQualityCheckKeys) {
    const c = draft.checks[key];
    checks[key] = {
      enabled: c.enabled,
      weight: c.weight,
      ...(c.params ? { params: c.params } : {}),
      ...(c.aiContext?.trim() ? { aiContext: c.aiContext } : {}),
    };
  }
  return {
    aiChecksEnabled: draft.sectionEnabled.ai,
    sections,
    checks,
    // Always sent, so saving with no custom checks clears earlier ones
    customAiChecks: draft.customAiChecks.map((c) => ({
      ...c,
      name: c.name.trim() || "Custom check",
    })),
  };
}

// --- Queries -----------------------------------------------------------------

// Sections that take part in the 100% split: switched on with an enabled check
export function getEnabledSectionKeys(
  draft: QualityConfigDraft,
): ExperimentQualitySectionKey[] {
  const resolved = resolveExperimentQualityScoreSettings(draftToConfig(draft));
  return experimentQualitySectionKeys.filter(
    (k) => resolved.sections[k].enabled,
  );
}

export function countEnabledChecks(
  draft: QualityConfigDraft,
  section: ExperimentQualitySectionKey,
): number {
  return getPool(draft, section).filter((m) => m.enabled).length;
}

// A config is saveable only if at least one check would count
export function isDegenerateDraft(draft: QualityConfigDraft): boolean {
  return getEnabledSectionKeys(draft).length === 0;
}

// --- Edits -------------------------------------------------------------------

// Drag a section's share; the other enabled sections re-flow to total 100
export function reflowSectionWeights(
  draft: QualityConfigDraft,
  section: ExperimentQualitySectionKey,
  newPct: number,
): QualityConfigDraft {
  const enabled = getEnabledSectionKeys(draft);
  const index = enabled.indexOf(section);
  if (index < 0) return draft;
  const weights = reflowShares(
    enabled.map((k) => draft.sections[k].weight),
    index,
    newPct,
  );
  const sections = { ...draft.sections };
  enabled.forEach((k, i) => {
    sections[k] = { weight: weights[i] };
  });
  return { ...draft, sections };
}

// Drag a check's or custom rule's split (by result key); the other enabled
// members of its section re-flow to total 100
export function reflowMemberWeights(
  draft: QualityConfigDraft,
  section: ExperimentQualitySectionKey,
  key: string,
  newPct: number,
): QualityConfigDraft {
  const enabled = getPool(draft, section).filter((m) => m.enabled);
  const index = enabled.findIndex((m) => m.key === key);
  if (index < 0) return draft;
  const weights = reflowShares(
    enabled.map((m) => m.weight),
    index,
    newPct,
  );
  return withWeights(
    draft,
    Object.fromEntries(enabled.map((m, i) => [m.key, weights[i]])),
  );
}

// Any membership change re-splits the section and re-flows the sections
function rebalance(
  draft: QualityConfigDraft,
  section: ExperimentQualitySectionKey,
): QualityConfigDraft {
  return normalizeSections(normalizePool(draft, section));
}

export function updateCheck(
  draft: QualityConfigDraft,
  key: ExperimentQualityCheckKey,
  updates: Partial<DraftCheck>,
): QualityConfigDraft {
  const next = {
    ...draft,
    checks: { ...draft.checks, [key]: { ...draft.checks[key], ...updates } },
  };
  return "enabled" in updates
    ? rebalance(next, EXPERIMENT_QUALITY_CHECKS[key].section)
    : next;
}

export function updateCustomCheck(
  draft: QualityConfigDraft,
  id: string,
  updates: Partial<Pick<CustomCheck, "name" | "rule" | "enabled">>,
): QualityConfigDraft {
  const next = {
    ...draft,
    customAiChecks: draft.customAiChecks.map((c) =>
      c.id === id ? { ...c, ...updates } : c,
    ),
  };
  return "enabled" in updates ? rebalance(next, "ai") : next;
}

export function addCustomCheck(draft: QualityConfigDraft): QualityConfigDraft {
  const id = `rule_${Math.random().toString(36).slice(2, 10)}`;
  return rebalance(
    {
      ...draft,
      customAiChecks: [
        ...draft.customAiChecks,
        { id, name: "", rule: "", enabled: true, weight: 1 },
      ],
    },
    "ai",
  );
}

export function removeCustomCheck(
  draft: QualityConfigDraft,
  id: string,
): QualityConfigDraft {
  return rebalance(
    {
      ...draft,
      customAiChecks: draft.customAiChecks.filter((c) => c.id !== id),
    },
    "ai",
  );
}

export function setSectionEnabled(
  draft: QualityConfigDraft,
  section: ExperimentQualitySectionKey,
  enabled: boolean,
): QualityConfigDraft {
  return normalizeSections({
    ...draft,
    sectionEnabled: { ...draft.sectionEnabled, [section]: enabled },
  });
}
