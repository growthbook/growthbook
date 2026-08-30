import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import {
  validateFeatureValue,
  getReviewSetting,
  getConfigBackingKey,
  getConfigBackingPatch,
  stripConfigExtends,
} from "shared/util";
import { useAuth } from "@/services/auth";
import { getFeatureDefaultValue } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useConfigBacking } from "@/hooks/useConfigBacking";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { ConflictProvider } from "@/components/DraftConflicts/ConflictContext";
import { useDraftConflict } from "@/components/DraftConflicts/useDraftConflict";
import FeatureValueField from "./FeatureValueField";
export interface Props {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}

export default function EditDefaultValueModal({
  feature,
  revisionList,
  close,
  mutate,
  setVersion,
}: Props) {
  const form = useForm({
    defaultValues: {
      defaultValue: getFeatureDefaultValue(feature),
    },
  });
  const { apiCall } = useAuth();
  const settings = useOrgSettings();

  // A config-backed default resolves to exactly a config in `baseConfig`'s
  // family; the picker is locked to that family (no inline patch editor).
  const { defaultConfigKey, isConfigBacked, configBackingOptionKeys } =
    useConfigBacking(feature);
  // Rules/values gating: env filtering without kill-switch-specific checks.
  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, feature]);

  const defaultDraft = useDefaultDraft(revisionList);

  // Pinned at open; `feature` is reactive and would retarget the save.
  const [pinnedFeatureVersion] = useState(() => feature.version);

  const [mode, setMode] = useState<DraftMode>(
    defaultDraft !== null ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  // URL version drives draft behavior: feature.version = new draft, draft version = modify existing.
  const targetVersion =
    mode === "existing" && selectedDraft !== null
      ? selectedDraft
      : pinnedFeatureVersion;

  const conflict = useDraftConflict<{ defaultValue: string }>({
    initial: { defaultValue: getFeatureDefaultValue(feature) },
    labels: { defaultValue: "Value When Enabled" },
    form,
    isNewDraft: mode === "new",
    entityNoun: "value",
  });

  return (
    <ConflictProvider {...conflict.providerProps}>
      <ModalStandard
        trackingEventModalType=""
        header="Edit Default Value"
        cta="Save to draft"
        ctaEnabled={conflict.resolved}
        submit={form.handleSubmit(async (value) => {
          const newDefaultValue = validateFeatureValue(
            feature,
            value?.defaultValue ?? "",
            "",
          );
          if (newDefaultValue !== value.defaultValue) {
            form.setValue("defaultValue", newDefaultValue);
            throw new Error(
              "We fixed some errors in the value. If it looks correct, submit again.",
            );
          }

          // Config-backed: keep a pure patch when it targets the base config
          // (`feature.baseConfig` supplies it); a descendant stays as a layer.
          // Non-config flag: strip any manually-entered `@config:` — a plain flag
          // can't extend a config (keeps `@const:` refs).
          const ownConfig = getConfigBackingKey(newDefaultValue);
          const storedDefault = !isConfigBacked
            ? (stripConfigExtends(newDefaultValue) ?? newDefaultValue)
            : ownConfig !== null && ownConfig === defaultConfigKey
              ? getConfigBackingPatch(newDefaultValue)
              : newDefaultValue;

          const guard = conflict.guard({ defaultValue: storedDefault });
          const res = await conflict.guarded(() =>
            apiCall<{ version: number }>(
              `/feature/${feature.id}/${targetVersion}/defaultvalue`,
              {
                method: "POST",
                body: JSON.stringify({
                  defaultValue: storedDefault,
                  baseline: guard.baseline,
                }),
              },
              guard.onError,
            ),
          );
          conflict.clear();
          await mutate();
          const resolvedVersion = res?.version ?? targetVersion;
          setVersion(resolvedVersion);
        })}
        close={close}
        open={true}
        size="lg"
      >
        <DraftSelectorForChanges
          feature={feature}
          revisionList={revisionList}
          mode={mode}
          setMode={setMode}
          selectedDraft={selectedDraft}
          setSelectedDraft={setSelectedDraft}
          canAutoPublish={false}
          gatedEnvSet={gatedEnvSet}
          alert={conflict.alert}
          alertActive={conflict.alertActive}
        />
        {conflict.callouts}
        <FeatureValueField
          label="Value When Enabled"
          id="defaultValue"
          value={form.watch("defaultValue")}
          setValue={(v) => form.setValue("defaultValue", v)}
          valueType={feature.valueType}
          feature={feature}
          renderJSONInline={true}
          useCodeInput={true}
          showFullscreenButton={true}
          allowConfigBacking={isConfigBacked}
          configBackingOptionKeys={configBackingOptionKeys}
          // A config-backed default is exactly a config (base or a descendant) —
          // no inline overrides. So the picker only selects the config; there's no
          // patch editor (configBackingShowPatch stays false).
          lockConfigBacking={isConfigBacked}
        />
      </ModalStandard>
    </ConflictProvider>
  );
}
