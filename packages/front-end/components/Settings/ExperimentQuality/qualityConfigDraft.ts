import {
  CustomQualityCheck,
  EXPERIMENT_QUALITY_CHECKS,
  EXPERIMENT_QUALITY_SECTIONS,
  ExperimentQualityCheckKey,
  ExperimentQualityCheckParams,
  ExperimentQualityConfigBody,
  ExperimentQualitySectionKey,
  experimentQualityCheckKeys,
  experimentQualitySectionKeys,
  getChecksForSection,
  resolveExperimentQualityScoreSettings,
  roundToTotal,
} from "shared/enterprise";

// Fully-expanded editable form state for one ExperimentQualityConfig doc.
// Weights are integer percentages — section weights sum to 100 across
// enabled sections, check weights sum to 100 within each section's enabled
// checks (custom AI rules share the AI section's pool; kept true by the
// re-flow helpers below).
export interface QualityConfigDraft {
  name: string;
  aiChecksEnabled: boolean;
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
  sectionEnabled: Record<ExperimentQualitySectionKey, boolean>;
}

// Members of the AI section's split pool: built-in AI check keys plus
// custom rules addressed as `custom:<id>`
type AiMemberRef =
  | { kind: "builtin"; key: ExperimentQualityCheckKey }
  | { kind: "custom"; id: string };

function getAiMemberWeight(draft: QualityConfigDraft, ref: AiMemberRef) {
  return ref.kind === "builtin"
    ? draft.checks[ref.key].weight
    : (draft.customAiChecks.find((c) => c.id === ref.id)?.weight ?? 0);
}

function setAiMemberWeight(
  draft: QualityConfigDraft,
  ref: AiMemberRef,
  weight: number,
): QualityConfigDraft {
  if (ref.kind === "builtin") {
    return {
      ...draft,
      checks: {
        ...draft.checks,
        [ref.key]: { ...draft.checks[ref.key], weight },
      },
    };
  }
  return {
    ...draft,
    customAiChecks: draft.customAiChecks.map((c) =>
      c.id === ref.id ? { ...c, weight } : c,
    ),
  };
}

function getEnabledAiMembers(draft: QualityConfigDraft): AiMemberRef[] {
  return [
    ...getChecksForSection("ai")
      .filter((key) => draft.checks[key].enabled)
      .map((key) => ({ kind: "builtin", key }) as AiMemberRef),
    ...draft.customAiChecks
      .filter((c) => c.enabled)
      .map((c) => ({ kind: "custom", id: c.id }) as AiMemberRef),
  ];
}

function sameAiMember(a: AiMemberRef, b: AiMemberRef): boolean {
  return a.kind === "builtin" && b.kind === "builtin"
    ? a.key === b.key
    : a.kind === "custom" && b.kind === "custom"
      ? a.id === b.id
      : false;
}

