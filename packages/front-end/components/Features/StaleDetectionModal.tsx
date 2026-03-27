import { useState } from "react";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { getReviewSetting } from "shared/util";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";

export default function StaleDetectionModal({
  close,
  feature,
  revisionList = [],
  mutate,
  setVersion,
  onEnable,
}: {
  close: () => void;
  feature: FeatureInterface;
  revisionList?: MinimalFeatureRevisionInterface[];
  mutate: () => Promise<unknown>;
  setVersion: (version: number) => void;
  /** Called after enabling detection (neverStale: true → false) */
  onEnable?: () => void;
}) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const enabling = !!feature.neverStale;
  const newNeverStale = !enabling;

  const isAdmin = permissionsUtil.canBypassApprovalChecks(feature);

  const staleGated: boolean = (() => {
    const raw = settings?.requireReviews;
    if (raw === true) return true;
    if (!Array.isArray(raw)) return false;
    const reviewSetting = getReviewSetting(raw, feature);
    return !!reviewSetting?.requireReviewOn;
  })();

  const canAutoPublish = isAdmin || !staleGated;

  const defaultDraft = useDefaultDraft(revisionList);
  const [mode, setMode] = useState<DraftMode>(staleGated ? "new" : "publish");
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  return (
    <Modal
      trackingEventModalType=""
      open
      close={close}
      header={`${
        enabling ? "Enable" : "Disable"
      } stale feature flag detection for ${feature.id}`}
      cta={
        mode === "publish" ? (enabling ? "Enable" : "Disable") : "Save to draft"
      }
      size="lg"
      submit={async () => {
        const res = await apiCall<{ draftVersion?: number }>(
          `/feature/${feature.id}/toggleStaleDetection`,
          {
            method: "POST",
            body: JSON.stringify({
              neverStale: newNeverStale,
              ...(mode === "publish"
                ? { autoPublish: true }
                : mode === "existing"
                  ? { draftVersion: selectedDraft }
                  : { forceNewDraft: true }),
            }),
          },
        );
        await mutate();
        const resolvedVersion =
          res?.draftVersion ?? (mode === "existing" ? selectedDraft : null);
        if (resolvedVersion != null) setVersion(resolvedVersion);
        if (enabling && mode === "publish") onEnable?.();
      }}
      useRadixButton={true}
    >
      <DraftSelectorForChanges
        feature={feature}
        revisionList={revisionList}
        mode={mode}
        setMode={setMode}
        selectedDraft={selectedDraft}
        setSelectedDraft={setSelectedDraft}
        canAutoPublish={canAutoPublish}
        gatedEnvSet={staleGated ? "all" : "none"}
      />
      <p>
        {feature.neverStale
          ? `Enable stale detection for ${feature.id}?`
          : `Disable stale detection for ${feature.id}? It will no longer be marked as stale.`}
      </p>
    </Modal>
  );
}
