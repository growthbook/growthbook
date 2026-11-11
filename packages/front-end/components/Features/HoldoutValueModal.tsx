import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import {
  ensureConfigBacking,
  filterEnvironmentsByFeature,
  getEnabledHoldoutEnvironments,
  getReviewSetting,
  validateFeatureValue,
} from "shared/util";
import { Box } from "@radix-ui/themes";
import { HoldoutInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import useApi from "@/hooks/useApi";
import Text from "@/ui/Text";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useConfigBacking } from "@/hooks/useConfigBacking";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import FeatureValueField from "./FeatureValueField";
import RuleEnvScopeBadges from "./RuleEnvScopeBadges";

interface Props {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}

// A feature's holdout: where it runs, shown, and the value its held-out units
// get, edited as a forced rule's value is.
export default function HoldoutValueModal({
  feature,
  revisionList,
  close,
  mutate,
  setVersion,
}: Props) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();

  // On a config-backed flag the payload serves the value over the flag's
  // config, so it's picked and patched as a forced rule's is.
  const { defaultConfigKey, isConfigBacked, configBackingOptionKeys } =
    useConfigBacking(feature);
  const storedValue = feature.holdout?.value ?? "";
  const form = useForm({
    defaultValues: {
      value: defaultConfigKey
        ? ensureConfigBacking(storedValue, defaultConfigKey)
        : storedValue,
    },
  });

  // Holdout changes are global-scope (like prerequisites/archived)
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
  const [mode, setMode] = useState<DraftMode>(
    defaultDraft !== null ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  // Where the holdout runs is set on the holdout itself; shown for context.
  const environments = filterEnvironmentsByFeature(useEnvironments(), feature);
  const { data: holdoutData } = useApi<{ holdout: HoldoutInterface }>(
    `/holdout/${feature.holdout?.id}`,
    { shouldRun: () => !!feature.holdout?.id },
  );

  const holdout = feature.holdout;
  if (!holdout) return null;

  return (
    <ModalStandard
      trackingEventModalType="holdout-value-modal"
      header="Edit Holdout"
      cta="Save to draft"
      open={true}
      close={close}
      size="lg"
      submit={validatedSubmit(form, async ({ value }) => {
        const fixed = validateFeatureValue(feature, value, "");
        if (fixed !== value) {
          form.setValue("value", fixed);
          throw new Error(
            "We fixed some errors in the value. If it looks correct, submit again.",
          );
        }
        const res = await apiCall<{ draftVersion?: number }>(
          `/feature/${feature.id}`,
          {
            method: "PUT",
            body: JSON.stringify({
              holdout: { id: holdout.id, value: fixed },
              ...(mode === "existing" && selectedDraft !== null
                ? { targetDraftVersion: selectedDraft }
                : { forceNewDraft: true }),
            }),
          },
        );
        await mutate();
        const resolvedVersion =
          res.draftVersion ?? (mode === "existing" ? selectedDraft : null);
        if (resolvedVersion !== null) setVersion(resolvedVersion);
      })}
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
      />
      {holdoutData ? (
        <Box mb="6">
          <Text as="div" weight="semibold" mb="3">
            Holdout Environments
          </Text>
          <RuleEnvScopeBadges
            activeEnvironmentIds={getEnabledHoldoutEnvironments(
              holdoutData.holdout.environmentSettings,
            )}
            environments={environments}
            my="0"
          />
        </Box>
      ) : null}
      <FeatureValueField
        label="Value for held-out units"
        helpText="Changing it changes what units already held out see."
        id="holdoutValue"
        value={form.watch("value")}
        setValue={(v) => form.setValue("value", v)}
        valueType={feature.valueType}
        feature={feature}
        renderJSONInline={true}
        allowConfigBacking={isConfigBacked}
        configBackingOptionKeys={configBackingOptionKeys}
        configBackingShowPatch={isConfigBacked}
        lockConfigBacking={isConfigBacked}
      />
    </ModalStandard>
  );
}
