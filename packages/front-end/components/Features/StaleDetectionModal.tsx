import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { getReviewSetting } from "shared/util";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { useDefaultDraftMode } from "@/hooks/useDefaultDraft";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

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
  const { t } = useLingui();
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const enabling = !!feature.neverStale;
  const newNeverStale = !enabling;
  const featureId = feature.id;

  const isAdmin = permissionsUtil.canBypassFlagApprovalChecks(
    feature,
    "feature",
  );

  const staleGated: boolean = (() => {
    const raw = settings?.requireReviews;
    if (raw === true) return true;
    if (!Array.isArray(raw)) return false;
    const reviewSetting = getReviewSetting(raw, feature);
    return !!reviewSetting?.requireReviewOn;
  })();

  // Approval-gating and AUTHORITY are separate factors — see the metadata
  // modals; without the publish atom a draft-only user defaulted into a 403.
  const canAutoPublish =
    (isAdmin || !staleGated) && permissionsUtil.canPublishFeature(feature, []);

  const { mode: initialMode, defaultDraft } = useDefaultDraftMode(
    revisionList,
    canAutoPublish,
  );
  const [mode, setMode] = useState<DraftMode>(initialMode);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  return (
    <ModalStandard
      trackingEventModalType=""
      open
      close={close}
      header={
        enabling
          ? t`Enable stale Feature Flag detection for ${featureId}`
          : t`Disable stale Feature Flag detection for ${featureId}`
      }
      cta={
        mode === "publish"
          ? enabling
            ? t`Enable`
            : t`Disable`
          : t`Save to draft`
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
        if (resolvedVersion !== null) setVersion(resolvedVersion);
        if (enabling && mode === "publish") onEnable?.();
      }}
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
          ? t`Enable stale detection for ${featureId}?`
          : t`Disable stale detection for ${featureId}? It will no longer be marked as stale.`}
      </p>
    </ModalStandard>
  );
}
