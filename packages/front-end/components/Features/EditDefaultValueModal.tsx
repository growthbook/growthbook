import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { validateFeatureValue, getReviewSetting } from "shared/util";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { useAuth } from "@/services/auth";
import { getFeatureDefaultValue } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import DraftRevisionCallout from "@/components/Features/DraftRevisionCallout";
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

  const activeDraft = useMemo(
    () =>
      revisionList
        .filter((r) =>
          (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
        )
        .sort((a, b) => b.version - a.version)[0] ?? null,
    [revisionList],
  );

  const requiresApproval = useMemo(() => {
    const requireReviewSettings = settings?.requireReviews;
    if (!requireReviewSettings || typeof requireReviewSettings === "boolean") {
      return !!requireReviewSettings;
    }
    const reviewSetting = getReviewSetting(requireReviewSettings, feature);
    return !!(reviewSetting?.requireReviewOn);
  }, [settings?.requireReviews, feature]);

  return (
    <Modal
      trackingEventModalType=""
      header="Edit Default Value"
      cta="Save to Draft"
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
          `/feature/${feature.id}/${version}/defaultvalue`,
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
      <DraftRevisionCallout activeDraft={activeDraft} requiresApproval={requiresApproval} />
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
