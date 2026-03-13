import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { validateFeatureValue, getReviewSetting } from "shared/util";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { useAuth } from "@/services/auth";
import { getFeatureDefaultValue } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import FeatureValueField from "./FeatureValueField";

export interface Props {
  feature: FeatureInterface;
  version: number;
  revisionList: MinimalFeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}

export default function EditDefaultValueModal({
  feature,
  version,
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

  const viewingActiveDraft = useMemo(
    () =>
      (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(
        revisionList.find((r) => r.version === version)?.status ?? "",
      ),
    [revisionList, version],
  );

  const [mode, setMode] = useState<DraftMode>(
    viewingActiveDraft ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    viewingActiveDraft ? version : null,
  );

  // URL version drives draft behavior: feature.version = new draft, draft version = modify existing.
  const targetVersion =
    mode === "existing" && selectedDraft != null ? selectedDraft : feature.version;

  return (
    <Modal
      trackingEventModalType=""
      header="Edit Default Value"
      cta="Save to draft"
      useRadixButton={true}
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

        const res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/${targetVersion}/defaultvalue`,
          {
            method: "POST",
            body: JSON.stringify(value),
          },
        );
        await mutate();
        res.version && setVersion(res.version);
      })}
      close={close}
      open={true}
      size={feature.valueType === "json" ? "lg" : "md"}
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
      />
    </Modal>
  );
}
