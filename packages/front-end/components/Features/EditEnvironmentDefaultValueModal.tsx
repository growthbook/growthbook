import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { validateFeatureValue, getReviewSetting } from "shared/util";
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { getFeatureDefaultValue } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import ForceSummary from "@/components/Features/ForceSummary";
import FeatureValueField from "./FeatureValueField";

export interface Props {
  feature: FeatureInterface;
  environment: string;
  revisionList: MinimalFeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}

// Per-environment override of the feature's base `defaultValue`. When the
// override toggle is off, the env inherits the base default value (absence of
// an override). When on, the entered value takes precedence over the base
// default for this environment (rules still take precedence over it).
//
// Persists through a draft revision, mirroring EditDefaultValueModal. The
// payload carries the target environment plus the override value; clearing the
// override (toggle off) sends `defaultValue: null` so the back end removes the
// per-env entry from `environmentDefaults`.
export default function EditEnvironmentDefaultValueModal({
  feature,
  environment,
  revisionList,
  close,
  mutate,
  setVersion,
}: Props) {
  const baseDefaultValue = getFeatureDefaultValue(feature);
  const existingOverride =
    feature.environmentSettings?.[environment]?.defaultValue;
  const hasExistingOverride = existingOverride !== undefined;

  const [override, setOverride] = useState<boolean>(hasExistingOverride);

  const form = useForm({
    defaultValues: {
      // Seed the value input with the existing override, or the base default
      // value as a convenient starting point when enabling a new override.
      defaultValue: hasExistingOverride ? existingOverride : baseDefaultValue,
    },
  });
  const { apiCall } = useAuth();
  const settings = useOrgSettings();

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
      : feature.version;

  return (
    <ModalStandard
      trackingEventModalType=""
      header={`Edit Default Value — ${environment}`}
      cta="Save to draft"
      submit={form.handleSubmit(async (value) => {
        // Clearing the override: send null so the back end drops the per-env
        // entry and this environment inherits the base default value again.
        if (!override) {
          const res = await apiCall<{ version: number }>(
            `/feature/${feature.id}/${targetVersion}/environmentdefault`,
            {
              method: "POST",
              body: JSON.stringify({ environment, defaultValue: null }),
            },
          );
          await mutate();
          setVersion(res?.version ?? targetVersion);
          return;
        }

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

        const res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/${targetVersion}/environmentdefault`,
          {
            method: "POST",
            body: JSON.stringify({
              environment,
              defaultValue: newDefaultValue,
            }),
          },
        );
        await mutate();
        setVersion(res?.version ?? targetVersion);
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
      />

      <Flex align="center" gap="2" mb="3">
        <Switch
          id="override-default-value"
          value={override}
          onChange={(on) => setOverride(on)}
        />
        <Text weight="semibold">
          Override the default value in {environment}
        </Text>
      </Flex>

      {override ? (
        <FeatureValueField
          label="Value When Enabled"
          id="environmentDefaultValue"
          value={form.watch("defaultValue")}
          setValue={(v) => form.setValue("defaultValue", v)}
          valueType={feature.valueType}
          feature={feature}
          renderJSONInline={true}
          useCodeInput={true}
          showFullscreenButton={true}
        />
      ) : (
        <Box>
          <Text as="p" color="text-low" mb="1">
            <em>Inherits the base default value:</em>
          </Text>
          <ForceSummary value={baseDefaultValue} feature={feature} />
        </Box>
      )}
    </ModalStandard>
  );
}