// Expand a stored config body (possibly undefined for the built-in
// default) into a draft with integer share weights derived from the
// normalized resolution
export function configToDraft(
  stored?: ExperimentQualityConfigBody | null,
  name = "",
): QualityConfigDraft {
  const resolved = resolveExperimentQualityScoreSettings(stored);

  // Integer section weights: enabled sections share 100 by normalized
  // share; disabled sections keep a snapshot of their default/stored raw
  // weight for when they're re-enabled
  const enabledSections = experimentQualitySectionKeys.filter(
    (k) => resolved.sections[k].enabled,
  );
  const enabledShares = roundToTotal(
    enabledSections.map((k) => resolved.sections[k].share),
  );
  const sections = {} as QualityConfigDraft["sections"];
  const sectionEnabled = {} as QualityConfigDraft["sectionEnabled"];
  for (const key of experimentQualitySectionKeys) {
    const idx = enabledSections.indexOf(key);
    sections[key] = {
      weight:
        idx >= 0
          ? enabledShares[idx]
          : Math.round(EXPERIMENT_QUALITY_SECTIONS[key].defaultWeight),
    };
    // Track the STORED intent (not the effective enablement, which also
    // requires >=1 enabled check) so toggling checks doesn't lose it
    sectionEnabled[key] =
      key === "ai"
        ? (stored?.aiChecksEnabled ?? true)
        : (stored?.sections?.[key]?.enabled ?? true);
  }

  // Checks: splits are integers summing to 100 within each section's
  // enabled set. The AI section's pool includes custom rules.
  const checks = {} as QualityConfigDraft["checks"];
  const customAiChecks: QualityConfigDraft["customAiChecks"] = (
    stored?.customAiChecks ?? []
  ).map((c) => ({
    id: c.id,
    name: c.name,
    rule: c.rule,
    enabled: c.enabled ?? true,
    weight: 0,
  }));

  for (const sectionKey of experimentQualitySectionKeys) {
    const sectionChecks = getChecksForSection(sectionKey);
    const enabledChecks = sectionChecks.filter(
      (c) =>
        stored?.checks?.[c]?.enabled ??
        EXPERIMENT_QUALITY_CHECKS[c].defaultEnabled,
    );
    const enabledCustom =
      sectionKey === "ai" ? customAiChecks.filter((c) => c.enabled) : [];
    const rawWeights = [
      ...enabledChecks.map((c) => {
        const w = stored?.checks?.[c]?.weight;
        return w !== undefined && Number.isFinite(w) && w > 0
          ? w
          : EXPERIMENT_QUALITY_CHECKS[c].defaultWeight;
      }),
      ...enabledCustom.map((c) => {
        const w = stored?.customAiChecks?.find((s) => s.id === c.id)?.weight;
        return w !== undefined && Number.isFinite(w) && w > 0 ? w : 1;
      }),
    ];
    const splits = roundToTotal(rawWeights);
    for (const key of sectionChecks) {
      const idx = enabledChecks.indexOf(key);
      checks[key] = {
        enabled: idx >= 0,
        weight:
          idx >= 0
            ? splits[idx]
            : Math.round(100 / Math.max(sectionChecks.length, 1)),
        params: resolved.checks[key].params,
        aiContext: stored?.checks?.[key]?.aiContext,
      };
    }
    enabledCustom.forEach((c, i) => {
      c.weight = splits[enabledChecks.length + i];
    });
  }
  // Disabled custom checks keep an equal-share snapshot for re-enabling
  for (const c of customAiChecks) {
    if (!c.enabled) {
      c.weight = Math.round(
        100 / Math.max(getChecksForSection("ai").length + 1, 1),
      );
    }
  }

  return {
    name,
    aiChecksEnabled: stored?.aiChecksEnabled ?? true,
    sections,
    checks,
    customAiChecks,
    sectionEnabled,
  };
}

