import isEqual from "lodash/isEqual";
import pick from "lodash/pick";
import {
  EXPERIMENT_QUALITY_CHECKS,
  getChecksForSection,
  resolveExperimentQualityScoreSettings,
  roundToTotal,
} from "shared/enterprise";
import {
  CustomQualityCheck,
  ExperimentQualityCheckKey,
  ExperimentQualityCheckParams,
  ExperimentQualityConfigBody,
  ExperimentQualitySectionKey,
  experimentQualityCheckKeys,
  experimentQualitySectionKeys,
} from "shared/validators";
import { rebalance } from "@/services/utils";

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
  customAiChecks: Array<
    {
      id: string;
      name: string;
      rule: string;
      enabled: boolean;
    } & Pick<CustomQualityCheck, "judge" | "judgeChosenBy">
  >;
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
      // Unset until a save picks one automatically
      ...pickJudge(stored?.customAiChecks?.[i]),
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
      id: c.id,
      name: c.name.trim() || "Custom check",
      rule: c.rule,
      enabled: c.enabled,
      ...pickJudge(c),
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

// Type a section's share; like a traffic split, the sections after it absorb
// the difference so the total stays 100
export function setSectionWeight(
  draft: QualityConfigDraft,
  section: ExperimentQualitySectionKey,
  newPct: number,
  // The sections sharing the bar
  enabled = getEnabledSectionKeys(draft),
): QualityConfigDraft {
  const index = enabled.indexOf(section);
  if (index < 0) return draft;
  const weights = rebalance(
    enabled.map((k) => draft.sections[k].weight / 100),
    index,
    newPct / 100,
    2,
  ).map((w) => Math.round(w * 100));
  return withWeights(draft, enabled, weights);
}

// Drag the divider after an enabled section to a point on the 0-100 bar; only
// the two sections either side of it change
export function moveSectionDivider(
  draft: QualityConfigDraft,
  index: number,
  position: number,
  enabled = getEnabledSectionKeys(draft),
): QualityConfigDraft {
  if (index < 0 || index >= enabled.length - 1) return draft;
  const weights = enabled.map((k) => draft.sections[k].weight);
  const start = weights.slice(0, index).reduce((sum, w) => sum + w, 0);
  const pair = weights[index] + weights[index + 1];
  const left = Math.min(Math.max(Math.round(position - start), 0), pair);
  weights[index] = left;
  weights[index + 1] = pair - left;
  return withWeights(draft, enabled, weights);
}

function withWeights(
  draft: QualityConfigDraft,
  keys: ExperimentQualitySectionKey[],
  weights: number[],
): QualityConfigDraft {
  const sections = { ...draft.sections };
  keys.forEach((k, i) => {
    sections[k] = { weight: weights[i] };
  });
  return { ...draft, sections };
}

// --- Comparing with the organization default ----------------------------------

const sectionPart = (
  draft: QualityConfigDraft,
  section: ExperimentQualitySectionKey,
) => ({
  enabled: draft.sectionEnabled[section],
  checks: getChecksForSection(section).map((k) => ({
    enabled: draft.checks[k].enabled,
    params: draft.checks[k].params ?? {},
    aiContext: draft.checks[k].aiContext?.trim() ?? "",
  })),
  custom:
    section === "ai"
      ? draft.customAiChecks.map((c) => pick(c, ["name", "rule", "enabled"]))
      : [],
});

export function isSectionChanged(
  draft: QualityConfigDraft,
  base: QualityConfigDraft,
  section: ExperimentQualitySectionKey,
): boolean {
  return !isEqual(sectionPart(draft, section), sectionPart(base, section));
}

export function areWeightsChanged(
  draft: QualityConfigDraft,
  base: QualityConfigDraft,
): boolean {
  return experimentQualitySectionKeys.some(
    (k) => draft.sections[k].weight !== base.sections[k].weight,
  );
}

// A section's checks and switch as the organization default has them
export function resetSection(
  draft: QualityConfigDraft,
  base: QualityConfigDraft,
  section: ExperimentQualitySectionKey,
): QualityConfigDraft {
  const checks = { ...draft.checks };
  getChecksForSection(section).forEach((k) => {
    checks[k] = base.checks[k];
  });
  return normalizeSections({
    ...draft,
    sectionEnabled: {
      ...draft.sectionEnabled,
      [section]: base.sectionEnabled[section],
    },
    checks,
    customAiChecks:
      section === "ai" ? base.customAiChecks : draft.customAiChecks,
  });
}

export function resetWeights(
  draft: QualityConfigDraft,
  base: QualityConfigDraft,
): QualityConfigDraft {
  return normalizeSections({ ...draft, sections: base.sections });
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

const pickJudge = (c?: Partial<CustomCheck>) =>
  c?.judge ? { judge: c.judge, judgeChosenBy: c.judgeChosenBy } : {};

export function updateCustomCheck(
  draft: QualityConfigDraft,
  id: string,
  updates: Partial<Pick<CustomCheck, "name" | "rule" | "enabled">>,
): QualityConfigDraft {
  const next = {
    ...draft,
    customAiChecks: draft.customAiChecks.map((c) => {
      if (c.id !== id) return c;
      const updated = { ...c, ...updates };
      // A rewritten rule is classified again on save, unless an admin chose
      if (updates.rule === undefined || c.judgeChosenBy === "admin") {
        return updated;
      }
      return { ...updated, judge: undefined, judgeChosenBy: undefined };
    }),
  };
  return "enabled" in updates ? normalizeSections(next) : next;
}

// null hands the choice back to automatic classification on save
export function setCustomCheckJudge(
  draft: QualityConfigDraft,
  id: string,
  judge: CustomQualityCheck["judge"] | null,
): QualityConfigDraft {
  return {
    ...draft,
    customAiChecks: draft.customAiChecks.map((c) =>
      c.id === id
        ? {
            ...c,
            judge: judge ?? undefined,
            judgeChosenBy: judge ? "admin" : undefined,
          }
        : c,
    ),
  };
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
