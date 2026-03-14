import { useMemo, useState } from "react";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { getReviewSetting } from "shared/util";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Callout from "@/ui/Callout";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";

interface Props {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}

export default function RemoveFromHoldoutModal({
  feature,
  revisionList,
  close,
  mutate,
  setVersion,
}: Props) {
  const { apiCall } = useAuth();

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

  const handleSubmit = async () => {
    const isPublish = mode === "publish";
    const res = await apiCall<{
      feature: FeatureInterface;
      draftVersion?: number;
    }>(`/feature/${feature.id}`, {
      method: "PUT",
      body: JSON.stringify({
        holdout: null,
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
  };

  return (
    <Modal
      header="Remove from holdout"
      open={true}
      close={close}
      size="md"
      trackingEventModalType="remove-from-holdout-modal"
      cta="Remove"
      submit={handleSubmit}
    >
      <div style={{ minHeight: 300 }}>
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
        <Callout status="warning">
          Removing this feature from its holdout will expose all previously
          held-out units to the feature on next publish.
        </Callout>
      </div>
    </Modal>
  );
}