// Collapse a draft back into the stored config-body shape (the doc's name
// is handled separately by the save call)
export function draftToConfig(
  draft: QualityConfigDraft,
): ExperimentQualityConfigBody {
  const sections: ExperimentQualityConfigBody["sections"] = {};
  for (const key of experimentQualitySectionKeys) {
    if (key === "ai") {
      // The AI section's on/off lives in aiChecksEnabled
      sections[key] = { weight: draft.sections[key].weight };
    } else {
      sections[key] = {
        enabled: draft.sectionEnabled[key],
        weight: draft.sections[key].weight,
      };
    }
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
  const customAiChecks: CustomQualityCheck[] = draft.customAiChecks.map(
    (c) => ({
      id: c.id,
      name: c.name.trim() || "Custom check",
      rule: c.rule,
      enabled: c.enabled,
      weight: c.weight,
    }),
  );
  return {
    aiChecksEnabled: draft.aiChecksEnabled,
    sections,
    checks,
    ...(customAiChecks.length ? { customAiChecks } : {}),
  };
}

// Sections that participate in the 100% share split right now
export function getEnabledSectionKeys(
  draft: QualityConfigDraft,
): ExperimentQualitySectionKey[] {
  return experimentQualitySectionKeys.filter((key) => {
    const stored =
      key === "ai" ? draft.aiChecksEnabled : draft.sectionEnabled[key];
    const hasEnabledCheck =
      getChecksForSection(key).some((c) => draft.checks[c].enabled) ||
      (key === "ai" && draft.customAiChecks.some((c) => c.enabled));
    return stored && hasEnabledCheck;
  });
}

// Drag a section's share to `newPct`; siblings re-flow proportionally so
// enabled sections keep summing to 100
export function reflowSectionWeights(
  draft: QualityConfigDraft,
  target: ExperimentQualitySectionKey,
  newPct: number,
): QualityConfigDraft {
  const enabled = getEnabledSectionKeys(draft);
  if (!enabled.includes(target)) return draft;
  const others = enabled.filter((k) => k !== target);
  const clamped = Math.min(Math.max(Math.round(newPct), 0), 100);
  if (!others.length) {
    return {
      ...draft,
      sections: { ...draft.sections, [target]: { weight: 100 } },
    };
  }
  const otherWeights = others.map((k) => draft.sections[k].weight);
  const otherSum = otherWeights.reduce((a, b) => a + b, 0);
  const remaining = 100 - clamped;
  const redistributed = roundToTotal(
    otherSum > 0 ? otherWeights : others.map(() => 1),
    remaining,
  );
  const sections = { ...draft.sections, [target]: { weight: clamped } };
  others.forEach((k, i) => {
    sections[k] = { weight: redistributed[i] };
  });
  return { ...draft, sections };
}

// Drag an AI-pool member's split; enabled siblings (built-in AND custom)
// re-flow proportionally so the pool keeps summing to 100
function reflowAiMemberWeights(
  draft: QualityConfigDraft,
  target: AiMemberRef,
  newPct: number,
): QualityConfigDraft {
  const enabled = getEnabledAiMembers(draft);
  if (!enabled.some((m) => sameAiMember(m, target))) return draft;
  const others = enabled.filter((m) => !sameAiMember(m, target));
  const clamped = Math.min(Math.max(Math.round(newPct), 0), 100);
  let next = setAiMemberWeight(draft, target, others.length ? clamped : 100);
  if (!others.length) return next;
  const otherWeights = others.map((m) => getAiMemberWeight(draft, m));
  const otherSum = otherWeights.reduce((a, b) => a + b, 0);
  const redistributed = roundToTotal(
    otherSum > 0 ? otherWeights : others.map(() => 1),
    100 - clamped,
  );
  others.forEach((m, i) => {
    next = setAiMemberWeight(next, m, redistributed[i]);
  });
  return next;
}

// Drag a check's split to `newPct`; enabled siblings within the section
// re-flow proportionally so the section's splits keep summing to 100
export function reflowCheckWeights(
  draft: QualityConfigDraft,
  target: ExperimentQualityCheckKey,
  newPct: number,
): QualityConfigDraft {
  const section = EXPERIMENT_QUALITY_CHECKS[target].section;
  if (section === "ai") {
    return reflowAiMemberWeights(
      draft,
      { kind: "builtin", key: target },
      newPct,
    );
  }
  const enabled = getChecksForSection(section).filter(
    (c) => draft.checks[c].enabled,
  );
  if (!enabled.includes(target)) return draft;
  const others = enabled.filter((c) => c !== target);
  const clamped = Math.min(Math.max(Math.round(newPct), 0), 100);
  const checks = { ...draft.checks };
  if (!others.length) {
    checks[target] = { ...checks[target], weight: 100 };
    return { ...draft, checks };
  }
  const otherWeights = others.map((c) => draft.checks[c].weight);
  const otherSum = otherWeights.reduce((a, b) => a + b, 0);
  const redistributed = roundToTotal(
    otherSum > 0 ? otherWeights : others.map(() => 1),
    100 - clamped,
  );
  checks[target] = { ...checks[target], weight: clamped };
  others.forEach((c, i) => {
    checks[c] = { ...checks[c], weight: redistributed[i] };
  });
  return { ...draft, checks };
}

export function reflowCustomCheckWeights(
  draft: QualityConfigDraft,
  id: string,
  newPct: number,
): QualityConfigDraft {
  return reflowAiMemberWeights(draft, { kind: "custom", id }, newPct);
}

// Renormalize a section's splits over its enabled members (used after any
// enable/disable/add/remove within the section)
function renormalizeSectionSplits(
  draft: QualityConfigDraft,
  section: ExperimentQualitySectionKey,
): QualityConfigDraft {
  if (section === "ai") {
    const members = getEnabledAiMembers(draft);
    if (!members.length) return draft;
    const weights = roundToTotal(
      members.map((m) => getAiMemberWeight(draft, m) || 1),
    );
    let next = draft;
    members.forEach((m, i) => {
      next = setAiMemberWeight(next, m, weights[i]);
    });
    return next;
  }
  const enabledChecks = getChecksForSection(section).filter(
    (c) => draft.checks[c].enabled,
  );
  if (!enabledChecks.length) return draft;
  const weights = roundToTotal(
    enabledChecks.map((c) => draft.checks[c].weight || 1),
  );
  const checks = { ...draft.checks };
  enabledChecks.forEach((c, i) => {
    checks[c] = { ...checks[c], weight: weights[i] };
  });
  return { ...draft, checks };
}

// Toggling a check re-splits the section's enabled checks; toggling a
// section re-flows the section shares
export function setCheckEnabled(
  draft: QualityConfigDraft,
  key: ExperimentQualityCheckKey,
  enabled: boolean,
): QualityConfigDraft {
  const section = EXPERIMENT_QUALITY_CHECKS[key].section;
  const next = renormalizeSectionSplits(
    {
      ...draft,
      checks: { ...draft.checks, [key]: { ...draft.checks[key], enabled } },
    },
    section,
  );
  return renormalizeSections(next);
}

export function setCustomCheckEnabled(
  draft: QualityConfigDraft,
  id: string,
  enabled: boolean,
): QualityConfigDraft {
  const next = renormalizeSectionSplits(
    {
      ...draft,
      customAiChecks: draft.customAiChecks.map((c) =>
        c.id === id ? { ...c, enabled } : c,
      ),
    },
    "ai",
  );
  return renormalizeSections(next);
}

export function updateCustomCheck(
  draft: QualityConfigDraft,
  id: string,
  updates: Partial<
    Pick<QualityConfigDraft["customAiChecks"][number], "name" | "rule">
  >,
): QualityConfigDraft {
  return {
    ...draft,
    customAiChecks: draft.customAiChecks.map((c) =>
      c.id === id ? { ...c, ...updates } : c,
    ),
  };
}

export function addCustomCheck(draft: QualityConfigDraft): QualityConfigDraft {
  const id = `rule_${Math.random().toString(36).slice(2, 10)}`;
  const next = renormalizeSectionSplits(
    {
      ...draft,
      customAiChecks: [
        ...draft.customAiChecks,
        { id, name: "", rule: "", enabled: true, weight: 1 },
      ],
    },
    "ai",
  );
  return renormalizeSections(next);
}

export function removeCustomCheck(
  draft: QualityConfigDraft,
  id: string,
): QualityConfigDraft {
  const next = renormalizeSectionSplits(
    {
      ...draft,
      customAiChecks: draft.customAiChecks.filter((c) => c.id !== id),
    },
    "ai",
  );
  return renormalizeSections(next);
}

export function setSectionEnabled(
  draft: QualityConfigDraft,
  key: ExperimentQualitySectionKey,
  enabled: boolean,
): QualityConfigDraft {
  const next =
    key === "ai"
      ? { ...draft, aiChecksEnabled: enabled }
      : {
          ...draft,
          sectionEnabled: { ...draft.sectionEnabled, [key]: enabled },
        };
  return renormalizeSections(next);
}

// Keep enabled-section weights summing to 100 after enable/disable changes
function renormalizeSections(draft: QualityConfigDraft): QualityConfigDraft {
  const enabled = getEnabledSectionKeys(draft);
  if (!enabled.length) return draft;
  const weights = roundToTotal(
    enabled.map((k) => draft.sections[k].weight || 1),
  );
  const sections = { ...draft.sections };
  enabled.forEach((k, i) => {
    sections[k] = { weight: weights[i] };
  });
  return { ...draft, sections };
}

// A config is saveable only if at least one check would count
export function isDegenerateDraft(draft: QualityConfigDraft): boolean {
  return getEnabledSectionKeys(draft).length === 0;
}
