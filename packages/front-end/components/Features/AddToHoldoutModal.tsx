import { useMemo, useState } from "react";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { useForm } from "react-hook-form";
import { Text } from "@radix-ui/themes";
import { getReviewSetting } from "shared/util";
import { useAuth } from "@/services/auth";
import { useExperiments } from "@/hooks/useExperiments";
import Callout from "@/ui/Callout";
import Modal from "@/components/Modal";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { HoldoutSelect } from "@/components/Holdout/HoldoutSelect";

const AddToHoldoutModal = ({
  feature,
  revisionList,
  close,
  mutate,
  setVersion,
}: {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}) => {
  const form = useForm({
    defaultValues: {
      holdout: feature.holdout?.id ? feature.holdout : undefined,
    },
  });

  const { apiCall } = useAuth();
  const { experimentsMap } = useExperiments();

  const settings = useOrgSettings();
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
    defaultDraft != null ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  // Only allow adding to holdout if all experiments are in draft status and don't have a holdoutId or have the same holdoutId as the feature
  const experimentsAreInDraft = feature.linkedExperiments?.every(
    (experimentId) =>
      experimentsMap[experimentId]?.status === "draft" &&
      (!experimentsMap[experimentId]?.holdoutId ||
        experimentsMap[experimentId]?.holdoutId === feature.holdout?.id),
  );

  // Check if the feature has any safe rollout rules. If it does, we can't add it to a holdout
  // go through each environment setting object and make sure no rule in its rules array has a type of experiment or safe-rollout
  const eligibleToAddToHoldout = Object.values(
    feature.environmentSettings,
  ).every((setting) =>
    setting.rules.every((rule) => rule.type !== "safe-rollout"),
  );

  const showHoldoutSelect = experimentsAreInDraft && eligibleToAddToHoldout;

  return (
    <Modal
      header="Add to holdout"
      close={close}
      open={true}
      trackingEventModalType="add-feature-to-holdout"
      size="lg"
      submit={
        showHoldoutSelect
          ? form.handleSubmit(async (value) => {
              const isPublish = mode === "publish";
              const res = await apiCall<{
                feature: FeatureInterface;
                draftVersion?: number;
              }>(`/feature/${feature.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  ...value,
                  ...(isPublish
                    ? { autoPublish: true }
                    : mode === "existing" && selectedDraft != null
                      ? { targetDraftVersion: selectedDraft }
                      : { forceNewDraft: true }),
                }),
              });

              await mutate();
              if (res.draftVersion) setVersion(res.draftVersion);
              close();
            })
          : undefined
      }
    >
      {(!experimentsAreInDraft || !eligibleToAddToHoldout) && (
        <Callout status="error">
          <Text>
            Holdouts cannot be added to features with safe rollout rules or
            experiments that are not in a draft state.
          </Text>
        </Callout>
      )}

      {showHoldoutSelect && (
        <>
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
          <HoldoutSelect
            selectedProject={feature.project}
            setHoldout={(holdoutId) => {
              form.setValue("holdout", {
                id: holdoutId,
                value: feature.defaultValue,
              });
            }}
            selectedHoldoutId={form.watch("holdout")?.id}
            formType="feature"
          />
        </>
      )}
    </Modal>
  );
};

export default AddToHoldoutModal;
