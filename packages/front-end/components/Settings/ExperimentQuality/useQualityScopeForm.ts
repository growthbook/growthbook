import { useMemo, useState } from "react";
import isEqual from "lodash/isEqual";
import isUndefined from "lodash/isUndefined";
import omitBy from "lodash/omitBy";
import { ORG_DEFAULT_SCOPE } from "shared/validators";
import { AIPromptInterface, AI_PROMPT_DEFAULTS } from "shared/ai";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  QualityConfigDraft,
  configToDraft,
  draftToConfig,
  isDegenerateDraft,
  isSectionChanged,
} from "./qualityConfigDraft";

export type QualityStatus = {
  experiments: number;
  // Unarchived experiments per Project id, with "" for no Project
  experimentsByProject?: Record<string, number>;
  decisionModelAvailable?: boolean;
};

export function useQualityStatus() {
  const { data } = useApi<QualityStatus>("/experiment-quality-score/status");
  // The org's definition of a good hypothesis seeds the Hypothesis quality
  // check's context
  const { data: promptsData } = useApi<{ prompts: AIPromptInterface[] }>(
    "/ai/prompts",
  );
  const hypothesisDefinition =
    promptsData?.prompts?.find((p) => p.type === "experiment-hypothesis")
      ?.prompt || AI_PROMPT_DEFAULTS["experiment-hypothesis"];
  return { status: data, hypothesisDefinition };
}

/**
 * The editable settings for one scope: the organization default ("") or a
 * Project. A Project's form starts from its own record, a Project it copies,
 * or the organization default, and saves only what differs from the default.
 */
export function useQualityScopeForm(scope: string, copyFrom?: string | null) {
  const { apiCall } = useAuth();
  const { getHealthSettingsForScope, mutateDefinitions } = useDefinitions();
  const isOrg = scope === ORG_DEFAULT_SCOPE;
  const orgRecord = getHealthSettingsForScope(ORG_DEFAULT_SCOPE);
  const record = isOrg ? orgRecord : getHealthSettingsForScope(scope);
  const copyRecord =
    !isOrg && !record && copyFrom ? getHealthSettingsForScope(copyFrom) : null;
  const startRecord = isOrg ? orgRecord : (record ?? copyRecord);

  const orgEnabled = !!orgRecord?.quality?.enabled;
  const orgDraft = useMemo(
    () => configToDraft(orgRecord?.quality?.config),
    [orgRecord],
  );
  const savedEnabled = startRecord?.quality?.enabled ?? orgEnabled;
  const savedDraft = useMemo(
    () =>
      startRecord?.quality?.config
        ? configToDraft(startRecord.quality.config)
        : orgDraft,
    [startRecord, orgDraft],
  );

  const [edits, setEdits] = useState<{
    enabled: boolean;
    draft: QualityConfigDraft;
  } | null>(null);
  const enabled = edits?.enabled ?? savedEnabled;
  const draft = edits?.draft ?? savedDraft;
  const setEnabled = (v: boolean) => setEdits({ enabled: v, draft });
  const setDraft = (d: QualityConfigDraft) => setEdits({ enabled, draft: d });

  // A copy isn't the Project's until it's saved
  const dirty =
    enabled !== savedEnabled ||
    !isEqual(draft, savedDraft) ||
    (!!copyRecord && !record);
  const aiChanged = isSectionChanged(draft, savedDraft, "ai");
  const blocked = isDegenerateDraft(draft)
    ? "Turn on at least one check to save."
    : draft.customAiChecks.some((c) => !c.rule.trim())
      ? "Describe what each custom check evaluates to save."
      : "";

  async function save({ recheck = false }: { recheck?: boolean } = {}) {
    const quality = isOrg
      ? { enabled, config: draftToConfig(draft) }
      : // A Project keeps only what differs, so the rest follows the default
        omitBy(
          {
            enabled: enabled !== orgEnabled ? enabled : undefined,
            config: isEqual(draft, orgDraft) ? undefined : draftToConfig(draft),
          },
          isUndefined,
        );
    await apiCall("/experimentation-health/settings", {
      method: "PUT",
      body: JSON.stringify({ project: scope, quality }),
    });
    if (recheck) {
      await apiCall("/experiment-quality-score/recalculate", {
        method: "POST",
        body: JSON.stringify({ project: scope }),
      });
    }
    await mutateDefinitions();
    setEdits(null);
  }

  return {
    isOrg,
    record,
    orgEnabled,
    orgDraft,
    enabled,
    setEnabled,
    draft,
    setDraft,
    dirty,
    aiChanged,
    blocked,
    save,
    cancel: () => setEdits(null),
  };
}
