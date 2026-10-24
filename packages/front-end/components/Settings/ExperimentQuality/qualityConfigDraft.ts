import {
  EXPERIMENT_QUALITY_CHECKS,
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

// Editable form state for one quality configuration. Section weights are
// integer percentages that total 100 across enabled sections; checks split
// their section equally.
export interface QualityConfigDraft {
  // The stored on/off intent per section (the AI section's is
  // `aiChecksEnabled` in the stored config)
  sectionEnabled: Record<ExperimentQualitySectionKey, boolean>;
  sections: Record<ExperimentQualitySectionKey, { weight: number }>;
  checks: Record<
    ExperimentQualityCheckKey,
    {
      enabled: boolean;
      params?: ExperimentQualityCheckParams;
      aiContext?: string;
    }
  >;
  customAiChecks: Array<{
    id: string;
    name: string;
    rule: string;
    enabled: boolean;
  }>;
}

type DraftCheck = QualityConfigDraft["checks"][ExperimentQualityCheckKey];
type CustomCheck = QualityConfigDraft["customAiChecks"][number];

function normalizeSections(draft: QualityConfigDraft): QualityConfigDraft {
  const enabled = getEnabledSectionKeys(draft);
  const raw = enabled.map((k) => draft.sections[k].weight ?? 1);
  // All at zero splits equally, as the score does
  const weights = roundToTotal(raw.some((w) => w > 0) ? raw : raw.map(() => 1));
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
  const draft: QualityConfigDraft = {
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
    })),
  };
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
  return (
    getChecksForSection(section).filter((k) => draft.checks[k].enabled).length +
    (section === "ai"
      ? draft.customAiChecks.filter((c) => c.enabled).length
      : 0)
  );
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

export function updateCheck(
  draft: QualityConfigDraft,
  key: ExperimentQualityCheckKey,
  updates: Partial<DraftCheck>,
): QualityConfigDraft {
  const next = {
    ...draft,
    checks: { ...draft.checks, [key]: { ...draft.checks[key], ...updates } },
  };
  // A section's last enabled check switches it off, so shares re-flow
  return "enabled" in updates ? normalizeSections(next) : next;
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
  return "enabled" in updates ? normalizeSections(next) : next;
}

export function addCustomCheck(draft: QualityConfigDraft): QualityConfigDraft {
  const id = `rule_${Math.random().toString(36).slice(2, 10)}`;
  return normalizeSections({
    ...draft,
    customAiChecks: [
      ...draft.customAiChecks,
      { id, name: "", rule: "", enabled: true },
    ],
  });
}

export function removeCustomCheck(
  draft: QualityConfigDraft,
  id: string,
): QualityConfigDraft {
  return normalizeSections({
    ...draft,
    customAiChecks: draft.customAiChecks.filter((c) => c.id !== id),
  });
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
